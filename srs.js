'use strict';

/* ════════════════════════════════════════════════════════════════════
   srs.js — Moteur de répétition espacée (SM-2 adapté) · v2

   Principes (définis avec l'utilisateur) :
   - Suivi SÉPARÉ lecture (JP→FR) et production (FR→JP) par mot : les
     deux sens sont traités comme deux "cartes" indépendantes, chacune
     avec son propre niveau / ef / échéance.
   - Le "pool actif" (15 cartes) n'est plus une limite théorique : c'est
     le contenu réel d'une session. Toutes les cartes en apprentissage
     (dues ou pas) y participent, triées de la plus faible à la plus
     forte — pas seulement les cartes dues.
   - Nouveaux mots bornés par DEUX quotas fournis par app.js (qui gère
     la persistance) : un quota quotidien global et un quota par
     session, tous les deux à respecter en même temps.
   - "Difficile" est neutre : aucune pénalité, aucune progression, le
     niveau ne bouge pas.
   - "Black-out" reste un vrai échec (reset complet), mais ne fait
     JAMAIS redevenir une carte "nouvelle" — bug corrigé.
   - Chaque carte apparaît au moins 2 fois par session (3 fois si son
     niveau est ≤ 1), avec un espacement qui évite les doublons côte
     à côte.
   - Les leechs (4 échecs consécutifs) sortent du flux normal — gérés
     via buildLeechQueue(), un mode dédié.
════════════════════════════════════════════════════════════════════ */

/** Les deux sens traités comme des cartes indépendantes. */
const DIRECTIONS = ['read', 'prod']; // read = JP→FR (reconnaissance), prod = FR→JP (production)

const EF_DEFAULT = 2.5;
const EF_MIN     = 1.3;
const EF_MAX     = 3.5;

/** Variation de l'ease factor par évaluation. "hard" = 0 → neutre, aucune pénalité. */
const EF_DELTA = { blackout: -0.45, hard: 0, medium: -0.15, easy: 0.10 };

/** Intervalle de base (jours) par niveau 0 → 8. */
const SRS_BASE_DAYS = [0, 1, 3, 7, 14, 30, 60, 120, 250];

const MATURE_LEVEL     = 5;   // niveau à partir duquel une carte est "acquise"
const LEECH_THRESHOLD  = 4;   // échecs consécutifs avant d'être mis de côté
const MS_PER_DAY       = 86400000;

/** Nombre de cartes "en chantier" (pas encore acquises) max en circulation. */
const ACTIVE_POOL_SIZE = 15;

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Construit l'identifiant de carte pour un mot + un sens donné. */
function cardId(wordId, dir) { return `${wordId}_${dir}`; }

function _defaultEntry() {
  return {
    stage          : 'new',
    srsLevel       : 0,
    ef             : EF_DEFAULT,
    interval       : 0,
    nextReview     : 0,
    lastSeen       : 0,
    streak         : 0,
    lapses         : 0,
    consLapses     : 0,
    totalReviews   : 0,
    isLeech        : false,
    masteredAwarded: false,
  };
}

/**
 * Retourne (et crée si besoin) l'entrée SRS d'une carte.
 * @param {string} id - cardId (= "{wordId}_read" ou "{wordId}_prod")
 */
function getSRSEntry(id) {
  if (!store.srsData[id]) store.srsData[id] = _defaultEntry();
  return store.srsData[id];
}

/**
 * Calcul pur SM-2 adapté : applique une évaluation à une entrée et la
 * retourne mutée. Aucun effet de bord — utilisable pour la vraie mise
 * à jour comme pour une preview.
 * @param {Object} e   - entrée SRS (mutée en place)
 * @param {'blackout'|'hard'|'medium'|'easy'} ease
 * @param {number} now - timestamp ms
 * @returns {Object} la même entrée, mutée
 */
function _applyEase(e, ease, now) {
  if (ease === 'hard') {
    // NEUTRE : ne pénalise pas, ne fait pas progresser, ne bouge pas le
    // niveau ni l'ef. On reprogramme juste la même échéance qu'avant,
    // pour la revoir au même rythme (ni recul, ni avance).
    e.nextReview = now + Math.round(Math.max(e.interval, 0.5) * MS_PER_DAY);

  } else if (ease === 'blackout') {
    e.srsLevel   = 0;
    e.ef         = _clamp(e.ef + EF_DELTA.blackout, EF_MIN, EF_MAX);
    e.interval   = 0;
    e.streak     = 0;
    e.lapses++;
    e.consLapses++;
    e.nextReview = now; // immédiatement redue — boucle serrée en session

  } else if (ease === 'medium') {
    const nextLevel = e.streak >= 1 ? Math.min(8, e.srsLevel + 1) : e.srsLevel;
    e.srsLevel   = nextLevel || 1;
    e.ef         = _clamp(e.ef + EF_DELTA.medium, EF_MIN, EF_MAX);
    const baseInt = SRS_BASE_DAYS[e.srsLevel] || 1;
    e.interval   = Math.max(1, Math.round(baseInt * e.ef * 0.8));
    e.streak++;
    e.consLapses = 0;
    e.nextReview = now + Math.round(e.interval * MS_PER_DAY);

  } else { // easy
    e.srsLevel   = Math.min(8, e.srsLevel + 1) || 1;
    e.ef         = _clamp(e.ef + EF_DELTA.easy, EF_MIN, EF_MAX);
    const baseInt = SRS_BASE_DAYS[e.srsLevel] || 1;
    e.interval   = Math.max(1, Math.round(baseInt * e.ef));
    e.streak++;
    e.consLapses = 0;
    e.nextReview = now + Math.round(e.interval * MS_PER_DAY);
  }

  // Le stage ne redevient JAMAIS "new" une fois qu'on a évalué au moins
  // une fois (sinon un Black-out faisait recroire à une carte jamais
  // vue — bug corrigé). À partir d'ici : "learning" ou "mature", point.
  e.stage      = e.srsLevel >= MATURE_LEVEL ? 'mature' : 'learning';
  e.isLeech    = e.consLapses >= LEECH_THRESHOLD;
  e.totalReviews++;
  e.lastSeen   = now;
  return e;
}

/**
 * Met à jour l'entrée SRS après une évaluation flashcard (effet réel +
 * vibration sur mobile pour un vrai échec — plus de vibration pour
 * "hard", qui n'est plus un échec).
 * @param {string} id - cardId
 * @param {'blackout'|'hard'|'medium'|'easy'} ease
 * @returns {{entry: Object, justMastered: boolean}}
 */
function updateSRSFlashcard(id, ease) {
  const e = getSRSEntry(id);
  const wasMature = e.stage === 'mature';
  _applyEase(e, ease, Date.now());

  let justMastered = false;
  if (!wasMature && e.stage === 'mature' && !e.masteredAwarded) {
    e.masteredAwarded = true;
    justMastered = true;
  }

  if (ease === 'blackout' && navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 60]);

  store.srsData[id] = e;
  return { entry: e, justMastered };
}

/**
 * Met à jour le SRS après une réponse en mode QCM. Une bonne réponse
 * vaut "easy" ; une mauvaise réponse est un vrai échec ("blackout"),
 * pas un simple "hard" (qui est neutre depuis la v2).
 * @param {string} id - cardId
 * @param {boolean} correct
 * @returns {{entry: Object, justMastered: boolean}}
 */
function updateSRSQuiz(id, correct) {
  return updateSRSFlashcard(id, correct ? 'easy' : 'blackout');
}

/** Mélange un tableau en place (Fisher-Yates) et le retourne. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

/**
 * Répartit chaque carte en plusieurs passages espacés ("lanes") : la
 * lane 0 contient un passage de chaque carte, la lane 1 un 2e passage
 * des cartes qui en ont besoin, la lane 2 un 3e passage des plus
 * faibles. Chaque lane est mélangée indépendamment puis concaténée —
 * ça garantit qu'une même carte ne revient jamais collée à elle-même.
 * @param {Array<{word, dir, cardId}>} base
 * @returns {Array<{word, dir, cardId}>}
 */
function _scheduleRepeats(base) {
  const lanes = [[], [], []];
  base.forEach(item => {
    const e = getSRSEntry(item.cardId);
    const reps = (e.totalReviews === 0 || e.srsLevel <= 1) ? 3 : 2;
    for (let r = 0; r < reps; r++) lanes[r].push(item);
  });
  lanes.forEach(shuffle);
  return [].concat(...lanes);
}

/**
 * Insère une carte plus loin dans la file EN COURS (pendant la
 * session), avec un écart aléatoire entre minGap et maxGap cartes.
 * Utilisé uniquement pour Black-out (vrai échec → boucle serrée
 * immédiate, en plus de ses passages déjà programmés).
 */
function reinsertInSession(queue, fromIndex, item, minGap, maxGap) {
  const gap = minGap + Math.floor(Math.random() * (maxGap - minGap + 1));
  const pos = Math.min(queue.length, fromIndex + 1 + gap);
  queue.splice(pos, 0, item);
}

/**
 * Construit la file de session complète.
 * @param {Array} wordList - mots du niveau choisi (ou tous les niveaux)
 * @param {{dailyRemaining: number, sessionCap: number}} [quota]
 *        Quotas de nouveaux mots fournis par app.js (qui gère la
 *        persistance jour/session) ; Infinity par défaut (pas de cap).
 * @returns {Array<{word, dir, cardId}>} file de session (avec répétitions)
 */
function buildFlashcardQueue(wordList, quota) {
  quota = quota || { dailyRemaining: Infinity, sessionCap: Infinity };
  const now = Date.now();

  const pool      = []; // cartes en apprentissage (dues ou pas), hors leech
  const fresh     = []; // cartes jamais vues
  const matureDue = []; // cartes acquises et dues

  wordList.forEach(w => {
    DIRECTIONS.forEach(dir => {
      const id = cardId(w.id, dir);
      const e  = getSRSEntry(id);
      const item = { word: w, dir, cardId: id };

      if (e.totalReviews === 0) {
        fresh.push(item);
      } else if (e.isLeech) {
        // Exclu du flux normal — voir buildLeechQueue().
      } else if (e.stage === 'mature') {
        if (e.nextReview <= now) matureDue.push(item);
      } else {
        pool.push(item); // apprentissage : fait partie du contenu réel de la session
      }
    });
  });

  // Tri du pool : niveau le plus faible d'abord (les plus fragiles),
  // puis par retard pour départager à niveau égal.
  pool.sort((a, b) => {
    const ea = getSRSEntry(a.cardId), eb = getSRSEntry(b.cardId);
    if (ea.srsLevel !== eb.srsLevel) return ea.srsLevel - eb.srsLevel;
    return ea.nextReview - eb.nextReview;
  });

  // Le pool ne dépasse jamais ACTIVE_POOL_SIZE cartes ; si on en a plus,
  // on garde les plus faibles (qui ont le plus besoin de pratique).
  const poolKept = pool.slice(0, ACTIVE_POOL_SIZE);
  const roomLeft = Math.max(0, ACTIVE_POOL_SIZE - poolKept.length);

  // Nouvelles cartes : bornées par la place dans le pool, le quota du
  // jour ET le quota de la session — les trois à la fois.
  const newAllowed = Math.max(0, Math.min(roomLeft, quota.sessionCap, quota.dailyRemaining, fresh.length));
  shuffle(fresh);
  const newPicked = fresh.slice(0, newAllowed);

  const base = [...poolKept, ...newPicked, ...matureDue];
  if (base.length === 0) return [];

  return _scheduleRepeats(base);
}

/**
 * Construit une session dédiée aux leechs (mots difficiles, 4 échecs
 * consécutifs) — hors flux normal, sans quota de nouveaux mots (il n'y
 * en a pas, ce sont par définition des cartes déjà vues).
 * @param {Array} wordList
 * @returns {Array<{word, dir, cardId}>}
 */
function buildLeechQueue(wordList) {
  const items = [];
  wordList.forEach(w => {
    DIRECTIONS.forEach(dir => {
      const id = cardId(w.id, dir);
      const e  = getSRSEntry(id);
      if (e.isLeech) items.push({ word: w, dir, cardId: id });
    });
  });
  shuffle(items);
  return _scheduleRepeats(items);
}

/**
 * Construit une session de révision des mots déjà MAÎTRISÉS (à la
 * demande, pas liée aux échéances) — pour un contrôle de confiance.
 * Un seul passage par carte (pas la répétition x2/x3 des autres modes,
 * ces mots sont déjà solides ; voir buildFlashcardQueue pour ça).
 * Une évaluation ici a un effet réel : un Black-out fait redescendre
 * le mot en apprentissage normalement.
 * @param {Array} wordList
 * @returns {Array<{word, dir, cardId}>}
 */
function buildMatureReviewQueue(wordList) {
  const items = [];
  wordList.forEach(w => {
    DIRECTIONS.forEach(dir => {
      const id = cardId(w.id, dir);
      const e  = getSRSEntry(id);
      if (e.stage === 'mature' && !e.isLeech) items.push({ word: w, dir, cardId: id });
    });
  });
  return shuffle(items);
}

/** Nombre de cartes en apprentissage actuellement en retard (hors leech/mature/new). */
function getBacklogCount(wordList) {
  const now = Date.now();
  let count = 0;
  wordList.forEach(w => DIRECTIONS.forEach(dir => {
    const e = getSRSEntry(cardId(w.id, dir));
    if (e.totalReviews > 0 && !e.isLeech && e.stage !== 'mature' && e.nextReview <= now) count++;
  }));
  return count;
}

/** Toutes les cartes dues sur l'intégralité de la DB (compteur "encore dues aujourd'hui"). */
function getDueWords() {
  const now = Date.now();
  return Object.keys(store.srsData).filter(id => {
    const e = store.srsData[id];
    return e.totalReviews > 0 && !e.isLeech && e.nextReview <= now;
  });
}

/**
 * Statistiques globales (toutes cartes lecture+production confondues)
 * pour l'écran menu et l'écran stats.
 * @param {Array} wordList
 * @returns {{newCount:number, due:number, learning:number, mature:number, leech:number}}
 */
function getSRSStats(wordList) {
  const now = Date.now();
  let newCount = 0, due = 0, learning = 0, mature = 0, leechCount = 0;
  wordList.forEach(w => DIRECTIONS.forEach(dir => {
    const e = getSRSEntry(cardId(w.id, dir));
    if (e.totalReviews === 0) { newCount++; return; }
    if (e.isLeech) { leechCount++; return; }
    if (e.stage === 'mature') { mature++; if (e.nextReview <= now) due++; }
    else { learning++; if (e.nextReview <= now) due++; }
  }));
  return { newCount, due, learning, mature, leech: leechCount };
}

/**
 * Prévision du nombre de cartes qui deviendront dues chaque jour des
 * N prochains jours (pour l'écran stats).
 * @param {Array} wordList
 * @param {number} days
 * @returns {number[]} tableau de taille `days`
 */
function getForecast(wordList, days) {
  const now = Date.now();
  const buckets = new Array(days).fill(0);
  wordList.forEach(w => DIRECTIONS.forEach(dir => {
    const e = getSRSEntry(cardId(w.id, dir));
    if (e.totalReviews === 0 || e.isLeech) return;
    const diffDays = Math.floor((e.nextReview - now) / MS_PER_DAY);
    if (diffDays >= 0 && diffDays < days) buckets[diffDays]++;
  }));
  return buckets;
}

/**
 * Prévisualise le résultat d'une évaluation SANS modifier l'état réel.
 * @param {string} id - cardId
 * @param {'blackout'|'hard'|'medium'|'easy'} ease
 * @returns {string} libellé court
 */
function previewIntervalLabel(id, ease) {
  const real  = getSRSEntry(id);
  const clone = _applyEase({ ...real }, ease, Date.now());
  if (ease === 'blackout') return 'maintenant';
  if (ease === 'hard')     return 'même rythme';
  return formatDays(clone.interval);
}

/** Formate un nombre de jours en libellé court ("<1j", "3j", "2 mois"...). */
function formatDays(days) {
  if (days < 1)   return "auj.";
  if (days < 30)  return `${Math.round(days)}j`;
  if (days < 365) return `${Math.round(days / 30)} mois`;
  return `${(days / 365).toFixed(1)} an`;
}
