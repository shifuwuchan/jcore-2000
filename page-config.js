'use strict';
/* page-config.js — Écran Configuration (config.html?level=1|2|3|4|ALL) */

const params = new URLSearchParams(location.search);
const level  = params.get('level') || '1';

let diff    = 'normal';
let timerOn = true;
let questionTime = 15;

function wordsForLevel() {
  return level === 'ALL' ? Object.values(state.db).flat() : (state.db[level] || []);
}

function updateTimerHint() {
  document.getElementById('timer-hint').textContent = timerOn
    ? `Activé — ${questionTime}s par question`
    : 'Désactivé — prends ton temps';
}

function setDiff(d, el) {
  diff = d;
  questionTime = d === 'normal' ? 15 : d === 'hard' ? 10 : 6;
  document.querySelectorAll('.diff-btn[data-diff]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  updateTimerHint();
}

function toggleTimer() {
  timerOn = !timerOn;
  document.getElementById('timer-toggle').classList.toggle('active', timerOn);
  updateTimerHint();
}

function bindConfigEvents() {
  document.querySelectorAll('.diff-btn[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => setDiff(btn.dataset.diff, btn));
  });
  document.getElementById('timer-toggle').addEventListener('click', toggleTimer);

  document.getElementById('btn-start-quiz').addEventListener('click', () => {
    location.href = `game.html?level=${level}&diff=${diff}&timer=${timerOn ? 1 : 0}`;
  });
  document.getElementById('btn-start-flash-level').addEventListener('click', () => {
    location.href = `flashcard.html?mode=normal&level=${level}`;
  });
  document.getElementById('btn-show-list').addEventListener('click', () => {
    location.href = `wordlist.html?level=${level}`;
  });
}

(async function initConfigPage() {
  await initCore();

  const words = wordsForLevel();
  if (words.length < 4) {
    toast('Données manquantes pour ce niveau.');
  }
  document.getElementById('cfg-title').textContent = level === 'ALL' ? 'Tous les niveaux' : `Niveau 0${level}`;
  document.getElementById('cfg-sub').textContent    = `${words.length} mots disponibles`;

  updateTimerHint();
  bindConfigEvents();
})();
