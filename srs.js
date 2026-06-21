'use strict';

/* ═══════════════════════════════════════════════════════════════════
   SRS — Moteur de répétition espacée (SM-2 complet + extensions)

   Algorithme : variante de SM-2 (SuperMemo 2) avec :
     · Easiness Factor individuel par mot  →  les intervalles s'adaptent
       à l'historique réel de chaque carte, pas à un barème fixe
     · 8 paliers de maturité au lieu de 6
     · Intervalles initiaux courts (apprentissage), longs (révision)
     · Protection leech : carte signalée après 4 lapses consécutifs
     · Cap de session : on n'affiche jamais plus de N cartes dues
       d'un coup pour éviter la surcharge cognitive
     · Statistiques complètes par carte (streak, lapses, totalReviews)

   Structure stockée pour chaque mot (store.srsData[wordId]) :
   {
     srsLevel      : number   // palier actuel 0–8
     ef            : number   // easiness factor 1.3–3.5 (défaut 2.5)
     interval      : number   // intervalle actuel en jours (≥ 0)
     nextReview    : number   // timestamp ms de la prochaine révision
     lastSeen      : number   // timestamp ms de la dernière révision
     streak        : number   // réponses "non-difficile" consécutives
     lapses        : number   // nombre total d'oublis (hard) depuis le début
     consLapses    : number   // oublis consécutifs sans succès (leech)
     totalReviews  : number   // nombre total de révisions
     isLeech       : boolean  // vrai si consLapses >= LEECH_THRESHOLD
   }
═══════════════════════════════════════════════════════════════════ */


/* ── Constantes ─────────────────────────────────────────────────── */

/**
 * Paliers d'apprentissage initial (en minutes).
 * Un mot nouveau passe par ces paliers avant d'entrer en révision longue.
 * Inspiré des "learning steps" d'Anki.
 */
const LEARNING_STEPS_MIN = [1, 10, 1440, 4320];
// palier 0 → 1 min  (revu dans la même session)
// palier 1 → 10 min
// palier 2 → 1 jour
// palier 3 → 3 jours  →  puis algorithme SM-2 enclenché

/**
 * Intervalles de base (jours) pour les paliers de révision longue.
 * Utilisés comme point de départ ; l'EF les multiplie ensuite.
 */
const BASE_INTERVALS_DAYS = [1, 4, 8, 15, 30, 60, 120, 250];
// palier 0 → 1 j
// palier 1 → 4 j
// palier 2 → 8 j
// palier 3 → 15 j
// palier 4 → 30 j
// palier 5 → 60 j
// palier 6 → 120 j
// palier 7 → 250 j  (maîtrise totale)

/** Valeurs limites de l'Easiness Factor */
const EF_MIN     = 1.3;
const EF_MAX     = 3.5;
const EF_DEFAULT = 2.5;

/** Modificateurs appliqués à l'EF selon l'évaluation */
const EF_DELTA = {
  hard:   -0.30,  // beaucoup plus difficile → intervalle réduit fortement
  medium: -0.15,  // un peu de mal          → intervalle réduit légèrement
  easy:   +0.10,  // facile                 → intervalle allongé
};

/** Un mot devient "leech" après ce nombre d'oublis consécutifs */
const LEECH_THRESHOLD = 4;

/** Cap max de cartes dues affichées par session (surcharge) */
const SESSION_DUE_CAP  = 50;

/** Taille cible d'une session flashcard (dues + nouveaux) */
const SESSION_TARGET   = 20;

/** Nombre max de nouveaux mots introduits par session */
const SESSION_NEW_CAP  = 10;

const MS_PER_MIN  = 60_000;
const MS_PER_DAY  = 86_400_000;


/* ── Helpers internes ────────────────────────────────────────────── */

/**
 * Retourne l'entrée SRS d'un mot, ou un état initial par défaut.
 * @param {string} wordId
 * @returns {Object}
 */
function getSRSEntry(wordId) {
  return store.srsData[wordId] ?? {
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

/**
 * Sauvegarde une entrée SRS dans le store (sans écrire le localStorage —
 * la persistance est déclenchée explicitement par saveStorage()).
 * @param {string} wordId
 * @param {Object} entry
 */
function setSRSEntry(wordId, entry) {
  store.srsData[wordId] = entry;
}

/**
 * Indique si un mot est en phase d'apprentissage initial
 * (n'a pas encore atteint les révisions longues).
 * @param {Object} entry
 * @returns {boolean}
 */
function isInLearning(entry) {
  // On est en apprentissage tant que le mot n'est pas sorti
  // de la dernière étape des learning steps (interval < 1 jour entier)
  return entry.interval < 1 && entry.totalReviews > 0;
}

/**
 * Clamp un nombre entre min et max.
 */
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }


/* ── Calcul du prochain intervalle ──────────────────────────────── */

/**
 * Calcule le prochain intervalle (en jours) après une révision.
 *
 * Phase apprentissage (interval < 1 j) :
 *   hard   → repasse au premier palier (1 min)
 *   medium → reste au même palier d'apprentissage
 *   easy   → saute au palier d'apprentissage suivant
 *
 * Phase révision longue (interval ≥ 1 j) :
 *   hard   → revient au palier 1 j (repart de zéro, EF baisse fortement)
 *   medium → intervalle courant × EF × 0.8  (pousse mais prudemment)
 *   easy   → intervalle courant × EF         (pousse pleinement)
 *
 * @param {Object} entry  - entrée SRS actuelle
 * @param {'hard'|'medium'|'easy'} ease
 * @returns {{ newInterval: number, newEF: number, newSrsLevel: number }}
 */
function computeNextInterval(entry, ease) {
  const inLearning = isInLearning(entry);

  /* ── Phase apprentissage ── */
  if (inLearning || entry.totalReviews === 0) {
    const stepIdx = Math.round(entry.interval * 24 * 60); // approx en minutes
    const steps   = LEARNING_STEPS_MIN;

    if (ease === 'hard') {
      // Retour au début de l'apprentissage
      return {
        newInterval  : steps[0] / (24 * 60),
        newEF        : clamp(entry.ef + EF_DELTA.hard, EF_MIN, EF_MAX),
        newSrsLevel  : 0,
      };
    }

    if (ease === 'medium') {
      // Reste sur le palier actuel
      const minutes = entry.interval > 0
        ? Math.round(entry.interval * 24 * 60)
        : steps[0];
      return {
        newInterval  : minutes / (24 * 60),
        newEF        : clamp(entry.ef + EF_DELTA.medium, EF_MIN, EF_MAX),
        newSrsLevel  : entry.srsLevel,
      };
    }

    /* easy : avance au palier suivant */
    // Trouver l'index courant dans les steps
    const curMin  = entry.interval > 0 ? entry.interval * 24 * 60 : 0;
    let   nextIdx = steps.findIndex(s => s > curMin);
    if   (nextIdx === -1) nextIdx = steps.length; // sortie de l'apprentissage

    if (nextIdx >= steps.length) {
      // Sort de l'apprentissage → premier intervalle long
      return {
        newInterval  : BASE_INTERVALS_DAYS[0],
        newEF        : clamp(entry.ef + EF_DELTA.easy, EF_MIN, EF_MAX),
        newSrsLevel  : 1,
      };
    }
    return {
      newInterval  : steps[nextIdx] / (24 * 60),
      newEF        : clamp(entry.ef + EF_DELTA.easy, EF_MIN, EF_MAX),
      newSrsLevel  : 0,
    };
  }

  /* ── Phase révision longue ── */

  if (ease === 'hard') {
    // Lapse : repart en apprentissage
    return {
      newInterval  : LEARNING_STEPS_MIN[0] / (24 * 60),
      newEF        : clamp(entry.ef + EF_DELTA.hard, EF_MIN, EF_MAX),
      newSrsLevel  : 0,
    };
  }

  const newEF = clamp(entry.ef + EF_DELTA[ease], EF_MIN, EF_MAX);

  if (ease === 'medium') {
    // Progression prudente : intervalle × EF × 0.8
    const raw = Math.max(1, Math.round(entry.interval * newEF * 0.8));
    return {
      newInterval  : raw,
      newEF,
      newSrsLevel  : Math.min(7, entry.srsLevel + 1),
    };
  }

  /* easy : progression pleine */
  const raw = Math.max(1, Math.round(entry.interval * newEF));
  return {
    newInterval  : raw,
    newEF,
    newSrsLevel  : Math.min(7, entry.srsLevel + 1),
  };
}


/* ── API publique ────────────────────────────────────────────────── */

/**
 * Met à jour l'entrée SRS après une évaluation en mode flashcard.
 * C'est la fonction principale à appeler après chaque carte.
 *
 * @param {string}  wordId
 * @param {'hard'|'medium'|'easy'} ease
 * @returns {Object} entry mise à jour (pour affichage immédiat si besoin)
 */
function updateSRSFlashcard(wordId, ease) {
  const entry = getSRSEntry(wordId);
  const now   = Date.now();

  const { newInterval, newEF, newSrsLevel } = computeNextInterval(entry, ease);

  /* Mise à jour des compteurs */
  const isHard = ease === 'hard';
  entry.totalReviews++;
  entry.srsLevel    = newSrsLevel;
  entry.ef          = newEF;
  entry.interval    = newInterval;
  entry.lastSeen    = now;
  entry.nextReview  = now + Math.round(newInterval * MS_PER_DAY);

  if (isHard) {
    entry.streak     = 0;
    entry.lapses++;
    entry.consLapses++;
  } else {
    entry.streak++;
    entry.consLapses = 0;
  }

  entry.isLeech = entry.consLapses >= LEECH_THRESHOLD;

  setSRSEntry(wordId, entry);

  /* Vibration haptique sur mobile en cas d'erreur */
  if (isHard && navigator.vibrate) navigator.vibrate([40, 30, 40]);

  return entry;
}

/**
 * Met à jour l'entrée SRS après une réponse en mode quiz (QCM).
 * Binaire correct/incorrect, mais avec la même logique SM-2.
 *
 * @param {string}  wordId
 * @param {boolean} correct
 * @returns {Object} entry mise à jour
 */
function updateSRSQuiz(wordId, correct) {
  return updateSRSFlashcard(wordId, correct ? 'easy' : 'hard');
}

/**
 * Retourne tous les mots dont la révision SRS est due maintenant.
 * Exclut les leeches (ils sont traités séparément).
 * Applique un cap pour éviter la surcharge.
 *
 * @returns {Array<Object>} mots (références vers store.db)
 */
function getDueWords() {
  const now      = Date.now();
  const allWords = Object.values(store.db).flat();

  const due = allWords.filter(w => {
    const e = store.srsData[w.id];
    if (!e || !e.lastSeen) return false;
    return e.nextReview <= now;
  });

  /* Trier par retard décroissant (les plus en retard en premier) */
  due.sort((a, b) => {
    const ea = store.srsData[a.id];
    const eb = store.srsData[b.id];
    return (ea.nextReview - eb.nextReview); // plus anciens en premier
  });

  return due.slice(0, SESSION_DUE_CAP);
}

/**
 * Construit la file de cartes pour une session flashcard.
 *
 * Priorité :
 *   1. Mots en retard (nextReview dépassé) — triés par retard décroissant
 *   2. Nouveaux mots (jamais vus) — jusqu'à SESSION_NEW_CAP
 *   3. Mots à venir (pour compléter si la session est trop courte)
 *
 * @param {Array}  wordList - pool de mots du niveau sélectionné
 * @param {number} [size]   - taille de la session (défaut SESSION_TARGET)
 * @returns {Array}
 */
function buildFlashcardQueue(wordList, size = SESSION_TARGET) {
  const now = Date.now();

  const due = [];
  const fresh = [];
  const coming = [];

  for (const w of wordList) {
    const e = store.srsData[w.id];
    if (!e || !e.lastSeen) {
      fresh.push(w);
    } else if (e.nextReview <= now) {
      due.push(w);
    } else {
      coming.push(w);
    }
  }

  /* Trier les dus : plus en retard d'abord */
  due.sort((a, b) => {
    const ea = store.srsData[a.id];
    const eb = store.srsData[b.id];
    return ea.nextReview - eb.nextReview;
  });

  /* Nouveaux : shufflés pour la variété */
  shuffleArray(fresh);

  /* Assemblage : dus (cap) + nouveaux (cap) + à venir si besoin */
  const dueCapped   = due.slice(0, Math.min(SESSION_DUE_CAP, size));
  const remaining   = size - dueCapped.length;
  const newAllowed  = Math.min(SESSION_NEW_CAP, remaining);
  const freshPicked = fresh.slice(0, newAllowed);

  const fillNeeded  = size - dueCapped.length - freshPicked.length;
  const filler      = fillNeeded > 0 ? coming.slice(0, fillNeeded) : [];

  return [...dueCapped, ...freshPicked, ...filler];
}

/**
 * Retourne les mots identifiés comme leeches dans un pool donné.
 * @param {Array} wordList
 * @returns {Array}
 */
function getLeechWords(wordList) {
  return wordList.filter(w => store.srsData[w.id]?.isLeech);
}

/**
 * Réinitialise complètement l'entrée SRS d'un mot (utile pour les leeches).
 * @param {string} wordId
 */
function resetSRSEntry(wordId) {
  setSRSEntry(wordId, {
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
  });
}

/**
 * Retourne un label lisible décrivant la prochaine révision d'un mot.
 * @param {string} wordId
 * @returns {string}
 */
function getNextReviewLabel(wordId) {
  const e = store.srsData[wordId];
  if (!e || !e.lastSeen)       return 'Nouveau';
  if (e.isLeech)               return '⚠️ Leech';
  const diff = e.nextReview - Date.now();
  if (diff <= 0)               return 'À réviser';
  if (diff < MS_PER_DAY)      return `Dans ${Math.ceil(diff / (60_000 * 60))} h`;
  return `Dans ${Math.ceil(diff / MS_PER_DAY)} j`;
}

/**
 * Retourne un objet de statistiques SRS globales sur un pool de mots.
 * Utile pour le menu et les écrans de résultat.
 * @param {Array} wordList
 * @returns {{ new: number, learning: number, review: number, mature: number, due: number, leech: number }}
 */
function getSRSStats(wordList) {
  const now    = Date.now();
  const counts = { new: 0, learning: 0, review: 0, mature: 0, due: 0, leech: 0 };

  for (const w of wordList) {
    const e = store.srsData[w.id];
    if (!e || !e.lastSeen) { counts.new++; continue; }
    if (e.isLeech)           counts.leech++;
    if (e.nextReview <= now) counts.due++;
    if (e.interval < 1)        counts.learning++;
    else if (e.interval < 21)  counts.review++;
    else                       counts.mature++;
  }
  return counts;
}

/* ── Utilitaire ─────────────────────────────────────────────────── */

/**
 * Mélange un tableau en place (Fisher-Yates).
 * @param {Array} arr
 * @returns {Array}
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
