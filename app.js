'use strict';
/* ═══════════════════════════════════════════════════════════
   app.js — J-Core 2000 v4.0 · Hiro Edition
   Architecture : état centralisé, Anki principal, QCM secondaire
   srs.js doit être chargé avant ce fichier.
═══════════════════════════════════════════════════════════ */

/* ══════════════════════
   RANGS (16 grades)
══════════════════════ */
const RANKS = [
  { id:'mukyu',    label:'Mukyū',    jp:'無級', icon:'⬜', min:0     },
  { id:'r6kyu',   label:'Rokkyu',   jp:'六級', icon:'⬜', min:50    },
  { id:'r5kyu',   label:'Gokyu',    jp:'五級', icon:'🟦', min:150   },
  { id:'r4kyu',   label:'Yonkyu',   jp:'四級', icon:'🟦', min:300   },
  { id:'r3kyu',   label:'Sankyu',   jp:'三級', icon:'🟩', min:500   },
  { id:'r2kyu',   label:'Nikkyu',   jp:'二級', icon:'🟩', min:750   },
  { id:'r1kyu',   label:'Ikkyu',    jp:'一級', icon:'🟫', min:1100  },
  { id:'shodan',  label:'Shodan',   jp:'初段', icon:'⬛', min:1500  },
  { id:'nidan',   label:'Nidan',    jp:'二段', icon:'⬛', min:2100  },
  { id:'sandan',  label:'Sandan',   jp:'三段', icon:'🟪', min:2800  },
  { id:'yondan',  label:'Yondan',   jp:'四段', icon:'🟪', min:3700  },
  { id:'godan',   label:'Godan',    jp:'五段', icon:'🟥', min:4800  },
  { id:'rokudan', label:'Rokudan',  jp:'六段', icon:'🟥', min:6200  },
  { id:'nanadan', label:'Nanadan',  jp:'七段', icon:'🏅', min:8000  },
  { id:'hachidan',label:'Hachidan', jp:'八段', icon:'👑', min:10000 },
  { id:'hanshi',  label:'Hanshi',   jp:'範士', icon:'⚡', min:13000 },
];
const MAX_RANK = RANKS[RANKS.length - 1];

function getRank(pts)  {
  let r = RANKS[0];
  for (const x of RANKS) { if (pts >= x.min) r = x; else break; }
  return r;
}
function getNextRank(pts) {
  for (let i = 0; i < RANKS.length; i++) {
    if (RANKS[i].min > pts) return { r: RANKS[i], i };
  }
  return null;
}
function getRankPct(pts) {
  const nr = getNextRank(pts);
  if (!nr) return 100;
  const prev  = RANKS[nr.i - 1];
  return Math.min(100, Math.round(((pts - prev.min) / (nr.r.min - prev.min)) * 100));
}

/* ══════════════════════
   ÉTAT CENTRALISÉ
══════════════════════ */
const state = {
  /* DB chargée depuis les <script> mots_N.json */
  db: { '1':[], '2':[], '3':[], '4':[] },

  /* Persistance */
  hs:         {},   // { level_diff: score }
  permTotal:  0,    // points permanents → rang
  rebirths:   0,
  srsData:    {},   // { wordId: SRSEntry }

  /* Session QCM */
  currentLevel: null,
  wordList:     [],
  diff:         'normal',
  timerOn:      true,
  questionTime: 15,
  lives:        3,
  maxLives:     3,
  score:        0,
  combo:        0,
  bestCombo:    0,
  totalAns:     0,
  wrongAns:     0,
  gameStart:    0,
  curWord:      null,
  curOpts:      [],
  isJpFr:       true,
  furiVisible:  false,
  answered:     false,
  timerInt:     null,
  timeLeft:     0,

  /* Session Flashcard */
  flashPool:      [],  // tous les mots du niveau choisi
  flashQueue:     [],  // file ordonnée par priorité SRS
  flashIndex:     0,
  flashCurrent:   null,
  flashIsFlipped: false,
  flashIsJpFr:    true,
  flashEasy:      0,   // compteurs session
  flashMedium:    0,
  flashHard:      0,

  /* UI */
  currentScreen: 'menu',
  easterClicks:  0,
  easterActive:  false,
};

/* Alias pour srs.js qui référence window.store */
window.store = state;

/* ══════════════════════
   PERSISTANCE
══════════════════════ */
const LS = {
  hs:      'jc4_hs',
  total:   'jc4_total',
  rebirth: 'jc4_rebirth',
  srs:     'jc4_srs',
};

function loadStorage() {
  try { state.hs        = JSON.parse(localStorage.getItem(LS.hs)     || '{}'); } catch { state.hs = {}; }
  try { state.permTotal = parseInt(localStorage.getItem(LS.total)    || '0') || 0; } catch { /**/ }
  try { state.rebirths  = parseInt(localStorage.getItem(LS.rebirth)  || '0') || 0; } catch { /**/ }
  try { state.srsData   = JSON.parse(localStorage.getItem(LS.srs)    || '{}'); } catch { state.srsData = {}; }
}

function save() {
  try { localStorage.setItem(LS.hs,      JSON.stringify(state.hs)); }          catch { /**/ }
  try { localStorage.setItem(LS.total,   String(state.permTotal)); }            catch { /**/ }
  try { localStorage.setItem(LS.rebirth, String(state.rebirths)); }             catch { /**/ }
  try { localStorage.setItem(LS.srs,     JSON.stringify(state.srsData)); }      catch { /**/ }
}

/* ══════════════════════
   NAVIGATION
══════════════════════ */
const BACK_MAP = {
  config:    'menu',
  wordlist:  'config',
  flashcard: 'menu',
  flashdone: 'menu',
  game:      'config',
  gameover:  'menu',
};

function goTo(name) {
  document.querySelectorAll('[data-screen]').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === name);
  });
  state.currentScreen = name;
  // Bouton retour : visible partout sauf menu et loading
  const back = document.getElementById('global-back');
  const showBack = name !== 'menu' && name !== 'loading';
  back.classList.toggle('visible', showBack);
  window.scrollTo(0, 0);
}

function goBack() {
  const dest = BACK_MAP[state.currentScreen] || 'menu';
  // Si on quitte le jeu, stopper le timer
  if (state.currentScreen === 'game') clearInterval(state.timerInt);
  goTo(dest);
  if (dest === 'menu') renderMenu();
}

/* ══════════════════════
   AUDIO
══════════════════════ */
function speak(text) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP'; u.rate = 0.88; u.pitch = 1;
  window.speechSynthesis.speak(u);
}

/* ══════════════════════
   THÈME
══════════════════════ */
function initTheme() {
  const saved = localStorage.getItem('jc4_theme') || 'dark';
  applyTheme(saved);
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('theme-icon').textContent = t === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('jc4_theme', t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ══════════════════════
   CHARGEMENT DB
══════════════════════ */
function loadDB() {
  goTo('loading');
  const fill   = document.getElementById('ld-fill');
  const status = document.getElementById('ld-status');

  /* Lecture des variables globales injectées par les <script> */
  const sources = [
    ['1', typeof mots_1 !== 'undefined' ? mots_1 : []],
    ['2', typeof mots_2 !== 'undefined' ? mots_2 : []],
    ['3', typeof mots_3 !== 'undefined' ? mots_3 : []],
    ['4', typeof mots_4 !== 'undefined' ? mots_4 : []],
  ];

  let loaded = 0;
  for (const [key, raw] of sources) {
    state.db[key] = validateWords(raw, key);
    loaded += state.db[key].length;
  }

  fill.style.width = '100%';

  if (loaded === 0) {
    status.textContent = '❌ Aucune donnée trouvée';
    document.querySelector('.loading-wrap').innerHTML +=
      '<div style="margin-top:20px;color:var(--red);font-size:.82rem;text-align:left">' +
      'Vérifie que les fichiers <code>data/mots_1.json…mots_4.json</code> existent ' +
      'et que tu utilises Live Server (pas un double-clic sur index.html).</div>' +
      '<button class="btn-ghost" style="margin-top:16px" onclick="location.reload()">🔄 Réessayer</button>';
    return;
  }

  setTimeout(() => {
    renderMenu();
    goTo('menu');
  }, 350);
}

function validateWords(raw, key) {
  if (!Array.isArray(raw)) { console.warn(`mots_${key}: pas un tableau`); return []; }
  const out = [];
  for (const w of raw) {
    if (!w.id || !w.kanji || !w.kana || !w.fr) continue;
    out.push({ id: String(w.id), kanji: String(w.kanji), kana: String(w.kana), fr: String(w.fr), ex: w.ex ? String(w.ex) : '' });
  }
  return out;
}

/* ══════════════════════
   MENU
══════════════════════ */
function renderMenu() {
  /* High scores */
  ['1','2','3','4'].forEach(l => {
    let best = 0;
    ['normal','hard','blitz'].forEach(d => { best = Math.max(best, state.hs[`${l}_${d}`] || 0); });
    const el = document.getElementById(`hs-${l}`);
    if (el) el.textContent = best > 0 ? `HS ${best}` : '';
  });

  /* Rang */
  const rank = getRank(state.permTotal);
  const nr   = getNextRank(state.permTotal);
  const pct  = getRankPct(state.permTotal);
  document.getElementById('mrc-name').textContent = `${rank.label} ${rank.jp}`;
  document.getElementById('mrc-pts').textContent  = `${state.permTotal} pts`;
  document.getElementById('mrc-badge').textContent = rank.icon;
  document.getElementById('mrc-bar').style.width  = pct + '%';
  document.getElementById('mrc-curr').textContent = rank.label;
  document.getElementById('mrc-next').textContent = nr
    ? `→ ${nr.r.label} (${nr.r.min} pts)`
    : 'Rang maximum !';

  /* Rebirth */
  const rb = document.getElementById('rebirth-banner');
  if (rank.id === MAX_RANK.id) {
    rb.classList.remove('hidden');
    document.getElementById('rebirth-count').textContent =
      state.rebirths > 0 ? `×${state.rebirths}` : '';
  } else {
    rb.classList.add('hidden');
  }

  /* Stats Anki sur tous les mots */
  const allWords = Object.values(state.db).flat();
  const stats    = getSRSStats(allWords);
  document.getElementById('anki-new-count').textContent    = stats.new;
  document.getElementById('anki-due-count').textContent    = stats.due;
  document.getElementById('anki-mature-count').textContent = stats.mature;

  /* Grille des rangs */
  const grid = document.getElementById('ranks-grid');
  grid.innerHTML = '';
  RANKS.forEach(r => {
    const d = document.createElement('div');
    d.className = 'rk-chip' + (r.id === rank.id ? ' cur' : '');
    d.innerHTML =
      `<span class="rk-icon">${r.icon}</span>` +
      `<span class="rk-lbl">${r.label}</span>` +
      `<span class="rk-pts">${r.min}pts</span>`;
    grid.appendChild(d);
  });
}

/* ══════════════════════
   REBIRTH
══════════════════════ */
function openRebirthModal()  { document.getElementById('rebirth-modal').classList.remove('hidden'); }
function closeRebirthModal() { document.getElementById('rebirth-modal').classList.add('hidden'); }
function doRebirth() {
  state.rebirths++;
  state.permTotal = 0;
  /* Les données SRS sont conservées */
  save();
  closeRebirthModal();
  renderMenu();
  toast(`🔄 Rebirth #${state.rebirths} — bonne chance !`);
}

/* ══════════════════════
   POINTS → RANG
   Utilisé par Anki ET QCM pour alimenter le rang permanent.
══════════════════════ */

/**
 * Ajoute des points permanents et retourne si un rang a été gagné.
 * @param {number} pts
 * @returns {{ rankUp: boolean, prev: Object, now: Object }}
 */
function addPermanentPoints(pts) {
  const prev = getRank(state.permTotal);
  state.permTotal += pts;
  const now  = getRank(state.permTotal);
  save();
  return { rankUp: now.id !== prev.id, prev, now };
}

/* ══════════════════════
   SÉLECTION NIVEAU
══════════════════════ */
function selectLevel(l) {
  state.currentLevel = l;
  state.wordList = l === 'ALL'
    ? Object.values(state.db).flat()
    : (state.db[l] || []);

  if (state.wordList.length < 4) {
    toast('Données manquantes pour ce niveau.');
    return;
  }

  document.getElementById('cfg-title').textContent =
    l === 'ALL' ? 'Tous les niveaux' : `Niveau 0${l}`;
  document.getElementById('cfg-sub').textContent =
    `${state.wordList.length} mots disponibles`;

  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.diff-btn[data-diff="${state.diff}"]`).classList.add('active');
  updateTimerHint();
  goTo('config');
}

function setDiff(d) {
  state.diff        = d;
  state.questionTime = d === 'normal' ? 15 : d === 'hard' ? 10 : 6;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.diff-btn[data-diff="${d}"]`).classList.add('active');
  updateTimerHint();
}

function updateTimerHint() {
  document.getElementById('timer-hint').textContent = state.timerOn
    ? `Activé — ${state.questionTime}s par question`
    : 'Désactivé — prends ton temps';
}

function toggleTimer() {
  state.timerOn = !state.timerOn;
  document.getElementById('timer-toggle').classList.toggle('active', state.timerOn);
  document.getElementById('timer-toggle').setAttribute('aria-checked', state.timerOn);
  updateTimerHint();
}

/* ══════════════════════
   LISTE DE MOTS
══════════════════════ */
function showWordList() {
  renderWordList(state.wordList);
  document.getElementById('list-search').value = '';
  goTo('wordlist');
}

function renderWordList(list) {
  document.getElementById('list-count').textContent = `${list.length} mots`;
  const el = document.getElementById('word-list');
  el.innerHTML = '';
  list.forEach(w => {
    const d = document.createElement('div');
    d.className = 'word-item';
    d.innerHTML =
      `<div><div class="wi-jp">${esc(w.kanji)}</div><div class="wi-kana">${esc(w.kana)}</div></div>` +
      `<div class="wi-fr">${esc(w.fr)}</div>`;
    el.appendChild(d);
  });
}

function filterWordList(q) {
  q = q.toLowerCase().trim();
  renderWordList(state.wordList.filter(w =>
    w.kanji.includes(q) || w.kana.includes(q) || w.fr.toLowerCase().includes(q)
  ));
}

/* ══════════════════════
   MODE FLASHCARD (principal)
══════════════════════ */

/**
 * Démarre une session flashcard sur un pool de mots.
 * Tous les mots sont inclus, triés par priorité SRS.
 * @param {Array}  pool  — mots (niveau ou tous)
 * @param {string} label — titre de session
 */
function startFlashSession(pool, label) {
  if (!pool || pool.length === 0) { toast('Aucun mot disponible.'); return; }

  state.flashPool     = pool;
  state.flashQueue    = buildFlashcardQueue(pool); // srs.js
  state.flashIndex    = 0;
  state.flashCurrent  = null;
  state.flashIsFlipped = false;
  state.flashEasy     = 0;
  state.flashMedium   = 0;
  state.flashHard     = 0;

  goTo('flashcard');
  showFlashCard();
}

/** Affiche la carte courante (recto). */
function showFlashCard() {
  if (state.flashIndex >= state.flashQueue.length) {
    endFlashSession();
    return;
  }

  const w = state.flashQueue[state.flashIndex];
  state.flashCurrent   = w;
  state.flashIsFlipped = false;
  state.flashIsJpFr    = Math.random() > 0.45;

  /* Progression */
  const total = state.flashQueue.length;
  const cur   = state.flashIndex + 1;
  document.getElementById('flash-prog-fill').style.width = (cur / total * 100) + '%';
  document.getElementById('flash-prog-text').textContent = `${cur} / ${total}`;

  /* Badge SRS */
  const e = getSRSEntry(w.id); // srs.js
  const badgeState = document.getElementById('flash-badge-state');
  const badgeLevel = document.getElementById('flash-badge-level');
  badgeLevel.textContent = `Niv. ${e.srsLevel}`;
  if (!e.lastSeen) {
    badgeState.textContent = 'Nouveau';
    badgeState.className   = 'fbadge fsrs-new';
  } else if (e.nextReview <= Date.now()) {
    badgeState.textContent = 'À réviser';
    badgeState.className   = 'fbadge fsrs-due';
  } else {
    badgeState.textContent = getNextReviewLabel(w.id); // srs.js
    badgeState.className   = 'fbadge fsrs-ok';
  }

  /* Recto */
  const dirEl  = document.getElementById('cf-dir');
  const mainEl = document.getElementById('cf-main');
  const kanaEl = document.getElementById('cf-kana');

  if (state.flashIsJpFr) {
    dirEl.textContent    = 'JP → FR';
    mainEl.textContent   = w.kanji;
    mainEl.className     = 'cf-main';
    kanaEl.textContent   = w.kana;
    kanaEl.style.display = '';
  } else {
    dirEl.textContent    = 'FR → JP';
    mainEl.textContent   = w.fr;
    mainEl.className     = 'cf-main latin';
    kanaEl.style.display = 'none';
  }

  /* Masque le verso + boutons */
  document.getElementById('flash-card').classList.remove('flipped');
  document.getElementById('rate-grid').classList.add('hidden');
  document.getElementById('flash-tip').style.display = '';

  /* Masque les intervalles */
  ['hard','medium','easy'].forEach(k => {
    document.getElementById(`ri-${k}`).textContent = '';
  });

  if (w.kana) speak(w.kana);
}

/** Flip : révèle le verso et les boutons d'évaluation. */
function flipCard() {
  if (state.flashIsFlipped) return;
  state.flashIsFlipped = true;

  const w = state.flashCurrent;
  document.getElementById('flash-card').classList.add('flipped');

  /* Verso */
  const ansEl = document.getElementById('cb-answer');
  const exEl  = document.getElementById('cb-example');

  if (state.flashIsJpFr) {
    ansEl.textContent  = w.fr;
    ansEl.className    = 'cb-answer latin';
  } else {
    ansEl.innerHTML    = `${esc(w.kanji)} <small style="font-size:.65em;color:var(--text2)">${esc(w.kana)}</small>`;
    ansEl.className    = 'cb-answer';
  }
  exEl.textContent = w.ex || '';
  exEl.style.display = w.ex ? '' : 'none';

  /* Intervalles prévisionnels sur les boutons */
  const e = getSRSEntry(w.id);
  const labels = previewIntervals(e);
  document.getElementById('ri-hard').textContent   = labels.hard;
  document.getElementById('ri-medium').textContent = labels.medium;
  document.getElementById('ri-easy').textContent   = labels.easy;

  document.getElementById('rate-grid').classList.remove('hidden');
  document.getElementById('flash-tip').style.display = 'none';
}

/**
 * Calcule des labels d'intervalles prévisionnels (avant d'appliquer).
 */
function previewIntervals(e) {
  const MS = 86_400_000;
  const fmt = days => {
    if (days < 1)  return 'Bientôt';
    if (days < 30) return Math.round(days) + 'j';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return Math.round(days / 365) + 'an';
  };
  const BASE = [0, 1, 3, 7, 14, 30, 60, 120, 250];
  const ef   = e.ef;
  const hard_level   = Math.max(0, e.srsLevel - 2);
  const medium_level = e.streak >= 1 ? Math.min(8, e.srsLevel + 1) : e.srsLevel;
  const easy_level   = Math.min(8, e.srsLevel + 1);
  return {
    hard:   fmt(Math.max(1, BASE[hard_level]   || 1)),
    medium: fmt(Math.max(1, Math.round((BASE[medium_level] || 1) * ef * 0.8))),
    easy:   fmt(Math.max(1, Math.round((BASE[easy_level]   || 1) * ef))),
  };
}

/**
 * Évalue la carte et passe à la suivante.
 * • hard   → réinsère la carte 3–6 positions plus loin (dans la session)
 * • medium / easy → carte retirée de la session courante
 * Points permanents : easy = 2, medium = 1, hard = 0
 */
function rateCard(ease) {
  if (!state.flashIsFlipped || !state.flashCurrent) return;

  updateSRSFlashcard(state.flashCurrent.id, ease); // srs.js
  save();

  if (ease === 'hard') {
    state.flashHard++;
    const gap = 3 + Math.floor(Math.random() * 4);
    const pos = Math.min(state.flashQueue.length, state.flashIndex + 1 + gap);
    state.flashQueue.splice(pos, 0, state.flashCurrent);
  } else if (ease === 'medium') {
    state.flashMedium++;
    addPermanentPoints(1); // 1 pt par carte moyenne
  } else {
    state.flashEasy++;
    addPermanentPoints(2); // 2 pts par carte facile
  }

  state.flashIndex++;
  showFlashCard();
}

/** Fin de session flashcard. */
function endFlashSession() {
  const total = state.flashEasy + state.flashMedium + state.flashHard;
  const rank  = getRank(state.permTotal);

  /* Écran done */
  document.getElementById('done-stats').innerHTML =
    `✅ Facile : <strong>${state.flashEasy}</strong> &nbsp;` +
    `🟡 Moyen : <strong>${state.flashMedium}</strong> &nbsp;` +
    `❌ Difficile : <strong>${state.flashHard}</strong><br>` +
    `${total} cartes passées · +${state.flashEasy * 2 + state.flashMedium} pts`;
  document.getElementById('done-rank').textContent =
    `${rank.icon} ${rank.label} ${rank.jp} — ${state.permTotal} pts`;

  renderMenu();
  goTo('flashdone');
}

/* ══════════════════════
   MODE QCM (secondaire)
══════════════════════ */
function startGame() {
  if (!state.wordList || state.wordList.length < 4) {
    toast('Sélectionne un niveau d\'abord.');
    goTo('menu');
    return;
  }
  const livesMap = { normal: 3, hard: 2, blitz: 1 };
  state.maxLives  = state.easterActive ? 99 : (livesMap[state.diff] || 3);
  state.lives     = state.maxLives;
  state.score     = 0;
  state.combo     = 0;
  state.bestCombo = 0;
  state.totalAns  = 0;
  state.wrongAns  = 0;
  state.gameStart = Date.now();
  state.answered  = false;

  document.getElementById('hud-diff').textContent =
    state.diff.charAt(0).toUpperCase() + state.diff.slice(1) +
    (state.timerOn ? '' : ' ∞');

  goTo('game');
  buildStreakUI();
  renderLives();
  renderScore();
  nextQuestion();
}

/* ── Vies ── */
function renderLives() {
  const row = document.getElementById('hud-lives');
  row.innerHTML = '';
  if (state.maxLives > 8) {
    row.innerHTML = `<span style="font-family:var(--ff-mono);font-size:.9rem">❤ ×${state.lives}</span>`;
    return;
  }
  for (let i = 0; i < state.maxLives; i++) {
    const s = document.createElement('span');
    s.className = 'heart' + (i >= state.lives ? ' dead' : '');
    s.textContent = '❤';
    row.appendChild(s);
  }
}
function animateLoseLive() {
  const alive = document.querySelectorAll('.heart:not(.dead)');
  if (!alive.length) return;
  const last = alive[alive.length - 1];
  last.classList.add('anim');
  setTimeout(() => { last.classList.remove('anim'); last.classList.add('dead'); }, 250);
}

/* ── Streak ── */
function buildStreakUI() {
  const row = document.getElementById('streak-row');
  row.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'sdot';
    row.appendChild(d);
  }
}
function updateStreak() {
  const dots = document.querySelectorAll('.sdot');
  const pos  = state.combo % 5;
  const full = state.combo > 0 && pos === 0;
  dots.forEach((d, i) => {
    d.classList.remove('lit', 'max');
    if (full) d.classList.add('max');
    else if (i < pos) d.classList.add('lit');
  });
}

/* ── Score ── */
function renderScore() {
  const el = document.getElementById('score-num');
  el.textContent = state.score;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}
function renderCombo() {
  const el = document.getElementById('combo-disp');
  if (state.combo >= 3) {
    el.textContent = `×${state.combo}${state.combo >= 10 ? ' 💀' : ''}`;
  } else {
    el.textContent = '';
  }
}

/* ── Timer ── */
function startTimer() {
  clearInterval(state.timerInt);
  const wrap = document.getElementById('timer-wrap');
  const bar  = document.getElementById('timer-bar');
  if (!state.timerOn) { wrap.style.opacity = '0'; return; }
  wrap.style.opacity = '1';
  state.timeLeft = state.questionTime;
  bar.style.width = '100%';
  bar.style.background = 'var(--acc)';
  state.timerInt = setInterval(() => {
    state.timeLeft = Math.max(0, state.timeLeft - 0.1);
    const pct = (state.timeLeft / state.questionTime) * 100;
    bar.style.width = pct + '%';
    bar.style.background = pct > 60 ? 'var(--acc)' : pct > 30 ? 'var(--amber)' : 'var(--red)';
    if (state.timeLeft <= 0) { clearInterval(state.timerInt); onTimeout(); }
  }, 100);
}

function onTimeout() {
  if (state.answered) return;
  state.answered = true;
  state.combo = 0; state.wrongAns++; state.totalAns++; state.lives--;
  if (state.curWord) updateSRSQuiz(state.curWord.id, false);
  flash('rgba(248,113,113,.1)');
  animateLoseLive(); renderCombo(); updateStreak();
  toast('⏱ Temps écoulé');
  revealCorrect();
  if (state.lives <= 0) setTimeout(endGame, 1600);
  else setTimeout(nextQuestion, 1300);
}

/* ── Question ── */
function nextQuestion() {
  clearInterval(state.timerInt);
  state.answered    = false;
  state.furiVisible = false;
  updateFuriBtn();

  state.curWord = state.wordList[Math.floor(Math.random() * state.wordList.length)];
  const dist = [];
  while (dist.length < 3) {
    const rw = state.wordList[Math.floor(Math.random() * state.wordList.length)];
    if (rw.kanji !== state.curWord.kanji && !dist.find(d => d.kanji === rw.kanji))
      dist.push(rw);
  }
  state.curOpts = [state.curWord, ...dist].sort(() => Math.random() - 0.5);
  state.isJpFr  = Math.random() > 0.45;

  renderQuestion();
  startTimer();
  if (state.curWord.kana) speak(state.curWord.kana);
}

function renderQuestion() {
  const grid = document.getElementById('opts-grid');
  grid.innerHTML = '';
  const qw   = document.getElementById('q-word');
  const card = document.getElementById('q-card');
  card.classList.remove('ok', 'err');

  if (state.isJpFr) {
    document.getElementById('q-dir').textContent = 'JP → FR';
    qw.className = 'q-word';
    qw.innerHTML = state.furiVisible
      ? `<ruby>${esc(state.curWord.kanji)}<rt>${esc(state.curWord.kana)}</rt></ruby>`
      : esc(state.curWord.kanji);
    state.curOpts.forEach((o, i) => {
      const b = makeOptBtn(o.fr, false, o.kanji === state.curWord.kanji, i + 1);
      b.classList.add('fr-opt');
      grid.appendChild(b);
    });
  } else {
    document.getElementById('q-dir').textContent = 'FR → JP';
    qw.className = 'q-word latin';
    qw.textContent = state.curWord.fr;
    state.curOpts.forEach((o, i) => {
      const content = state.furiVisible
        ? `<ruby>${esc(o.kanji)}<rt>${esc(o.kana)}</rt></ruby>`
        : esc(o.kanji);
      grid.appendChild(makeOptBtn(content, true, o.kanji === state.curWord.kanji, i + 1));
    });
  }
  updateFuriBtn();
}

function makeOptBtn(content, isHtml, isCorrect, num) {
  const b = document.createElement('button');
  b.className = 'opt-btn';
  b.innerHTML = `<span class="kh">${num}</span>`;
  if (isHtml) b.innerHTML += content;
  else b.appendChild(document.createTextNode(content));
  b.dataset.ok = String(isCorrect);
  b.addEventListener('click', () => checkAnswer(b, isCorrect));
  return b;
}

function updateFuriBtn() {
  const btn = document.getElementById('furi-btn');
  const lbl = document.getElementById('furi-lbl');
  btn.classList.toggle('on', state.furiVisible);
  lbl.textContent = state.furiVisible ? 'Masquer' : 'Furigana';
}

function toggleFuri() {
  state.furiVisible = !state.furiVisible;
  const qw = document.getElementById('q-word');
  if (state.isJpFr) {
    qw.innerHTML = state.furiVisible
      ? `<ruby>${esc(state.curWord.kanji)}<rt>${esc(state.curWord.kana)}</rt></ruby>`
      : esc(state.curWord.kanji);
  } else {
    Array.from(document.getElementById('opts-grid').children).forEach((b, i) => {
      const o = state.curOpts[i]; if (!o) return;
      const kh = b.querySelector('.kh')?.outerHTML || '';
      b.innerHTML = kh + (state.furiVisible
        ? `<ruby>${esc(o.kanji)}<rt>${esc(o.kana)}</rt></ruby>`
        : esc(o.kanji));
    });
  }
  updateFuriBtn();
}

function checkAnswer(btn, isCorrect) {
  if (state.answered) return;
  state.answered = true;
  clearInterval(state.timerInt);
  state.totalAns++;

  if (state.curWord) updateSRSQuiz(state.curWord.id, isCorrect);
  if (state.curWord?.kana) speak(state.curWord.kana);

  if (isCorrect) {
    btn.classList.add('correct');
    document.getElementById('q-card').classList.add('ok');
    flash('rgba(74,222,128,.08)');
    state.score++; state.combo++;
    if (state.combo > state.bestCombo) state.bestCombo = state.combo;

    if (state.timerOn && state.timeLeft > state.questionTime * 0.75) {
      state.score++;
      spawnPop('+2 ⚡', btn);
    } else {
      spawnPop('+1', btn);
    }
    renderScore(); renderCombo(); updateStreak();

    /* Points permanents : +1 par bonne réponse QCM */
    addPermanentPoints(1);

    /* Milestones */
    const mt = { 10:'10 mots !', 25:'🔥 En feu', 50:'⚡ Mi-chemin', 100:'💀 Centurion', 200:'Rang S' };
    if (mt[state.score]) toast(mt[state.score]);
    const ct = { 5:'×5 combo 🔥', 10:'×10 Unstoppable 💀', 20:'×20 Indécent ⚡' };
    if (ct[state.combo]) toast(ct[state.combo]);

    Array.from(document.getElementById('opts-grid').children).forEach(b => b.disabled = true);
    setTimeout(nextQuestion, 280);
  } else {
    btn.classList.add('wrong');
    btn.disabled = true;
    flash('rgba(248,113,113,.08)');
    state.combo = 0; state.wrongAns++; state.lives--;
    animateLoseLive(); renderCombo(); updateStreak();
    if (state.lives <= 0) { revealCorrect(); setTimeout(endGame, 1800); }
    else state.answered = false;
  }
}

function revealCorrect() {
  Array.from(document.getElementById('opts-grid').children).forEach(b => {
    b.disabled = true;
    if (b.dataset.ok === 'true') b.classList.add('reveal');
  });
}

function spawnPop(txt, btn) {
  const pop = document.createElement('div');
  pop.className = 'score-pop';
  pop.textContent = txt;
  const r  = btn.getBoundingClientRect();
  const ar = document.getElementById('app').getBoundingClientRect();
  pop.style.left = `${r.left - ar.left + r.width / 2 - 14}px`;
  pop.style.top  = `${r.top  - ar.top  - 8}px`;
  document.getElementById('app').appendChild(pop);
  setTimeout(() => pop.remove(), 750);
}

/* ── Game Over ── */
function endGame() {
  clearInterval(state.timerInt);
  const elapsed  = Math.round((Date.now() - state.gameStart) / 1000);
  const acc      = state.totalAns > 0 ? Math.round(state.score / state.totalAns * 100) : 0;
  const newRank  = getRank(state.permTotal);

  /* Titre */
  const title = document.getElementById('go-title');
  const eyebrow = document.getElementById('go-eyebrow');
  if (state.score >= 100)      { title.className = 'go-title good'; title.textContent = 'Maître';   eyebrow.textContent = 'LÉGENDAIRE'; }
  else if (state.score >= 50)  { title.className = 'go-title good'; title.textContent = 'Solide';   eyebrow.textContent = 'BON RUN'; }
  else                         { title.className = 'go-title fail'; title.textContent = 'Echec';    eyebrow.textContent = 'RÉSULTAT'; }

  /* Stats */
  document.getElementById('st-score').textContent = state.score;
  document.getElementById('st-combo').textContent = state.bestCombo;
  document.getElementById('st-acc').textContent   = acc + '%';
  document.getElementById('st-time').textContent  = elapsed + 's';

  /* Rang */
  document.getElementById('grc-icon').textContent = newRank.icon;
  document.getElementById('grc-name').textContent = `${newRank.label} ${newRank.jp}`;
  document.getElementById('grc-pts').textContent  = `${state.permTotal} pts au total`;

  /* Record */
  const key = `${state.currentLevel}_${state.diff}`;
  const isRecord = state.score > (state.hs[key] || 0);
  if (isRecord) { state.hs[key] = state.score; save(); }
  document.getElementById('rec-banner').classList.toggle('hidden', !isRecord);

  /* Barre progression rang */
  const nr = getNextRank(state.permTotal);
  const nb = document.getElementById('nb-wrap');
  if (nr) {
    nb.style.display = '';
    document.getElementById('nb-left').textContent  = newRank.label;
    document.getElementById('nb-right').textContent = `${nr.r.label} (${nr.r.min} pts)`;
    const fill = document.getElementById('nb-fill');
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = getRankPct(state.permTotal) + '%'; }, 100);
  } else {
    nb.style.display = 'none';
  }

  document.getElementById('go-rank-card').className =
    'go-rank-card' + (newRank.id === MAX_RANK.id ? ' legend' : '');
  document.getElementById('grc-new').classList.add('hidden');

  document.getElementById('go-quote').textContent = pickQuote(state.score, acc, elapsed, state.bestCombo);
  renderMenu();
  goTo('gameover');
}

/* ══════════════════════
   CITATIONS
══════════════════════ */
function pickQuote(s, acc, elapsed, cmb) {
  let pool;
  if (s <= 5) pool = [
    "Ton Ryzen 9800X3D tourne à plein régime pour afficher un score de merde.",
    "Yuka a vomi en voyant ça. Elle a bloqué le numéro.",
    "Même un bot Valorant Silver a plus de vocabulaire.",
    "Tu vas te faire racketter par des collégiens à Sannomiya.",
    "C'est pathétique. Réfléchis à tes choix de vie.",
    "La Z33 pleure dans le garage.",
  ];
  else if (s <= 20) pool = [
    "T'as juste prouvé que tu sais cliquer. Parfois au bon endroit.",
    "Un gamin japonais de 6 ans t'éclate en dormant.",
    "Niveau touriste qui a regardé 10 min d'anime en 2015.",
    "Tu vas finir SDF à Shibuya avec ce vocabulaire.",
  ];
  else if (s <= 50) pool = [
    "Ça commence à ressembler à un cerveau fonctionnel.",
    "T'as le niveau pour survivre dans un konbini.",
    "Le projet Japon devient sérieux. Très lentement.",
    "Continue avant que les kanjis ressortent.",
  ];
  else if (s <= 100) pool = [
    "Sérieusement chaud. On parle d'un niveau correct.",
    "Tokyo commence à te sembler moins terrifiant.",
    "T'as de la mémoire musculaire sur les kanjis. Du vrai travail.",
    "La Z33 commence à ronronner.",
  ];
  else pool = [
    "Masterclass absolue. T'es prêt pour le vol direction Tokyo.",
    "Ton cerveau turbine plus vite que ton 9800X3D en mode turbo.",
    "Score de pur crack du vocabulaire japonais.",
    "Pure domination linguistique et intellectuelle.",
    "La Z33 fait des wheelspin sur tout le premier tour.",
  ];
  if (acc < 40 && state.totalAns > 10) pool.push("Moins de 40% de précision. T'as cliqué en dormant.");
  if (state.diff === 'blitz' && s > 30) pool.push("Mode Blitz, 30+ mots. Respect total.");
  if (s > 0 && acc === 100) pool.push("100% de précision. Soit t'es une machine, soit t'as triché.");
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ══════════════════════
   EFFETS VISUELS
══════════════════════ */
function flash(color) {
  const f = document.getElementById('sf');
  f.style.background = color; f.style.opacity = '1';
  setTimeout(() => { f.style.opacity = '0'; }, 110);
}

let _toastTimer;
function toast(msg) {
  let t = document.getElementById('toast-el');
  if (!t) { t = document.createElement('div'); t.id = 'toast-el'; t.className = 'toast'; document.body.appendChild(t); }
  clearTimeout(_toastTimer);
  t.textContent = msg;
  t.style.display = '';
  _toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2200);
}

/* ══════════════════════
   UTILITAIRES
══════════════════════ */
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ══════════════════════
   EASTER EGG
══════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const wm = document.getElementById('wordmark');
  if (wm) wm.addEventListener('click', () => {
    state.easterClicks++;
    if (state.easterClicks === 5)  toast('Mode Shifu activé — vies infinies 🐼');
    if (state.easterClicks === 5)  state.easterActive = true;
    if (state.easterClicks === 10) toast('Hiro King débloqué 👑');
  });
});

/* ══════════════════════
   RACCOURCIS CLAVIER
══════════════════════ */
document.addEventListener('keydown', e => {
  /* Flashcard */
  if (document.querySelector('[data-screen="flashcard"].active')) {
    if ((e.key === ' ' || e.key === 'Enter') && !state.flashIsFlipped) { e.preventDefault(); flipCard(); }
    if (state.flashIsFlipped) {
      if (e.key === '1') rateCard('hard');
      if (e.key === '2') rateCard('medium');
      if (e.key === '3') rateCard('easy');
    }
    return;
  }
  /* QCM */
  if (document.querySelector('[data-screen="game"].active')) {
    if (e.key === 'f' || e.key === 'F') { toggleFuri(); return; }
    const map = { '1':0, '2':1, '3':2, '4':3 };
    if (map[e.key] !== undefined) {
      const btns = Array.from(document.getElementById('opts-grid').children).filter(b => !b.disabled);
      btns[map[e.key]]?.click();
    }
  }
  /* Retour universel */
  if (e.key === 'Escape') goBack();
});

/* ══════════════════════
   BINDING ÉVÉNEMENTS
══════════════════════ */
function bindEvents() {
  /* Navigation globale */
  document.getElementById('global-back').addEventListener('click', goBack);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  /* Menu — niveaux */
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => selectLevel(btn.dataset.level));
  });
  document.getElementById('btn-all-levels').addEventListener('click', () => selectLevel('ALL'));

  /* Menu — Anki tous niveaux */
  document.getElementById('btn-anki-all').addEventListener('click', () => {
    const all = Object.values(state.db).flat();
    startFlashSession(all, 'Tous les niveaux — 2000 mots');
  });

  /* Menu — rebirth */
  document.getElementById('rebirth-banner').addEventListener('click', openRebirthModal);
  document.getElementById('rebirth-confirm').addEventListener('click', doRebirth);
  document.getElementById('rebirth-cancel').addEventListener('click', closeRebirthModal);

  /* Config */
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => setDiff(btn.dataset.diff));
  });
  document.getElementById('timer-toggle').addEventListener('click', toggleTimer);
  document.getElementById('btn-start-quiz').addEventListener('click', startGame);
  document.getElementById('btn-start-flash-level').addEventListener('click', () => {
    const label = state.currentLevel === 'ALL'
      ? 'Tous les niveaux'
      : `Niveau 0${state.currentLevel}`;
    startFlashSession(state.wordList, label);
  });
  document.getElementById('btn-show-list').addEventListener('click', showWordList);

  /* Liste mots */
  document.getElementById('list-search').addEventListener('input', e => filterWordList(e.target.value));

  /* Flashcard */
  document.getElementById('flash-card').addEventListener('click', flipCard);
  document.getElementById('rate-hard').addEventListener('click',   () => rateCard('hard'));
  document.getElementById('rate-medium').addEventListener('click', () => rateCard('medium'));
  document.getElementById('rate-easy').addEventListener('click',   () => rateCard('easy'));
  document.getElementById('btn-flash-again').addEventListener('click', () => {
    startFlashSession(state.flashPool, 'Nouvelle session');
  });
  document.getElementById('btn-flash-menu').addEventListener('click', () => { renderMenu(); goTo('menu'); });

  /* Furigana */
  document.getElementById('furi-btn').addEventListener('click', toggleFuri);

  /* Game over */
  document.getElementById('btn-replay').addEventListener('click', startGame);
  document.getElementById('btn-go-menu').addEventListener('click', () => { renderMenu(); goTo('menu'); });
}

/* ══════════════════════
   INIT
══════════════════════ */
function startApp() {
  initTheme();
  loadStorage();
  bindEvents();
  loadDB();
}

document.addEventListener('DOMContentLoaded', startApp);
