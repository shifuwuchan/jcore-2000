'use strict';

/* ═══════════════════════════════════════════════════════════════════
   SRS — Moteur de répétition espacée pour J-Core 2000
   Logique Anki réelle : pool d'apprentissage limité.

   PRINCIPE :
   - Les mots NOUVEAUX n'entrent dans la session qu'un par un, et
     seulement quand une place se libère dans le "pool actif".
   - Le pool actif contient au maximum ACTIVE_POOL_SIZE mots en cours
     d'apprentissage (pas encore "acquis").
   - Un mot quitte le pool actif quand il devient MATURE (acquis) —
     une place se libère alors pour un nouveau mot.
   - Les mots MATURES ne reviennent que rarement, à intervalle long,
     mélangés au pool actif uniquement quand ils sont dus.
   - "Je ne sais pas du tout" = reset complet, le mot reste/retourne
     dans le pool actif immédiatement (boucle serrée).

   STRUCTURE par mot (store.srsData[wordId]) :
   {
     stage       : 'learning' | 'review' | 'mature'
     srsLevel    : 0–8   // palier de maturité
     ef          : 1.3–3.5 // easiness factor individuel (SM-2)
     interval    : number // intervalle actuel en jours
     nextReview  : number // timestamp ms de la prochaine révision
     lastSeen    : number // timestamp ms de la dernière révision (0 = jamais)
     streak      : number // bonnes réponses consécutives
     lapses      : number // total d'oublis depuis le début
     consLapses  : number // oublis consécutifs (détection leech)
     totalReviews: number
     isLeech     : bool
   }
═══════════════════════════════════════════════════════════════════ */

/* ── Constantes ──────────────────────────────────────────────────── */

const EF_MIN     = 1.3;
const EF_MAX     = 3.5;
const EF_DEFAULT = 2.5;

const EF_DELTA = {
  blackout: -0.45,
  hard    : -0.30,
  medium  : -0.15,
  easy    : +0.10,
};

/** Intervalles en jours par palier (base SM-2) */
const SRS_BASE_DAYS = [0, 1, 3, 7, 14, 30, 60, 120, 250];
//  0 nouveau · 1→1j · 2→3j · 3→7j · 4→14j · 5→30j · 6→60j · 7→120j · 8→250j (mature)

const LEECH_THRESHOLD   = 4;   // oublis consécutifs → leech
const MS_PER_DAY        = 86_400_000;

/** Palier à partir duquel un mot est considéré "acquis" (quitte le pool actif) */
const MATURE_LEVEL      = 5;   // interval >= 30j
/** Nombre maximum de mots en apprentissage actif en même temps */
const ACTIVE_POOL_SIZE  = 15;
/** Nombre maximum de nouveaux mots introduits par session */
const NEW_PER_SESSION   = 10;

/* ── Helpers privés ──────────────────────────────────────────────── */

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _defaultEntry() {
  return {
    stage       : 'new',
    srsLevel    : 0,
    ef          : EF_DEFAULT,
    interval    : 0,
    nextReview  : 0,
    lastSeen    : 0,
    streak      : 0,
    lapses      : 0,
    consLapses  : 0,
    totalReviews: 0,
    isLeech     : false,
  };
}

function _stageFor(level) {
  if (level === 0) return 'new';
  if (level >= MATURE_LEVEL) return 'mature';
  return 'learning';
}

/* ── API publique ─────────────────────────────────────────────────── */

/** Retourne (et crée si besoin) l'entrée SRS d'un mot. */
function getSRSEntry(wordId) {
  if (!store.srsData[wordId]) store.srsData[wordId] = _defaultEntry();
  return store.srsData[wordId];
}

/**
 * Calcul SM-2 pur : applique une évaluation à une entrée SRS et la
 * retourne mutée. Aucun effet de bord (pas de vibration, pas de save) —
 * utilisable aussi bien pour la vraie mise à jour que pour une preview.
 * @param {Object} e   - entrée SRS (mutée en place)
 * @param {'blackout'|'hard'|'medium'|'easy'} ease
 * @param {number} now - timestamp ms
 * @returns {Object} la même entrée, mutée
 */
function _applyEase(e, ease, now) {
  const newEF = _clamp(e.ef + EF_DELTA[ease], EF_MIN, EF_MAX);

  if (ease === 'blackout') {
    // "Je ne sais pas du tout" — reset complet, pire qu'un simple lapse.
    e.srsLevel   = 0;
    e.ef         = newEF;
    e.interval   = 0;
    e.streak     = 0;
    e.lapses++;
    e.consLapses++;
    e.nextReview = now; // immédiatement redû — reste dans la boucle serrée

  } else if (ease === 'hard') {
    e.srsLevel   = Math.max(0, e.srsLevel - 2);
    e.ef         = newEF;
    e.interval   = SRS_BASE_DAYS[e.srsLevel];
    e.streak     = 0;
    e.lapses++;
    e.consLapses++;
    e.nextReview = now + Math.round(Math.max(e.interval, 0.02) * MS_PER_DAY);

  } else if (ease === 'medium') {
    const nextLevel = e.streak >= 1 ? Math.min(8, e.srsLevel + 1) : e.srsLevel;
    e.srsLevel   = nextLevel || 1;
    e.ef         = newEF;
    const baseInt = SRS_BASE_DAYS[e.srsLevel] || 1;
    e.interval   = Math.max(1, Math.round(baseInt * newEF * 0.8));
    e.streak++;
    e.consLapses = 0;
    e.nextReview = now + Math.round(e.interval * MS_PER_DAY);

  } else { // easy
    e.srsLevel   = Math.min(8, e.srsLevel + 1) || 1;
    e.ef         = newEF;
    const baseInt = SRS_BASE_DAYS[e.srsLevel] || 1;
    e.interval   = Math.max(1, Math.round(baseInt * newEF));
    e.streak++;
    e.consLapses = 0;
    e.nextReview = now + Math.round(e.interval * MS_PER_DAY);
  }

  e.stage   = _stageFor(e.srsLevel);
  e.isLeech = e.consLapses >= LEECH_THRESHOLD;
  e.totalReviews++;
  e.lastSeen = now;
  return e;
}

/**
 * Met à jour l'entrée SRS après une évaluation flashcard (effet réel +
 * vibration tactile sur mobile si dispo).
 * @param {string} wordId
 * @param {'blackout'|'hard'|'medium'|'easy'} ease
 * @returns {Object} entrée mise à jour
 */
function updateSRSFlashcard(wordId, ease) {
  const e = getSRSEntry(wordId);
  _applyEase(e, ease, Date.now());

  if (ease === 'blackout' && navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 60]);
  else if (ease === 'hard' && navigator.vibrate) navigator.vibrate([40, 30, 40]);

  store.srsData[wordId] = e;
  return e;
}

/** Met à jour l'entrée SRS après une réponse QCM (correct/incorrect). */
function updateSRSQuiz(wordId, correct) {
  return updateSRSFlashcard(wordId, correct ? 'easy' : 'hard');
}

/**
 * Construit la session Anki sur un pool de mots, avec un vrai pool actif
 * limité — comme Anki, pas comme un simple tri.
 *
 * Algorithme :
 *  1. On regarde tous les mots du pool dont le stage est 'learning' —
 *     ce sont les mots déjà entamés mais pas encore acquis.
 *  2. S'il reste de la place dans ACTIVE_POOL_SIZE, on complète avec des
 *     mots 'new' (jamais vus), jusqu'à NEW_PER_SESSION nouveaux max.
 *  3. On ajoute les mots 'mature' dont nextReview est dépassé — ils
 *     reviennent rarement, mélangés au reste, jamais en boucle serrée.
 *  4. La file finale alterne ces groupes pour ne pas avoir 10 nouveaux
 *     mots d'affilée puis 10 anciens : interleaving simple.
 *
 * @param {Array} wordList - tous les mots du niveau choisi
 * @returns {Array} file de session (mots), pas forcément == wordList.length
 */
function buildFlashcardQueue(wordList) {
  const now = Date.now();

  const learning = [];
  const fresh    = [];
  const matureDue = [];

  for (const w of wordList) {
    const e = store.srsData[w.id];
    if (!e || e.stage === 'new' || !e.lastSeen) {
      fresh.push(w);
    } else if (e.stage === 'mature') {
      if (e.nextReview <= now) matureDue.push(w);
      // mature pas dû → on ne le montre pas, il dort tranquille
    } else {
      // learning ou review : actif si dû, sinon on l'ignore pour l'instant
      if (e.nextReview <= now) learning.push(w);
    }
  }

  // Tri : le plus en retard d'abord
  const byOverdue = (a, b) => (store.srsData[a.id]?.nextReview || 0) - (store.srsData[b.id]?.nextReview || 0);
  learning.sort(byOverdue);
  matureDue.sort(byOverdue);

  // Mélange aléatoire des nouveaux
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }

  // Combien de place reste-t-il dans le pool actif ?
  const activeLearningCount = learning.length;
  const roomLeft  = Math.max(0, ACTIVE_POOL_SIZE - activeLearningCount);
  const newToAdd  = Math.min(roomLeft, NEW_PER_SESSION, fresh.length);
  const newCards  = fresh.slice(0, newToAdd);

  // File finale : interleaving — on alterne learning / new / mature
  // pour éviter les blocs homogènes (ennui / découragement).
  const pools = [learning, newCards, matureDue];
  const queue = [];
  let exhausted = false;
  while (!exhausted) {
    exhausted = true;
    for (const p of pools) {
      if (p.length) { queue.push(p.shift()); exhausted = false; }
    }
  }

  return queue;
}

/**
 * Réinsère une carte plus loin dans la session courante (après une
 * évaluation non parfaite), pour rappel rapproché intra-session.
 * @param {Array} queue
 * @param {number} fromIndex
 * @param {Object} word
 * @param {number} minGap
 * @param {number} maxGap
 */
function reinsertInSession(queue, fromIndex, word, minGap = 2, maxGap = 5) {
  const gap = minGap + Math.floor(Math.random() * (maxGap - minGap + 1));
  const pos = Math.min(queue.length, fromIndex + 1 + gap);
  queue.splice(pos, 0, word);
}

/**
 * Nombre de mots dus parmi un pool (apprentissage + mature), pour badge menu.
 * @param {Array} wordList
 */
function getDueCount(wordList) {
  const now = Date.now();
  return wordList.filter(w => {
    const e = store.srsData[w.id];
    return e && e.lastSeen && e.nextReview <= now;
  }).length;
}

/** Formate un nombre de jours en libellé court ("<1j", "3j", "2 mois"...). */
function formatDays(days) {
  if (days < 1)   return "auj.";
  if (days < 30)  return `${Math.round(days)}j`;
  if (days < 365) return `${Math.round(days / 30)} mois`;
  return `${(days / 365).toFixed(1)} an`;
}

/**
 * Prévisualise le résultat d'une évaluation SANS modifier l'état réel —
 * utilisé pour afficher "dans 3j" sur les boutons avant que l'utilisateur
 * ne clique (ri-blackout / ri-hard / ri-medium / ri-easy dans le HTML).
 * @param {string} wordId
 * @param {'blackout'|'hard'|'medium'|'easy'} ease
 * @returns {string} libellé court
 */
function previewIntervalLabel(wordId, ease) {
  const real  = getSRSEntry(wordId);
  const clone = _applyEase({ ...real }, ease, Date.now());
  return ease === 'blackout' ? 'maintenant' : formatDays(clone.interval);
}

/** Tous les mots dus sur l'intégralité de la DB (compteur menu global). */
function getDueWords() {
  const now = Date.now();
  const allWords = Object.values(store.db).flat();
  return allWords.filter(w => {
    const e = store.srsData[w.id];
    return e && e.lastSeen && e.nextReview <= now;
  });
}

/** Label lisible pour la prochaine révision d'un mot. */
function getNextReviewLabel(wordId) {
  const e = store.srsData[wordId];
  if (!e || !e.lastSeen) return 'Nouveau';
  if (e.isLeech)         return '⚠️ Leech';
  const diff = e.nextReview - Date.now();
  if (diff <= 0)         return 'À réviser';
  if (diff < MS_PER_DAY) return `Dans ${Math.ceil(diff / 3_600_000)} h`;
  return `Dans ${Math.ceil(diff / MS_PER_DAY)} j`;
}

/**
 * Stats SRS globales sur un pool — utilisées dans les cartes du menu.
 * @param {Array} wordList
 * @returns {{newCount:number, due:number, learning:number, mature:number, leech:number}}
 */
function getSRSStats(wordList) {
  const now = Date.now();
  const c = { newCount: 0, due: 0, learning: 0, mature: 0, leech: 0 };
  for (const w of wordList) {
    const e = store.srsData[w.id];
    if (!e || !e.lastSeen) { c.newCount++; continue; }
    if (e.isLeech) c.leech++;
    if (e.nextReview <= now) c.due++;
    if (e.stage === 'mature') c.mature++;
    else c.learning++;
  }
  return c;
}
