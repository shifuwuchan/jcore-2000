'use strict';

/* ═══════════════════════════════════════════════════════════════════
   SRS — Moteur de répétition espacée pour J-Core 2000

   PHILOSOPHIE :
   Tous les mots du niveau choisi sont des cartes. Il n'y a pas de
   "0 à réviser" — la session flashcard tourne en roulement permanent
   sur l'intégralité du pool. Le SRS gère uniquement l'ORDRE :
   les mots dus passent en premier, les nouveaux en second, les mots
   dont l'intervalle n'est pas encore écoulé ferment le peloton.
   On ne bloque jamais.

   STRUCTURE par mot (store.srsData[wordId]) :
   {
     srsLevel    : 0–8   // palier de maturité
     ef          : 1.3–3.5 // easiness factor individuel (SM-2)
     interval    : number // intervalle actuel en jours
     nextReview  : number // timestamp ms de la prochaine révision
     lastSeen    : number // timestamp ms de la dernière révision (0 = jamais)
     streak      : number // bonnes réponses consécutives
     lapses      : number // total d'oublis depuis le début
     consLapses  : number // oublis consécutifs (détection leech)
     totalReviews: number // total de révisions
     isLeech     : bool   // true si consLapses >= LEECH_THRESHOLD
   }
═══════════════════════════════════════════════════════════════════ */

/* ── Constantes ──────────────────────────────────────────────────── */

const EF_MIN      = 1.3;
const EF_MAX      = 3.5;
const EF_DEFAULT  = 2.5;

const EF_DELTA = {
  hard  : -0.30,
  medium: -0.15,
  easy  : +0.10,
};

/** Intervalles en jours par palier, utilisés comme base de calcul SM-2 */
const SRS_BASE_DAYS = [0, 1, 3, 7, 14, 30, 60, 120, 250];
//  palier 0 → jamais revu (nouveau)
//  palier 1 → 1 j
//  palier 2 → 3 j
//  palier 3 → 7 j
//  palier 4 → 14 j
//  palier 5 → 30 j
//  palier 6 → 60 j
//  palier 7 → 120 j
//  palier 8 → 250 j  (maîtrisé)

const LEECH_THRESHOLD = 4;  // oublis consécutifs → leech
const MS_PER_DAY      = 86_400_000;

/* ── Helpers privés ──────────────────────────────────────────────── */

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _defaultEntry() {
  return {
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

/* ── API publique ─────────────────────────────────────────────────── */

/**
 * Retourne l'entrée SRS d'un mot (valeurs par défaut si jamais vu).
 * Crée ET stocke l'entrée si elle n'existe pas encore.
 */
function getSRSEntry(wordId) {
  if (!store.srsData[wordId]) store.srsData[wordId] = _defaultEntry();
  return store.srsData[wordId];
}

/**
 * Met à jour l'entrée SRS après une évaluation flashcard.
 * Appelée après chaque évaluation hard / medium / easy.
 *
 * SM-2 complet :
 *   easy   → monte d'un palier, EF +0.10, intervalle = base[palier] × EF
 *   medium → reste au palier OU monte si streak suffisant, EF -0.15
 *   hard   → redescend au palier 1 (pas à 0 pour ne pas repartir de zéro
 *             à chaque erreur), EF -0.30, lapses++
 *
 * @param {string} wordId
 * @param {'hard'|'medium'|'easy'} ease
 * @returns {Object} entrée mise à jour
 */
function updateSRSFlashcard(wordId, ease) {
  const e   = getSRSEntry(wordId);
  const now = Date.now();

  const newEF = _clamp(e.ef + EF_DELTA[ease], EF_MIN, EF_MAX);

  if (ease === 'hard') {
    // Lapse : redescend au palier 1, intervalle 1 jour
    e.srsLevel    = Math.max(1, e.srsLevel - 2);  // perd 2 paliers, pas tout
    e.ef          = newEF;
    e.interval    = SRS_BASE_DAYS[e.srsLevel];
    e.streak      = 0;
    e.lapses++;
    e.consLapses++;
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);

  } else if (ease === 'medium') {
    // Progrès prudent : monte d'un palier seulement si streak ≥ 1
    const nextLevel = e.streak >= 1
      ? Math.min(8, e.srsLevel + 1)
      : e.srsLevel;
    e.srsLevel    = nextLevel;
    e.ef          = newEF;
    // Intervalle = base × EF × 0.8 (poussée modérée)
    const baseInt  = SRS_BASE_DAYS[e.srsLevel] || 1;
    e.interval    = Math.max(1, Math.round(baseInt * newEF * 0.8));
    e.streak++;
    e.consLapses  = 0;

  } else {
    // easy : progression pleine
    e.srsLevel    = Math.min(8, e.srsLevel + 1);
    e.ef          = newEF;
    const baseInt  = SRS_BASE_DAYS[e.srsLevel] || 1;
    e.interval    = Math.max(1, Math.round(baseInt * newEF));
    e.streak++;
    e.consLapses  = 0;
  }

  e.isLeech     = e.consLapses >= LEECH_THRESHOLD;
  e.totalReviews++;
  e.lastSeen    = now;
  e.nextReview  = now + Math.round(e.interval * MS_PER_DAY);

  store.srsData[wordId] = e;
  return e;
}

/**
 * Met à jour l'entrée SRS après une réponse QCM (correct/incorrect).
 */
function updateSRSQuiz(wordId, correct) {
  return updateSRSFlashcard(wordId, correct ? 'easy' : 'hard');
}

/**
 * Construit la file complète d'une session flashcard sur un pool de mots.
 *
 * RÈGLE FONDAMENTALE : TOUS les mots du pool sont inclus, toujours.
 * Aucun mot n'est écarté. L'ordre seul est déterminé par le SRS :
 *
 *   1. Mots DUS (nextReview dépassé) → triés du plus en retard au moins
 *   2. Mots NOUVEAUX (jamais vus)   → mélangés aléatoirement
 *   3. Mots EN AVANCE (délai pas encore atteint) → triés par nextReview
 *
 * Le compteur "à réviser" dans le menu est le nombre de mots DUS parmi
 * tous les mots — pas un verrou. La session se lance quoi qu'il arrive.
 *
 * @param {Array}  wordList - tous les mots du niveau choisi
 * @returns {Array} file ordonnée, longueur == wordList.length
 */
function buildFlashcardQueue(wordList) {
  const now    = Date.now();
  const due    = [];   // nextReview dépassé
  const fresh  = [];   // jamais vus (lastSeen === 0)
  const coming = [];   // nextReview pas encore atteint

  for (const w of wordList) {
    const e = store.srsData[w.id];
    if (!e || e.lastSeen === 0) {
      fresh.push(w);
    } else if (e.nextReview <= now) {
      due.push(w);
    } else {
      coming.push(w);
    }
  }

  // Dus : plus en retard d'abord
  due.sort((a, b) => store.srsData[a.id].nextReview - store.srsData[b.id].nextReview);

  // Nouveaux : ordre aléatoire
  for (let i = fresh.length - 1; i > 0; i--) {
    const j  = Math.floor(Math.random() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }

  // En avance : ceux dont le délai est le plus proche en premier
  coming.sort((a, b) => store.srsData[a.id].nextReview - store.srsData[b.id].nextReview);

  return [...due, ...fresh, ...coming];
}

/**
 * Retourne le nombre de mots dus parmi un pool — pour l'affichage menu.
 * Ne bloque jamais la session ; c'est juste un indicateur.
 * @param {Array} wordList
 * @returns {number}
 */
function getDueCount(wordList) {
  const now = Date.now();
  return wordList.filter(w => {
    const e = store.srsData[w.id];
    return e && e.lastSeen && e.nextReview <= now;
  }).length;
}

/**
 * Version globale de getDueCount sur toute la DB — utilisée dans renderMenu.
 * Conserve le nom getDueWords() attendu par app.js pour le compteur.
 * @returns {Array} mots dus (pour compatibilité avec le code existant)
 */
function getDueWords() {
  const now      = Date.now();
  const allWords = Object.values(store.db).flat();
  return allWords.filter(w => {
    const e = store.srsData[w.id];
    return e && e.lastSeen && e.nextReview <= now;
  });
}

/**
 * Label lisible pour la prochaine révision d'un mot.
 * @param {string} wordId
 * @returns {string}
 */
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
 * Stats SRS globales sur un pool — pour affichage éventuel.
 * @param {Array} wordList
 * @returns {{ new, due, learning, review, mature, leech }}
 */
function getSRSStats(wordList) {
  const now = Date.now();
  const c   = { new: 0, due: 0, learning: 0, review: 0, mature: 0, leech: 0 };
  for (const w of wordList) {
    const e = store.srsData[w.id];
    if (!e || !e.lastSeen)     { c.new++;      continue; }
    if (e.isLeech)               c.leech++;
    if (e.nextReview <= now)     c.due++;
    if (e.interval < 1)          c.learning++;
    else if (e.interval < 21)    c.review++;
    else                         c.mature++;
  }
  return c;
}
