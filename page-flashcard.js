'use strict';
/* page-flashcard.js — Écran Flashcard (flashcard.html?mode=normal&level=1 | ?mode=all | ?mode=leech | ?mode=mastered) */

const fcParams = new URLSearchParams(location.search);
const fcMode   = fcParams.get('mode')  || 'normal';
const fcLevel  = fcParams.get('level') || '1';

let flashQueue          = [];
let flashIndex          = 0;
let flashCurrentItem    = null;
let flashIsFlipped      = false;
let flashIsJpFr         = true;
let flashStats          = { blackout: 0, hard: 0, medium: 0, easy: 0 };
let flashSessionUpdated = new Set();

function buildQueueForMode() {
  if (fcMode === 'leech')    return { queue: buildLeechQueue(Object.values(state.db).flat()), throttled: false };
  if (fcMode === 'mastered') return { queue: buildMatureReviewQueue(Object.values(state.db).flat()), throttled: false };

  const wordList = fcMode === 'all' ? Object.values(state.db).flat() : (state.db[fcLevel] || []);
  const globalBacklog = getBacklogCount(Object.values(state.db).flat()); // srs.js
  const throttled = globalBacklog > BACKLOG_THROTTLE_THRESHOLD;
  const quota = {
    dailyRemaining: throttled ? 0 : getDailyRemaining(),
    sessionCap:     throttled ? 0 : SESSION_NEW_WORD_CAP,
  };
  return { queue: buildFlashcardQueue(wordList, quota), throttled };
}

/** Affiche la carte courante (face recto). */
function renderFlashCard() {
  if (flashIndex >= flashQueue.length) {
    finishFlashSession();
    return;
  }

  const item = flashQueue[flashIndex];
  const w    = item.word;
  flashCurrentItem = item;
  flashIsFlipped   = false;
  flashIsJpFr      = item.dir === 'read';

  const progFill = document.getElementById('flash-prog-fill');
  const progText = document.getElementById('flash-prog-text');
  progFill.style.width = Math.round((flashIndex / flashQueue.length) * 100) + '%';
  progText.textContent = (flashIndex + 1) + ' / ' + flashQueue.length;

  const e = getSRSEntry(item.cardId); // srs.js
  const stateBadge = document.getElementById('flash-badge-state');
  const levelBadge = document.getElementById('flash-badge-level');
  if (e.totalReviews === 0)            stateBadge.textContent = 'Nouveau';
  else if (e.isLeech)                  stateBadge.textContent = 'Difficile';
  else if (e.nextReview <= Date.now()) stateBadge.textContent = 'À réviser';
  else                                  stateBadge.textContent = 'Vu';
  levelBadge.textContent = (flashIsJpFr ? 'Lecture' : 'Prod.') + ' · Niv. ' + e.srsLevel;

  const cfDir  = document.getElementById('cf-dir');
  const cfMain = document.getElementById('cf-main');
  const cfKana = document.getElementById('cf-kana');
  if (flashIsJpFr) {
    cfDir.textContent  = 'JP → FR';
    cfMain.className   = 'cf-main';
    cfMain.textContent = w.kanji;
    cfKana.textContent = w.kana;
    cfKana.style.display = '';
  } else {
    cfDir.textContent  = 'FR → JP';
    cfMain.className   = 'cf-main cf-latin';
    cfMain.textContent = w.fr;
    cfKana.textContent = '';
    cfKana.style.display = 'none';
  }

  document.getElementById('flash-card').classList.remove('flipped');
  document.getElementById('rate-grid').classList.add('hidden');
  document.getElementById('flash-tip').classList.remove('hidden');
}

function flipFlashCard() {
  if (flashIsFlipped) return;
  flashIsFlipped = true;

  const item = flashCurrentItem;
  const w    = item.word;
  document.getElementById('flash-card').classList.add('flipped');

  const cbAnswer  = document.getElementById('cb-answer');
  const cbExample = document.getElementById('cb-example');
  if (flashIsJpFr) {
    cbAnswer.textContent = w.fr;
  } else {
    cbAnswer.innerHTML = `<span class="cb-jp">${escHtml(w.kanji)}</span><span class="cb-kana">${escHtml(w.kana)}</span>`;
  }
  cbExample.textContent = w.ex || '';

  ['blackout', 'hard', 'medium', 'easy'].forEach(ease => {
    const el = document.getElementById('ri-' + ease);
    if (el) el.textContent = previewIntervalLabel(item.cardId, ease); // srs.js
  });

  document.getElementById('flash-tip').classList.add('hidden');
  document.getElementById('rate-grid').classList.remove('hidden');
}

/**
 * Évalue la carte et passe à la suivante. Verrou anti-inflation : une
 * carte déjà notée avec succès cette session ne touche plus le
 * calendrier sur ses passages suivants (mémoire court terme ≠
 * rétention) — sauf Black-out, qui compte toujours et déverrouille.
 */
function rateFlashCard(ease) {
  if (!flashIsFlipped || !flashCurrentItem) return;
  const item = flashCurrentItem;

  const alreadyFinalized = flashSessionUpdated.has(item.cardId);

  if (ease !== 'blackout' && alreadyFinalized) {
    flashStats[ease] = (flashStats[ease] || 0) + 1;
    flashIndex++;
    renderFlashCard();
    return;
  }

  const eBefore = getSRSEntry(item.cardId);
  const wasNew  = eBefore.totalReviews === 0;

  const { justMastered } = updateSRSFlashcard(item.cardId, ease); // srs.js
  flashStats[ease] = (flashStats[ease] || 0) + 1;

  if (ease === 'blackout') flashSessionUpdated.delete(item.cardId);
  else flashSessionUpdated.add(item.cardId);

  const base = ANKI_RATING_POINTS[ease] || 0;
  if (base > 0) {
    const gained = applyBoost(base);
    state.permTotal     += gained;
    state.lifetimeTotal += gained;
    Cloud.logPoints(gained).catch(() => { /* best-effort */ });
  }

  if (wasNew && fcMode === 'normal') incrementDailyNewCount();
  if (justMastered) awardMasteryBonus();

  save();

  if (ease === 'blackout') {
    reinsertInSession(flashQueue, flashIndex, item, 1, 3); // srs.js
  }

  flashIndex++;
  renderFlashCard();
}

function finishFlashSession() {
  const s = flashStats;
  const total = (s.blackout || 0) + (s.hard || 0) + (s.medium || 0) + (s.easy || 0);

  sessionStorage.setItem('jc_flashdone', JSON.stringify({
    total, easy: s.easy || 0, retravailler: (s.blackout || 0) + (s.hard || 0),
    dueLeft: getDueWords().length, mode: fcMode, level: fcLevel,
  }));

  pushFullProgress();
  location.href = `flashdone.html?mode=${fcMode}&level=${fcLevel}`;
}

function bindFlashEvents() {
  document.getElementById('flash-card').addEventListener('click', flipFlashCard);
  ['blackout', 'hard', 'medium', 'easy'].forEach(ease => {
    document.getElementById('rate-' + ease).addEventListener('click', () => rateFlashCard(ease));
  });

  document.addEventListener('keydown', e => {
    const activeTag = (document.activeElement && document.activeElement.tagName) || '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if ((e.key === ' ' || e.key === 'Enter') && !flashIsFlipped) { e.preventDefault(); flipFlashCard(); return; }
    if (flashIsFlipped) {
      const easeMap = { '1':'blackout', '2':'hard', '3':'medium', '4':'easy' };
      if (easeMap[e.key]) rateFlashCard(easeMap[e.key]);
    }
  });
}

(async function initFlashcardPage() {
  await initCore();
  bindFlashEvents();

  const { queue, throttled } = buildQueueForMode();
  if (queue.length === 0) {
    const msg = fcMode === 'leech'    ? '😌 Aucun mot difficile en ce moment !'
              : fcMode === 'mastered' ? "Aucun mot maîtrisé pour l'instant — continue l'Anki !"
              : 'Rien à réviser pour le moment — reviens plus tard !';
    toast(msg);
    setTimeout(() => { location.href = 'index.html'; }, 1600);
    return;
  }
  if (throttled) toast('⏸️ Trop de retard accumulé — on se concentre sur le rattrapage avant les nouveaux mots');
  if (fcMode === 'leech')    toast(`💀 Mode mots difficiles — ${queue.length} cartes`);
  if (fcMode === 'mastered') toast(`✅ Révision des mots maîtrisés — ${queue.length} cartes`);

  flashQueue = queue;
  if (fcMode === 'normal' || fcMode === 'all') recordActivity();

  renderFlashCard();
})();
