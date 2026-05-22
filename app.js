/* ═══════════════════════════════════════════════════════
   app.js — J-Core 2000 · Hiro Edition
   Architecture : état centralisé + chargement async JSON
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════
   CONSTANTES — 16 GRADES
══════════════════════════════════════ */
const RANKS = [
  { id:'mukyu',    label:'Mukyū',    jp:'無級', icon:'⬜', min:0 },
  { id:'r6kyu',   label:'Rokkyu',   jp:'六級', icon:'⬜', min:50 },
  { id:'r5kyu',   label:'Gokyu',    jp:'五級', icon:'🟦', min:150 },
  { id:'r4kyu',   label:'Yonkyu',   jp:'四級', icon:'🟦', min:300 },
  { id:'r3kyu',   label:'Sankyu',   jp:'三級', icon:'🟩', min:500 },
  { id:'r2kyu',   label:'Nikkyu',   jp:'二級', icon:'🟩', min:750 },
  { id:'r1kyu',   label:'Ikkyu',    jp:'一級', icon:'🟫', min:1100 },
  { id:'shodan',  label:'Shodan',   jp:'初段', icon:'⬛', min:1500 },
  { id:'nidan',   label:'Nidan',    jp:'二段', icon:'⬛', min:2100 },
  { id:'sandan',  label:'Sandan',   jp:'三段', icon:'🟪', min:2800 },
  { id:'yondan',  label:'Yondan',   jp:'四段', icon:'🟪', min:3700 },
  { id:'godan',   label:'Godan',    jp:'五段', icon:'🟥', min:4800 },
  { id:'rokudan', label:'Rokudan',  jp:'六段', icon:'🟥', min:6200 },
  { id:'nanadan', label:'Nanadan',  jp:'七段', icon:'🏅', min:8000 },
  { id:'hachidan',label:'Hachidan', jp:'八段', icon:'👑', min:10000 },
  { id:'hanshi',  label:'Hanshi',   jp:'範士', icon:'⚡', min:13000 },
];
const MAX_RANK = RANKS[RANKS.length - 1];

/** Retourne le rang correspondant à un total de points. */
const getRank = pts => {
  let r = RANKS[0];
  for (const x of RANKS) { if (pts >= x.min) r = x; else break; }
  return r;
};

/** Retourne le prochain rang (ou null si au maximum). */
const getNext = pts => {
  for (let i = 0; i < RANKS.length; i++) {
    if (RANKS[i].min > pts) return { r: RANKS[i], i };
  }
  return null;
};

/* ══════════════════════════════════════
   ÉTAT CENTRALISÉ DE L'APPLICATION
══════════════════════════════════════ */
const state = {
  /* Base de données des mots (chargée depuis /data/) */
  db: {},            // { "1": [...], "2": [...], "3": [...], "4": [...] }

  /* Session de jeu en cours */
  currentLevel:  null,
  wordList:      [],
  lives:         3,
  maxLives:      3,
  score:         0,
  combo:         0,
  bestCombo:     0,
  totalAns:      0,
  wrongAns:      0,
  gameStart:     0,
  curWord:       null,
  curOpts:       [],
  isJpFr:        true,
  furiVisible:   false,
  answered:      false,

  /* Configuration */
  diff:          'normal',
  timerOn:       true,
  questionTime:  15,
  timerInt:      null,
  timeLeft:      0,

  /* Persistance (localStorage) */
  hs:            {},   // high scores par niveau/diff
  permTotal:     0,    // total de points cumulés (base du rang)
  rebirths:      0,    // nombre de rebirths effectués

  /* SRS — Spaced Repetition System */
  srsData:       {},   // { [wordId]: { srsLevel, nextReview } }

  /* Divers */
  kbOverlay:     null,
  easterClicks:  0,
  easterActive:  false,
};

/* ══════════════════════════════════════
   PERSISTANCE — localStorage
══════════════════════════════════════ */

/** Charge toutes les données sauvegardées depuis le localStorage. */
function loadStorage() {
  try { state.hs        = JSON.parse(localStorage.getItem('jc_hs5')     || '{}'); } catch { state.hs = {}; }
  try { state.permTotal = parseInt(localStorage.getItem('jc_total5')    || '0') || 0; } catch { /* ignore */ }
  try { state.rebirths  = parseInt(localStorage.getItem('jc_rebirth5')  || '0') || 0; } catch { /* ignore */ }
  try { state.srsData   = JSON.parse(localStorage.getItem('jc_srs')     || '{}'); } catch { state.srsData = {}; }
}

/** Sauvegarde l'état persistant dans le localStorage. */
function save() {
  try { localStorage.setItem('jc_hs5',      JSON.stringify(state.hs)); }       catch { /* ignore */ }
  try { localStorage.setItem('jc_total5',   String(state.permTotal)); }         catch { /* ignore */ }
  try { localStorage.setItem('jc_rebirth5', String(state.rebirths)); }          catch { /* ignore */ }
  try { localStorage.setItem('jc_srs',      JSON.stringify(state.srsData)); }   catch { /* ignore */ }
}

/* ══════════════════════════════════════
   SRS — SPACED REPETITION SYSTEM
   Logique inspirée d'Anki (intervalles x1, x2, x4, x8 jours)
══════════════════════════════════════ */

/** Intervalles SRS en millisecondes, indexés par srsLevel (0–5). */
const SRS_INTERVALS = [
  0,                    // level 0 : révision immédiate
  1  * 86400000,        // level 1 : 1 jour
  2  * 86400000,        // level 2 : 2 jours
  4  * 86400000,        // level 3 : 4 jours
  8  * 86400000,        // level 4 : 8 jours
  16 * 86400000,        // level 5 : 16 jours (maximum)
];

/**
 * Met à jour l'entrée SRS d'un mot après une réponse.
 * @param {string} wordId  - Identifiant unique du mot (ex. "1_42")
 * @param {boolean} correct - Vrai si la réponse était correcte
 */
function updateSRS(wordId, correct) {
  const entry = state.srsData[wordId] || { srsLevel: 0, nextReview: 0 };
  if (correct) {
    // Juste : on monte de niveau (max 5) et on programme la prochaine révision
    entry.srsLevel  = Math.min(5, entry.srsLevel + 1);
    entry.nextReview = Date.now() + SRS_INTERVALS[entry.srsLevel];
  } else {
    // Faux : reset au niveau 0 → révision immédiate
    entry.srsLevel  = 0;
    entry.nextReview = Date.now();
    // Vibration mobile sur erreur
    if (navigator.vibrate) navigator.vibrate(50);
  }
  state.srsData[wordId] = entry;
}

/**
 * Retourne les mots dont la révision SRS est due aujourd'hui.
 * @returns {Array} Liste de mots filtrés depuis toute la DB
 */
function getDailyReview() {
  const now = Date.now();
  const allWords = Object.values(state.db).flat();
  return allWords.filter(w => {
    const entry = state.srsData[w.id];
    // Un mot sans entrée SRS n'a jamais été étudié → exclu des révisions du jour
    // Seuls les mots déjà vus et dont nextReview est échu sont retenus
    if (!entry) return false;
    return entry.nextReview <= now;
  });
}

/* ══════════════════════════════════════
   AUDIO — Web Speech API (ja-JP)
══════════════════════════════════════ */

/**
 * Prononce un texte en japonais via speechSynthesis.
 * @param {string} text - Le kana ou kanji à prononcer
 */
function speak(text) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel(); // annule la parole en cours
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = 'ja-JP';
  utt.rate   = 0.9;
  utt.pitch  = 1;
  window.speechSynthesis.speak(utt);
}

/* ══════════════════════════════════════
   NAVIGATION — SYSTÈME D'ÉCRANS
══════════════════════════════════════ */

/**
 * Affiche l'écran demandé et masque les autres.
 * @param {string} name - Valeur de l'attribut data-screen
 */
function goTo(name) {
  document.querySelectorAll('[data-screen]').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === name);
  });
}

/* ══════════════════════════════════════
   CHARGEMENT DES DONNÉES (async/await)
   Fichiers JS dans /data/mots_1.js … mots_4.js
══════════════════════════════════════ */

/**
 * Charge les variables globales (mots_1, mots_2...), peuple state.db,
 * puis redirige vers le menu.
 */
async function loadDB() {
  goTo('loading');
  try {
    // On lit directement les variables chargées depuis les balises <script>
    state.db = {
      '1': typeof mots_1 !== 'undefined' ? mots_1 : [],
      '2': typeof mots_2 !== 'undefined' ? mots_2 : [],
      '3': typeof mots_3 !== 'undefined' ? mots_3 : [],
      '4': typeof mots_4 !== 'undefined' ? mots_4 : []
    };

    if (state.db['1'].length === 0) {
      throw new Error("Données introuvables. As-tu bien converti les fichiers en .js ?");
    }

    renderMenu();
    goTo('menu');
  } catch (e) {
    console.error("Erreur détaillée du chargement JSON :", e);
    // Affichage de l'erreur dans l'écran de chargement
    document.getElementById('loading').innerHTML =
      `<div class="ld-err" style="text-align:left; background:var(--red-t); padding:16px; border-radius:12px; margin:0 16px;">
        <strong>❌ Impossible de charger les données</strong><br><br>
        <span style="color:var(--red); font-weight:bold;">${e.message}</span><br><br>
        <em>Pistes à vérifier :</em>
        <ul style="margin-left:16px; margin-top:8px; color:var(--ink2);">
          <li><strong>En local :</strong> Utilises-tu bien un serveur local (Live Server) ? Le double-clic bloque le chargement.</li>
          <li><strong>Sur GitHub :</strong> Le dossier s'appelle-t-il bien "data" en minuscules ?</li>
          <li><strong>Sur GitHub :</strong> Les fichiers JSON ont-ils bien la bonne extension (pas de .json.txt caché) ?</li>
        </ul>
      </div>`;
  }
}

/* ══════════════════════════════════════
   MENU
══════════════════════════════════════ */

/** Met à jour l'affichage complet du menu (rang, high scores, grille). */
function renderMenu() {
  // High scores par niveau
  ['1','2','3','4'].forEach(l => {
    let best = 0;
    ['normal','hard','blitz'].forEach(d => { best = Math.max(best, state.hs[`${l}_${d}`] || 0); });
    const el = document.getElementById(`hs-${l}`);
    if (el) el.textContent = best > 0 ? `HS ${best}` : '';
  });

  // Carte de rang
  const rank = getRank(state.permTotal);
  const nr   = getNext(state.permTotal);
  document.getElementById('mrc-name').textContent  = `${rank.label} ${rank.jp}`;
  document.getElementById('mrc-sub').textContent   = `${state.permTotal} pts au total`;
  document.getElementById('mrc-badge').textContent = rank.icon;

  let pct = 0;
  if (nr) {
    const prev  = RANKS[nr.i - 1];
    const range = nr.r.min - prev.min;
    pct = range > 0 ? Math.min(100, Math.round(((state.permTotal - prev.min) / range) * 100)) : 100;
    document.getElementById('mrc-curr').textContent = rank.label;
    document.getElementById('mrc-next').textContent = `→ ${nr.r.label} (${nr.r.min} pts)`;
  } else {
    pct = 100;
    document.getElementById('mrc-curr').textContent = rank.label;
    document.getElementById('mrc-next').textContent = 'Rang maximum !';
  }
  document.getElementById('mrc-bar').style.width = pct + '%';

  // Carte Rebirth (visible uniquement au rang max)
  const rc = document.getElementById('rebirth-card');
  if (rank.id === MAX_RANK.id) {
    rc.classList.remove('hidden');
    document.getElementById('rebirth-count').textContent = state.rebirths > 0 ? `×${state.rebirths}` : '';
  } else {
    rc.classList.add('hidden');
  }

  // Grille des 16 grades
  const grid = document.getElementById('ranks-grid');
  grid.innerHTML = '';
  RANKS.forEach(r => {
    const d = document.createElement('div');
    d.className = `rk-chip${r.id === rank.id ? ' cur' : ''}`;
    d.innerHTML = `<span class="rk-icon">${r.icon}</span><span class="rk-lbl">${r.label}</span><span class="rk-pts">${r.min}pts</span>`;
    grid.appendChild(d);
  });

  // Compteur de révisions SRS dues
  const due = getDailyReview();
  document.getElementById('srs-due-count').textContent = due.length;
}

/* ══════════════════════════════════════
   REBIRTH
══════════════════════════════════════ */
function openRebirthModal()  { document.getElementById('rebirth-modal').classList.remove('gone'); }
function closeRebirthModal() { document.getElementById('rebirth-modal').classList.add('gone'); }
function doRebirth() {
  state.rebirths++;
  state.permTotal = 0;
  save();
  closeRebirthModal();
  renderMenu();
  toast(`🔄 Rebirth #${state.rebirths} — bonne chance !`);
}

/* ══════════════════════════════════════
   SÉLECTION NIVEAU / DIFFICULTÉ / TIMER
══════════════════════════════════════ */

/**
 * Sélectionne un niveau et navigue vers l'écran de configuration.
 * @param {string} l - '1', '2', '3', '4' ou 'ALL'
 */
function selectLevel(l) {
  state.currentLevel = l;
  state.wordList = l === 'ALL'
    ? [].concat(...Object.values(state.db))
    : state.db[l] || [];

  if (state.wordList.length < 4) {
    alert('Données manquantes dans les fichiers JSON.');
    return;
  }
  document.getElementById('act-title').textContent = l === 'ALL' ? 'Tous les niveaux' : `Niveau 0${l}`;
  document.getElementById('act-sub').textContent   = `${state.wordList.length} mots disponibles`;

  // Réinitialise l'affichage de la difficulté sélectionnée
  document.querySelectorAll('.diff-btn').forEach(p => p.classList.remove('on'));
  document.getElementById(`dp-${state.diff}`).classList.add('on');
  updateTimerHint();
  goTo('action');
}

/**
 * Change la difficulté et met à jour l'affichage.
 * @param {string} d   - 'normal', 'hard' ou 'blitz'
 * @param {Element} el - Le bouton cliqué
 */
function setDiff(d, el) {
  state.diff         = d;
  state.questionTime = d === 'normal' ? 15 : d === 'hard' ? 10 : 6;
  document.querySelectorAll('.diff-btn').forEach(p => p.classList.remove('on'));
  el.classList.add('on');
  updateTimerHint();
}

/** Bascule l'activation du timer. */
function toggleTimer() {
  state.timerOn = !state.timerOn;
  document.getElementById('timer-tog').classList.toggle('on', state.timerOn);
  updateTimerHint();
}

/** Retourne le nombre de vies selon la difficulté (et l'easter egg). */
function getMaxLives() {
  if (state.easterActive) return 99;
  return state.diff === 'normal' ? 3 : state.diff === 'hard' ? 2 : 1;
}

/** Met à jour le texte d'indication du timer. */
function updateTimerHint() {
  document.getElementById('timer-desc').textContent = state.timerOn
    ? `Activé — ${state.questionTime} s par question`
    : 'Désactivé — prends ton temps';
}

/* ══════════════════════════════════════
   MODE RÉVISION (liste complète)
══════════════════════════════════════ */

/** Ouvre l'écran de révision avec la liste du niveau sélectionné. */
function showRevision() {
  document.getElementById('rev-si').value = '';
  renderRevList([...state.wordList]);
  goTo('revision');
}

/**
 * Affiche une liste de mots dans le panneau de révision.
 * @param {Array} list - Tableau de mots à afficher
 */
function renderRevList(list) {
  document.getElementById('rev-count').textContent = `${list.length} mots`;
  const el = document.getElementById('rev-list');
  el.innerHTML = '';
  list.forEach(w => {
    const d = document.createElement('div');
    d.className = 'rev-item';
    d.innerHTML = `<div>
      <span class="rev-jp">${w.kanji}</span>
      <span class="rev-kana">${w.kana}</span>
    </div>
    <div class="rev-fr">${w.fr}</div>`;
    el.appendChild(d);
  });
}

/**
 * Filtre la liste de révision selon la saisie.
 * @param {string} q - Terme de recherche (kanji, kana ou français)
 */
function filterRev(q) {
  q = q.toLowerCase().trim();
  renderRevList([...state.wordList].filter(w =>
    w.kanji.includes(q) || w.kana.includes(q) || w.fr.toLowerCase().includes(q)
  ));
}

/* ══════════════════════════════════════
   MOTEUR DE JEU
══════════════════════════════════════ */

/** Initialise et démarre une nouvelle partie. */
function startGame() {
  state.maxLives  = getMaxLives();
  state.lives     = state.maxLives;
  state.score     = 0;
  state.combo     = 0;
  state.bestCombo = 0;
  state.totalAns  = 0;
  state.wrongAns  = 0;
  state.gameStart = Date.now();
  state.answered  = false;

  document.getElementById('diff-lbl').textContent =
    state.diff.charAt(0).toUpperCase() + state.diff.slice(1) + (state.timerOn ? '' : ' ∞');

  goTo('game');
  buildStreak();
  renderLives();
  updateScore();
  nextQ();
}

/* ── Vies ── */

/** Reconstruit l'affichage des cœurs. */
function renderLives() {
  const row = document.getElementById('lives-row');
  row.innerHTML = '';
  if (state.maxLives > 8) {
    // Mode easter egg : affichage compact
    row.innerHTML = `<span style="font-family:'Space Mono',monospace;font-size:.9rem;">❤ ×${state.lives}</span>`;
    return;
  }
  for (let i = 0; i < state.maxLives; i++) {
    const s = document.createElement('span');
    s.className = `heart${i >= state.lives ? ' dead' : ''}`;
    s.textContent = '❤';
    row.appendChild(s);
  }
}

/** Anime la perte d'un cœur. */
function loseLive() {
  const alive = document.querySelectorAll('.heart:not(.dead)');
  if (alive.length) {
    const last = alive[alive.length - 1];
    last.classList.add('lose-anim');
    setTimeout(() => last.classList.add('dead'), 220);
  }
}

/* ── Streak (barre de combo) ── */

/** Construit les 5 points de la barre de streak. */
function buildStreak() {
  const row = document.getElementById('streak-row');
  row.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'sdot';
    row.appendChild(d);
  }
}

/** Met à jour l'état visuel de la barre de streak. */
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

/** Met à jour l'affichage du score (avec animation). */
function updateScore() {
  const el = document.getElementById('score-num');
  el.textContent = state.score;
  el.classList.remove('bump');
  void el.offsetWidth; // force reflow pour relancer l'animation CSS
  el.classList.add('bump');
}

/** Met à jour l'affichage du combo. */
function updateCombo() {
  const cb = document.getElementById('combo-disp');
  if (state.combo >= 3) {
    cb.textContent = `×${state.combo} combo${state.combo >= 10 ? ' 💀' : ''}`;
    cb.classList.add('on');
  } else {
    cb.classList.remove('on');
  }
}

/* ── Timer ── */

/** Lance le timer de la question en cours. */
function startTimer() {
  clearInterval(state.timerInt);
  const wrap = document.getElementById('timer-wrap');
  const bar  = document.getElementById('timer-bar');

  if (!state.timerOn) { wrap.style.opacity = '0'; return; }
  wrap.style.opacity = '1';
  state.timeLeft = state.questionTime;
  bar.style.width      = '100%';
  bar.style.background = 'var(--acc)';

  state.timerInt = setInterval(() => {
    state.timeLeft = Math.max(0, state.timeLeft - 0.1);
    const pct = (state.timeLeft / state.questionTime) * 100;
    bar.style.width      = pct + '%';
    bar.style.background = pct > 60 ? 'var(--acc)' : pct > 30 ? 'var(--amber)' : 'var(--red)';
    if (state.timeLeft <= 0) { clearInterval(state.timerInt); onTimeout(); }
  }, 100);
}

/** Gère l'expiration du timer. */
function onTimeout() {
  if (state.answered) return;
  state.answered = true;
  state.combo    = 0;
  state.wrongAns++;
  state.totalAns++;
  state.lives--;

  // Mise à jour SRS : échec par timeout
  if (state.curWord?.id) updateSRS(state.curWord.id, false);

  flash('rgba(255,75,75,.1)');
  loseLive(); updateCombo(); updateStreak();
  toast('⏱ Temps écoulé');
  revealCorrect();
  if (state.lives <= 0) setTimeout(endGame, 1600); else setTimeout(nextQ, 1300);
}

/** Révèle la bonne réponse en grisant les autres. */
function revealCorrect() {
  Array.from(document.getElementById('opts-grid').children).forEach(b => {
    b.disabled = true;
    if (b.dataset.ok === 'true') b.classList.add('reveal');
  });
}

/* ── Question ── */

/** Prépare et affiche la prochaine question. */
function nextQ() {
  clearInterval(state.timerInt);
  state.answered   = false;
  state.furiVisible = false;
  updateFuriBtn();

  // Sélection aléatoire du mot et des distracteurs
  state.curWord = state.wordList[Math.floor(Math.random() * state.wordList.length)];
  const dist = [];
  while (dist.length < 3) {
    const rw = state.wordList[Math.floor(Math.random() * state.wordList.length)];
    if (rw.kanji !== state.curWord.kanji && !dist.find(d => d.kanji === rw.kanji)) {
      dist.push(rw);
    }
  }
  state.curOpts = [state.curWord, ...dist].sort(() => Math.random() - 0.5);
  state.isJpFr  = Math.random() > 0.45; // 55 % JP→FR, 45 % FR→JP

  renderQ();
  startTimer();

  // Lecture audio de la prononciation (kana) à chaque nouvelle question
  if (state.curWord.kana) speak(state.curWord.kana);
}

/** Construit l'affichage de la question et des options. */
function renderQ() {
  const grid = document.getElementById('opts-grid');
  grid.innerHTML = '';
  const qw   = document.getElementById('q-word');
  const card = document.getElementById('q-card');
  card.classList.remove('ok', 'err');

  if (state.isJpFr) {
    // JP → FR : affiche le kanji, réponses en français
    document.getElementById('q-dir').textContent = 'JP → FR';
    qw.className = 'q-word';
    qw.innerHTML = state.furiVisible
      ? `<ruby>${state.curWord.kanji}<rt>${state.curWord.kana}</rt></ruby>`
      : state.curWord.kanji;

    state.curOpts.forEach((o, i) => {
      const b = makeBtn(o.fr, false, o.kanji === state.curWord.kanji, i + 1);
      b.classList.add('fr-opt');
      grid.appendChild(b);
    });
  } else {
    // FR → JP : affiche la traduction française, réponses en japonais
    document.getElementById('q-dir').textContent = 'FR → JP';
    qw.className = 'q-word latin';
    qw.textContent = state.curWord.fr;

    state.curOpts.forEach((o, i) => {
      const content = state.furiVisible
        ? `<ruby>${o.kanji}<rt>${o.kana}</rt></ruby>`
        : o.kanji;
      grid.appendChild(makeBtn(content, true, o.kanji === state.curWord.kanji, i + 1));
    });
  }

  updateFuriBtn();
}

/** Met à jour l'état visuel du bouton furigana. */
function updateFuriBtn() {
  const btn = document.getElementById('furi-btn');
  const lbl = document.getElementById('furi-lbl');
  btn.classList.toggle('on', state.furiVisible);
  lbl.textContent = state.furiVisible ? 'Masquer' : 'Furigana';
}

/** Bascule l'affichage des furigana et re-rend la question. */
function toggleFuri() {
  state.furiVisible = !state.furiVisible;
  const qw = document.getElementById('q-word');

  if (state.isJpFr) {
    qw.innerHTML = state.furiVisible
      ? `<ruby>${state.curWord.kanji}<rt>${state.curWord.kana}</rt></ruby>`
      : state.curWord.kanji;
  } else {
    // En mode FR→JP, on re-rend les options
    Array.from(document.getElementById('opts-grid').children).forEach((b, i) => {
      const o  = state.curOpts[i];
      if (!o) return;
      const kh = b.querySelector('.kh');
      const khText = kh ? kh.textContent : '';
      b.innerHTML = `<span class="kh">${khText}</span>`;
      b.innerHTML += state.furiVisible
        ? `<ruby>${o.kanji}<rt>${o.kana}</rt></ruby>`
        : o.kanji;
    });
  }
  updateFuriBtn();
}

/**
 * Crée un bouton d'option de réponse.
 * @param {string}  content   - Contenu textuel ou HTML du bouton
 * @param {boolean} isHtml    - Vrai si content doit être injecté en innerHTML
 * @param {boolean} isCorrect - Vrai si c'est la bonne réponse
 * @param {number}  num       - Numéro de raccourci clavier (1–4)
 * @returns {HTMLButtonElement}
 */
function makeBtn(content, isHtml, isCorrect, num) {
  const b = document.createElement('button');
  b.className  = 'opt-btn';
  b.innerHTML  = `<span class="kh">${num}</span>`;
  if (isHtml) b.innerHTML += content;
  else b.appendChild(document.createTextNode(content));
  b.dataset.ok = String(isCorrect);
  b.addEventListener('click', () => checkAnswer(b, isCorrect));
  return b;
}

/* ── Réponse ── */

/**
 * Traite la réponse de l'utilisateur.
 * @param {HTMLButtonElement} btn       - Le bouton cliqué
 * @param {boolean}           isCorrect - Vrai si la réponse est correcte
 */
function checkAnswer(btn, isCorrect) {
  if (state.answered) return;
  state.answered = true;
  clearInterval(state.timerInt);
  state.totalAns++;

  // Mise à jour SRS
  if (state.curWord?.id) updateSRS(state.curWord.id, isCorrect);

  // Lecture audio de la prononciation à la validation
  if (state.curWord?.kana) speak(state.curWord.kana);

  if (isCorrect) {
    btn.classList.add('correct');
    document.getElementById('q-card').classList.add('ok');
    flash('rgba(88,204,2,.08)');
    state.score++;
    state.combo++;
    if (state.combo > state.bestCombo) state.bestCombo = state.combo;

    // Bonus rapidité : +2 si réponse en premier quart du temps
    if (state.timerOn && state.timeLeft > state.questionTime * 0.75) {
      state.score++;
      spawnPop('+2 ⚡', btn);
    } else {
      spawnPop('+1', btn);
    }
    updateScore(); updateCombo(); updateStreak();

    // Toasts de milestones
    const mt = { 10:'10 mots !', 25:'En feu 🔥', 50:'Mi-chemin ⚡', 69:'nice.', 100:'Centurion 💀', 150:'Légendaire', 200:'Rang S 🔥' };
    if (mt[state.score]) toast(mt[state.score]);
    const ct = { 5:'×5 🔥 Combo', 10:'×10 🔥 Unstoppable', 20:'×20 💀 Indécent', 30:'×30 ⚡ T\'es pas réel' };
    if (ct[state.combo]) toast(ct[state.combo]);

    // Désactive toutes les options et passe à la suivante
    Array.from(document.getElementById('opts-grid').children).forEach(b => b.disabled = true);
    setTimeout(nextQ, 280);
  } else {
    btn.classList.add('wrong');
    btn.disabled = true;
    flash('rgba(255,75,75,.08)');
    state.combo = 0;
    state.wrongAns++;
    state.lives--;
    loseLive(); updateCombo(); updateStreak();

    if (state.lives <= 0) {
      revealCorrect();
      setTimeout(endGame, 1800);
    } else {
      // L'utilisateur peut réessayer (sans réinitialiser answered)
      state.answered = false;
    }
  }
}

/**
 * Fait apparaître une pop animation de score au-dessus du bouton.
 * @param {string}          txt - Texte à afficher (ex. "+1", "+2 ⚡")
 * @param {HTMLButtonElement} btn - Bouton de référence pour le positionnement
 */
function spawnPop(txt, btn) {
  const pop = document.createElement('div');
  pop.className  = 'score-pop';
  pop.textContent = txt;
  const r  = btn.getBoundingClientRect();
  const ar = document.getElementById('app').getBoundingClientRect();
  pop.style.left = `${r.left - ar.left + r.width / 2 - 12}px`;
  pop.style.top  = `${r.top  - ar.top  - 6}px`;
  document.getElementById('app').appendChild(pop);
  setTimeout(() => pop.remove(), 750);
}

/* ══════════════════════════════════════
   FIN DE PARTIE — rang basé sur permTotal
══════════════════════════════════════ */

/** Calcule les résultats, met à jour le rang et affiche l'écran game over. */
function endGame() {
  clearInterval(state.timerInt);

  const elapsed  = Math.round((Date.now() - state.gameStart) / 1000);
  const acc      = state.totalAns > 0 ? Math.round((state.score / state.totalAns) * 100) : 0;
  const prevTotal = state.permTotal;
  const prevRank  = getRank(prevTotal);

  // Accumulation du score dans le total permanent (base du rang)
  state.permTotal += state.score;
  save();

  const newRank  = getRank(state.permTotal);
  const isRankUp = newRank.id !== prevRank.id;

  // Titre de résultat
  const title = document.getElementById('go-title');
  if (state.score >= 100) {
    title.className  = 'go-title good';
    title.textContent = 'Maître';
    document.getElementById('go-eyebrow').textContent = 'LÉGENDAIRE';
  } else if (state.score >= 50) {
    title.className  = 'go-title good';
    title.textContent = 'Solide';
    document.getElementById('go-eyebrow').textContent = 'BON RUN';
  } else {
    title.className  = 'go-title fail';
    title.textContent = 'Échec';
    document.getElementById('go-eyebrow').textContent = 'RÉSULTAT';
  }

  // Stats
  document.getElementById('st-score').textContent = state.score;
  document.getElementById('st-combo').textContent = state.bestCombo;
  document.getElementById('st-acc').textContent   = acc + '%';
  document.getElementById('st-time').textContent  = elapsed + 's';

  // Carte de rang
  document.getElementById('grc-emoji').textContent = newRank.icon;
  document.getElementById('grc-name').textContent  = `${newRank.label} ${newRank.jp}`;
  document.getElementById('grc-pts').textContent   = `${state.permTotal} pts au total`;

  const card = document.getElementById('go-rank-card');
  card.className = 'go-rank-card' +
    (newRank.id === MAX_RANK.id ? ' legend' : isRankUp ? ' rankup' : '');
  document.getElementById('grc-new').classList.toggle('hidden', !isRankUp);

  // Comparaison avant/après rang
  const cmpRow = document.getElementById('rank-cmp-row');
  if (isRankUp) {
    cmpRow.style.display = 'flex';
    document.getElementById('rc-from').textContent = `${prevRank.label} ${prevRank.jp}`;
    document.getElementById('rc-to').textContent   = `${newRank.label} ${newRank.jp}`;
  } else {
    cmpRow.style.display = 'none';
  }

  // Barre de progression vers le prochain rang
  const nr = getNext(state.permTotal);
  const nbWrap = document.getElementById('nb-wrap');
  if (nr) {
    nbWrap.style.display = '';
    const prev  = RANKS[nr.i - 1];
    const range = nr.r.min - prev.min;
    const pct   = range > 0
      ? Math.min(100, Math.round(((state.permTotal - prev.min) / range) * 100))
      : 100;
    document.getElementById('nb-left').textContent  = newRank.label;
    document.getElementById('nb-right').textContent = `${nr.r.label} (${nr.r.min} pts)`;
    const fill = document.getElementById('nb-fill');
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = pct + '%'; }, 80);
  } else {
    nbWrap.style.display = 'none';
  }

  // Record par niveau/difficulté
  const key = `${state.currentLevel}_${state.diff}`;
  if (state.score > (state.hs[key] || 0)) {
    state.hs[key] = state.score;
    save();
    document.getElementById('rec-banner').classList.remove('hidden');
  } else {
    document.getElementById('rec-banner').classList.add('hidden');
  }

  document.getElementById('go-quote').textContent = pickQuote(state.score, acc, elapsed, state.bestCombo);
  renderMenu();
  goTo('gameover');
}

/* ══════════════════════════════════════
   CITATIONS (fin de partie)
══════════════════════════════════════ */

/**
 * Sélectionne une citation adaptée au résultat.
 * @param {number} s   - Score final
 * @param {number} acc - Précision en %
 * @param {number} elapsed - Durée en secondes
 * @param {number} cmb - Meilleur combo
 * @returns {string}
 */
function pickQuote(s, acc, elapsed, cmb) {
  let pool = [];

  if (s <= 5) pool = [
    "Ton Ryzen 9800X3D tourne à plein régime pour afficher un score de merde.",
    "Yuka a vomi en voyant ton résultat. Elle a bloqué le numéro.",
    "Même un bot Valorant Silver a plus de vocabulaire que toi.",
    "Tu vas te faire racketter par des collégiens à Sannomiya.",
    "Retourne sur Minecraft, t'es clairement pas prêt pour la vraie vie.",
    "T'es une erreur de compilation vivante et non récupérable.",
    "Ce score c'est un bug. Non attends c'est juste toi. Le bug c'est toi.",
    "Même un pigeon de Shibuya comprend mieux le japonais que toi.",
    "T'aurais eu un meilleur score en fermant les yeux et en cliquant au hasard.",
    "Ta future vie au Japon : nettoyer les toilettes des konbini de nuit.",
    "Avec ce niveau tu comprendras même pas l'emballage du riz.",
    "C'est pathétique. Désinstalle l'appli et réfléchis à tes choix de vie.",
    "Oublie le Japon, t'as même pas le niveau pour Duolingo niveau débutant.",
    "La Z33 que t'as jamais achetée te regarde avec honte.",
    "Ton 9800X3D méritait un meilleur propriétaire.",
    "T'as cliqué au pif sur toutes les réponses et t'as quand même foiré. Respect.",
    "Si c'était Wordle t'aurais trouvé le mot en 47 essais.",
    "L'IA qui génère ces vannes est sincèrement gênée pour toi.",
  ];
  else if (s <= 15) pool = [
    "T'es bloqué au tuto de ta propre vie depuis des mois.",
    "Tu vas finir SDF à Shibuya avec ce vocabulaire de touriste.",
    "Tu parles tellement mal que même les touristes français vont te corriger.",
    "Un gamin japonais de 6 ans t'éclate en dormant les deux mains attachées.",
    "T'as juste prouvé que tu sais cliquer. Parfois même au bon endroit.",
    "T'es le Iron 1 de l'apprentissage des langues mondiales.",
    "Même sans timer t'as quand même foiré. La constance dans la médiocrité.",
    "Yuka a vu le score et a mis le téléphone en mode avion.",
    "Tu maîtrises peut-être les kanas. Peut-être. On en est pas sûrs.",
    "C'est le niveau d'un touriste qui a regardé 10 minutes d'anime en 2015.",
    "La Z33 t'attend au garage, mais t'as même pas le niveau pour lire le manuel.",
  ];
  else if (s <= 30) pool = [
    "Score de quelqu'un qui va abandonner son projet Japon au premier obstacle.",
    "Tu vas te contenter de ramen éco et de convenience store toute ta vie.",
    "Tu sais dire bonjour et merci. Félicitations pour ton niveau CE1.",
    "Tu survis, mais tu fais sincèrement pitié à tout le monde.",
    "T'es l'équivalent d'une connexion Wi-Fi à -3 barres dans le métro japonais.",
    "Tu vas pouvoir commander de l'eau au restaurant. Grosse évolution sur l'année.",
    "C'est le niveau N5 de la survie en milieu hostile.",
    "Yuka sourit poliment parce qu'elle a pitié de ton accent catastrophique.",
    "Retourne poncer ta liste au lieu de faire semblant d'être prêt.",
    "Un score de milieu de tableau dans un classement fondamentalement honteux.",
    "La Z33 pleure dans le garage.",
  ];
  else if (s <= 50) pool = [
    "Ça commence à ressembler à un cerveau fonctionnel. Enfin.",
    "T'as enfin le niveau pour regarder un anime sans bégayer devant les sous-titres.",
    "Le projet Japon devient sérieux. Très lentement, mais sérieux.",
    "Plus besoin de Google Traduction pour survivre dans un konbini.",
    "Solide. Maintenant double ce score ou c'était du hasard.",
    "Les kanjis commencent à rentrer. Continue avant qu'ils ressortent.",
    "T'es plus un simple touriste. T'es un touriste avancé.",
    "La Z33 commence à ronronner.",
  ];
  else if (s <= 120) pool = [
    "Sérieusement chaud. On commence vraiment à parler d'un niveau correct.",
    "T'es passé Sankyu et tu le réalises même pas encore.",
    "Tokyo commence à te sembler moins terrifiant. C'est un début.",
    "Yuka hésite à répondre au message. Elle réfléchit.",
    "T'as de la mémoire musculaire sur les kanjis. C'est du vrai travail.",
    "T'es plus un touriste, t'es un résident en devenir. Presque.",
    "100 mots, du vrai niveau. Maintenant fais-le en Blitz.",
    "La database commence à transpirer légèrement.",
    "La Z33 donne tout sur la ligne droite.",
  ];
  else pool = [
    "Masterclass absolue. T'es prêt pour le vol direction Tokyo.",
    "Le roi de Fujisawa est dans la place, chapeau.",
    "Ton cerveau turbine plus vite que ton 9800X3D en mode turbo.",
    "Yuka prépare le repas, t'as plié la partie et le futur.",
    "Score de pur crack du vocabulaire japonais.",
    "Tu peux direct écrire des light novels sans traducteur.",
    "C'est complètement indécent comme score, continue.",
    "Tu lis les kanjis plus vite que ton écran 240Hz peut les afficher.",
    "Pure domination linguistique et intellectuelle.",
    "T'as hacké la database du Core 2000, félicitations.",
    "Le niveau est irréprochable. Légendaire. Incontestable.",
    "La Z33 fait des wheelspin sur tout le premier tour.",
  ];

  // Citations contextuelles bonus
  if (cmb >= 10 && s <= 20) pool.push(`Ton ×${cmb} combo c'était de la chance pure. Regarde le score final, ça dit tout.`);
  if (acc < 40 && state.totalAns > 10) pool.push("Moins de 40% de précision. T'as littéralement cliqué en dormant les yeux fermés.");
  if (elapsed < 15 && s <= 5) pool.push("Moins de 15 secondes de survie. Speedrun de la nullité totale. Un record de médiocrité.");
  if (state.diff === 'blitz' && s <= 5)  pool.push("Mode Blitz avec ce score. Les mobs de Lies of P réagissent plus vite que toi.");
  if (state.diff === 'blitz' && s > 30)  pool.push("Mode Blitz, 30+ mots. Respect total, c'est du niveau.");
  if (!state.timerOn && s <= 10)         pool.push("T'as joué sans timer et t'as quand même foiré. Il n'y a aucune excuse valable.");
  if (state.diff === 'hard'  && s > 40)  pool.push("Hard mode, 40+ mots. Légitimement impressionnant, t'as du niveau.");
  if (s > 0 && acc === 100)              pool.push("100% de précision. Soit t'es une machine, soit t'as triché. Probablement les deux.");

  return pool[Math.floor(Math.random() * pool.length)];
}

/* ══════════════════════════════════════
   EFFETS VISUELS — Flash & Toast
══════════════════════════════════════ */

/**
 * Déclenche un flash de couleur sur tout l'écran.
 * @param {string} color - Couleur CSS (rgba recommandé)
 */
function flash(color) {
  const f = document.getElementById('sf');
  f.style.background = color;
  f.style.opacity    = '1';
  setTimeout(() => { f.style.opacity = '0'; }, 110);
}

/**
 * Affiche un toast de notification temporaire.
 * @param {string} msg - Message à afficher
 */
function toast(msg) {
  // Supprime les toasts existants pour éviter l'empilement
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className  = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2100);
}

/* ══════════════════════════════════════
   RACCOURCIS CLAVIER
══════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'h' || e.key === 'H') { toggleKb(); return; }
  if (e.key === 'Escape')              { closeKb();  return; }
  if (e.key === 'f' || e.key === 'F') { toggleFuri(); return; }

  // Touches 1–4 pour sélectionner les réponses
  const gs = document.querySelector('[data-screen="game"].active');
  if (!gs) return;
  const map = { '1':0, '2':1, '3':2, '4':3 };
  if (map[e.key] !== undefined) {
    const btns = Array.from(document.getElementById('opts-grid').children)
                      .filter(b => !b.disabled);
    if (btns[map[e.key]]) btns[map[e.key]].click();
  }
});

/* ── Overlay aide clavier ── */

function toggleKb() { state.kbOverlay ? closeKb() : openKb(); }

function openKb() {
  if (state.kbOverlay) return;
  state.kbOverlay = document.createElement('div');
  state.kbOverlay.className = 'kb-ov';
  state.kbOverlay.innerHTML = `<div class="kb-inner">
    <span class="kb-title">Aide</span>
    <div><span class="kb-key">1</span><span class="kb-key">2</span><span class="kb-key">3</span><span class="kb-key">4</span> — Répondre</div>
    <div><span class="kb-key">F</span> — Afficher/masquer les furigana</div>
    <div><span class="kb-key">H</span> — Aide &nbsp; <span class="kb-key">Esc</span> — Fermer</div>
    <div class="kb-close-hint">Cliquer n'importe où pour fermer</div>
  </div>`;
  state.kbOverlay.addEventListener('click', closeKb);
  document.querySelector('[data-screen="game"]').appendChild(state.kbOverlay);
}

function closeKb() {
  if (state.kbOverlay) { state.kbOverlay.remove(); state.kbOverlay = null; }
}

/* ══════════════════════════════════════
   EASTER EGG
══════════════════════════════════════ */
document.getElementById('wm-name').addEventListener('click', () => {
  state.easterClicks++;
  if (state.easterClicks === 5)  { state.easterActive = true; toast('Mode Shifu activé — vies infinies'); }
  if (state.easterClicks === 10) { document.getElementById('wm-name').textContent = 'Hiro King'; toast('Dieu du japonais débloqué'); }
});

/* ══════════════════════════════════════
   BINDING DES ÉVÉNEMENTS
   (remplace les onclick inline du HTML)
══════════════════════════════════════ */
function bindEvents() {
  // Menu : boutons de niveau
  document.querySelectorAll('.lvl-btn').forEach(btn => {
    btn.addEventListener('click', () => selectLevel(btn.dataset.level));
  });
  document.getElementById('btn-all-levels').addEventListener('click', () => selectLevel('ALL'));

  // Menu : révisions SRS du jour
  document.getElementById('btn-srs-review').addEventListener('click', () => {
    const due = getDailyReview();
    if (due.length === 0) { toast('Aucune révision due pour aujourd\'hui !'); return; }
    // Lance une session de jeu avec uniquement les mots dus
    state.currentLevel = 'SRS';
    state.wordList     = due;
    document.getElementById('act-title').textContent = 'Révision SRS';
    document.getElementById('act-sub').textContent   = `${due.length} mots dus aujourd'hui`;
    document.querySelectorAll('.diff-btn').forEach(p => p.classList.remove('on'));
    document.getElementById(`dp-${state.diff}`).classList.add('on');
    updateTimerHint();
    goTo('action');
  });

  // Rebirth
  document.getElementById('rebirth-card').addEventListener('click', openRebirthModal);
  document.getElementById('rebirth-confirm-btn').addEventListener('click', doRebirth);
  document.getElementById('rebirth-cancel-btn').addEventListener('click', closeRebirthModal);

  // Navigation : retours
  document.getElementById('back-to-menu').addEventListener('click', () => goTo('menu'));
  document.getElementById('back-to-action').addEventListener('click', () => goTo('action'));
  document.getElementById('back-to-action-2').addEventListener('click', () => goTo('action'));

  // Configuration : difficulté
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => setDiff(btn.dataset.diff, btn));
  });

  // Configuration : timer toggle
  document.getElementById('timer-tog').addEventListener('click', toggleTimer);

  // Configuration : actions
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-revision').addEventListener('click', showRevision);

  // Révision : filtrage
  document.getElementById('rev-si').addEventListener('input', e => filterRev(e.target.value));

  // Furigana
  document.getElementById('furi-btn').addEventListener('click', toggleFuri);

  // Game over
  document.getElementById('btn-replay').addEventListener('click', startGame);
  document.getElementById('btn-back-menu').addEventListener('click', () => goTo('menu'));
}

/* ══════════════════════════════════════
   INITIALISATION
   DOMContentLoaded garantit que tous les
   éléments HTML existent avant le binding.
══════════════════════════════════════ */
function startApp() {
  loadStorage(); // Charge la progression depuis localStorage
  bindEvents();  // Attache tous les écouteurs d'événements
  loadDB();      // Lance le chargement async des fichiers JSON
}

document.addEventListener('DOMContentLoaded', startApp);
