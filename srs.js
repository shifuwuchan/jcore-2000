'use strict';
/* ═══════════════════════════════════════════════════════════
   srs.js — Moteur SM-2 pour J-Core 2000
   Chargé AVANT app.js · utilise window.store (alias de state)

   PRINCIPE : tous les mots sont des cartes, toujours.
   buildFlashcardQueue() retourne TOUS les mots du pool, triés :
     1. Dus (nextReview dépassé) — plus en retard d'abord
     2. Nouveaux (jamais vus)   — ordre aléatoire
     3. En avance              — les plus proches d'abord
   Aucun filtre bloquant. La session se lance quoi qu'il arrive.
═══════════════════════════════════════════════════════════ */

/* ── Constantes SM-2 ── */
const EF_DEFAULT = 2.5;
const EF_MIN     = 1.3;
const EF_MAX     = 3.5;
const MS_DAY     = 86_400_000;
const LEECH_CAP  = 4;

/* Intervalles de base en jours par palier (0 = jamais revu) */
const BASE_DAYS = [0, 1, 3, 7, 14, 30, 60, 120, 250];

/* Modificateurs EF selon l'évaluation */
const EF_MOD = { hard: -0.30, medium: -0.15, easy: +0.10 };

/* ── Entrée vierge ── */
function _blank() {
  return {
    srsLevel    : 0,
    ef          : EF_DEFAULT,
    interval    : 0,       // jours
    nextReview  : 0,       // timestamp ms
    lastSeen    : 0,       // 0 = jamais vu
    streak      : 0,
    lapses      : 0,
    consLapses  : 0,
    totalReviews: 0,
    isLeech     : false,
  };
}

/* ── Accès à store via window ── */
function _data() { return window.store.srsData; }
function _db()   { return window.store.db; }

/* ── API ── */

/**
 * Retourne l'entrée SRS d'un mot, crée une entrée vierge si absente.
 */
function getSRSEntry(wordId) {
  if (!_data()[wordId]) _data()[wordId] = _blank();
  return _data()[wordId];
}

/**
 * Met à jour l'entrée SRS après évaluation flashcard (hard/medium/easy).
 * SM-2 : EF individuel, intervalles croissants, régression sur hard.
 */
function updateSRSFlashcard(wordId, ease) {
  const e   = getSRSEntry(wordId);
  const now = Date.now();
  const newEF = Math.max(EF_MIN, Math.min(EF_MAX, e.ef + EF_MOD[ease]));

  if (ease === 'hard') {
    // Lapse : perd 2 paliers (min 0), EF baisse
    e.srsLevel   = Math.max(0, e.srsLevel - 2);
    e.ef         = newEF;
    e.interval   = Math.max(1, BASE_DAYS[e.srsLevel] || 1);
    e.streak     = 0;
    e.lapses++;
    e.consLapses++;
    if (navigator.vibrate) navigator.vibrate([40, 20, 40]);

  } else if (ease === 'medium') {
    // Progrès prudent : monte d'un palier si streak ≥ 1
    const next    = e.streak >= 1 ? Math.min(8, e.srsLevel + 1) : e.srsLevel;
    e.srsLevel    = next;
    e.ef          = newEF;
    const base    = BASE_DAYS[e.srsLevel] || 1;
    e.interval    = Math.max(1, Math.round(base * newEF * 0.8));
    e.streak++;
    e.consLapses  = 0;

  } else {
    // Easy : progression pleine
    e.srsLevel    = Math.min(8, e.srsLevel + 1);
    e.ef          = newEF;
    const base    = BASE_DAYS[e.srsLevel] || 1;
    e.interval    = Math.max(1, Math.round(base * newEF));
    e.streak++;
    e.consLapses  = 0;
  }

  e.isLeech     = e.consLapses >= LEECH_CAP;
  e.totalReviews++;
  e.lastSeen    = now;
  e.nextReview  = now + Math.round(e.interval * MS_DAY);

  _data()[wordId] = e;
  return e;
}

/**
 * Mise à jour SRS après QCM (correct = easy, incorrect = hard).
 */
function updateSRSQuiz(wordId, correct) {
  return updateSRSFlashcard(wordId, correct ? 'easy' : 'hard');
}

/**
 * Construit la file de session flashcard sur un pool donné.
 * RETOURNE TOUS LES MOTS — aucun filtrage, ordre SRS uniquement.
 *
 * @param {Array} wordList — pool complet du niveau (ou tous niveaux)
 * @returns {Array}
 */
function buildFlashcardQueue(wordList) {
  const now  = Date.now();
  const due  = [], fresh = [], coming = [];

  for (const w of wordList) {
    const e = _data()[w.id];
    if (!e || e.lastSeen === 0) {
      fresh.push(w);
    } else if (e.nextReview <= now) {
      due.push(w);
    } else {
      coming.push(w);
    }
  }

  // Dus : plus en retard d'abord
  due.sort((a, b) => _data()[a.id].nextReview - _data()[b.id].nextReview);

  // Nouveaux : mélange aléatoire
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }

  // En avance : les plus proches d'abord
  coming.sort((a, b) => _data()[a.id].nextReview - _data()[b.id].nextReview);

  return [...due, ...fresh, ...coming];
}

/**
 * Retourne les mots dus parmi tous les niveaux (pour affichage menu).
 */
function getDueWords() {
  const now  = Date.now();
  const all  = Object.values(_db()).flat();
  return all.filter(w => {
    const e = _data()[w.id];
    return e && e.lastSeen && e.nextReview <= now;
  });
}

/**
 * Stats SRS sur un pool : new / due / learning / review / mature.
 */
function getSRSStats(wordList) {
  const now = Date.now();
  const s   = { new: 0, due: 0, learning: 0, review: 0, mature: 0 };
  for (const w of wordList) {
    const e = _data()[w.id];
    if (!e || !e.lastSeen) { s.new++; continue; }
    if (e.nextReview <= now) s.due++;
    if (e.interval < 7)        s.learning++;
    else if (e.interval < 30)  s.review++;
    else                       s.mature++;
  }
  return s;
}

/**
 * Label court de la prochaine révision d'un mot.
 */
function getNextReviewLabel(wordId) {
  const e = _data()[wordId];
  if (!e || !e.lastSeen)       return 'Nouveau';
  if (e.isLeech)               return '⚠ Leech';
  const d = e.nextReview - Date.now();
  if (d <= 0)                  return 'À réviser';
  if (d < MS_DAY)             return `${Math.ceil(d / 3_600_000)}h`;
  return `${Math.ceil(d / MS_DAY)}j`;
}
