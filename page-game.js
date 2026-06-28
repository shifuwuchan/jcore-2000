'use strict';
/* page-game.js — Écran QCM (game.html?level=1&diff=normal&timer=1) */

const gParams = new URLSearchParams(location.search);
const gLevel  = gParams.get('level') || '1';
const gDiff   = gParams.get('diff')  || 'normal';
const gTimer  = gParams.get('timer') !== '0';

let wordList   = [];
let questionTime = gDiff === 'normal' ? 15 : gDiff === 'hard' ? 10 : 6;
let maxLives, lives, score = 0, combo = 0, bestCombo = 0, totalAns = 0, wrongAns = 0;
let gameStart = 0, curWord = null, curOpts = [], isJpFr = true, furiVisible = false, answered = false;
let timerInt = null, timeLeft = 0;
let gameStartPermTotal = 0;

function getMaxLives() {
  if (state.easterActive) return 99;
  return gDiff === 'normal' ? 3 : gDiff === 'hard' ? 2 : 1;
}

/* ── Distracteurs intelligents (similarité phonétique/visuelle) ──── */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) { dp.push(new Array(n + 1).fill(0)); dp[i][0] = i; }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  }
  return dp[m][n];
}

function pickSmartDistractors(target, pool, count) {
  const candidates = pool.filter(w => w.kanji !== target.kanji);
  const scored = candidates.map(w => ({
    w, score: levenshtein(target.kana, w.kana) - (w.kanji[0] === target.kanji[0] ? 1.5 : 0),
  })).sort((a, b) => a.score - b.score);

  const picked = [];
  const used = new Set();
  for (const s of scored) {
    if (picked.length >= count) break;
    if (used.has(s.w.kanji)) continue;
    if (Math.random() < 0.7 || picked.length === count - 1) { picked.push(s.w); used.add(s.w.kanji); }
  }
  while (picked.length < count && candidates.length > 0) {
    const rw = candidates[Math.floor(Math.random() * candidates.length)];
    if (!used.has(rw.kanji)) { picked.push(rw); used.add(rw.kanji); }
  }
  return picked;
}

function curCardId() { return cardId(curWord.id, isJpFr ? 'read' : 'prod'); } // srs.js

/* ── Démarrage ── */
function startGame() {
  maxLives  = getMaxLives();
  lives     = maxLives;
  score = combo = bestCombo = totalAns = wrongAns = 0;
  gameStart = Date.now();
  answered  = false;
  gameStartPermTotal = state.permTotal;

  recordActivity();

  document.getElementById('hud-diff').textContent =
    gDiff.charAt(0).toUpperCase() + gDiff.slice(1) + (gTimer ? '' : ' ∞');

  buildStreak();
  renderLives();
  updateScore();
  nextQ();
}

function renderLives() {
  const row = document.getElementById('hud-lives');
  row.innerHTML = '';
  if (maxLives > 8) {
    row.innerHTML = `<span style="font-family:'Space Mono',monospace;font-size:.9rem;">❤ ×${lives}</span>`;
    return;
  }
  for (let i = 0; i < maxLives; i++) {
    const s = document.createElement('span');
    s.className = `heart${i >= lives ? ' dead' : ''}`;
    s.textContent = '❤';
    row.appendChild(s);
  }
}

function loseLive() {
  const alive = document.querySelectorAll('.heart:not(.dead)');
  if (alive.length) {
    const last = alive[alive.length - 1];
    last.classList.add('lose-anim');
    setTimeout(() => last.classList.add('dead'), 220);
  }
}

function buildStreak() {
  const row = document.getElementById('streak-row');
  row.innerHTML = '';
  for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'sdot'; row.appendChild(d); }
}

function updateStreak() {
  const dots = document.querySelectorAll('.sdot');
  const pos  = combo % 5;
  const full = combo > 0 && pos === 0;
  dots.forEach((d, i) => {
    d.classList.remove('lit', 'max');
    if (full) d.classList.add('max');
    else if (i < pos) d.classList.add('lit');
  });
}

function updateScore() {
  const el = document.getElementById('score-num');
  el.textContent = score;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function updateCombo() {
  const cb = document.getElementById('combo-disp');
  if (combo >= 3) { cb.textContent = `×${combo} combo${combo >= 10 ? ' 💀' : ''}`; cb.classList.add('on'); }
  else cb.classList.remove('on');
}

function startTimer() {
  clearInterval(timerInt);
  const wrap = document.getElementById('timer-wrap');
  const bar  = document.getElementById('timer-bar');
  if (!gTimer) { wrap.style.opacity = '0'; return; }
  wrap.style.opacity = '1';
  timeLeft = questionTime;
  bar.style.width = '100%';
  bar.style.background = 'var(--acc)';

  timerInt = setInterval(() => {
    timeLeft = Math.max(0, timeLeft - 0.1);
    const pct = (timeLeft / questionTime) * 100;
    bar.style.width = pct + '%';
    bar.style.background = pct > 60 ? 'var(--acc)' : pct > 30 ? 'var(--amber)' : 'var(--red)';
    if (timeLeft <= 0) { clearInterval(timerInt); onTimeout(); }
  }, 100);
}

function onTimeout() {
  if (answered) return;
  answered = true;
  combo = 0;
  wrongAns++; totalAns++;
  lives--;

  if (curWord && curWord.id) updateSRSQuiz(curCardId(), false);

  flash('rgba(255,75,75,.1)');
  loseLive(); updateCombo(); updateStreak();
  toast('⏱ Temps écoulé');
  revealCorrect();
  if (lives <= 0) setTimeout(endGame, 1600); else setTimeout(nextQ, 1300);
}

function revealCorrect() {
  Array.from(document.getElementById('opts-grid').children).forEach(b => {
    b.disabled = true;
    if (b.dataset.ok === 'true') b.classList.add('reveal');
  });
}

function nextQ() {
  clearInterval(timerInt);
  answered = false;
  furiVisible = false;

  curWord = wordList[Math.floor(Math.random() * wordList.length)];
  const dist = pickSmartDistractors(curWord, wordList, 3);
  curOpts = [curWord, ...dist].sort(() => Math.random() - 0.5);
  isJpFr  = Math.random() > 0.45;

  renderQ();
  startTimer();
}

function renderQ() {
  const grid = document.getElementById('opts-grid');
  grid.innerHTML = '';
  const qw   = document.getElementById('q-word');
  const card = document.getElementById('q-card');
  card.classList.remove('ok', 'err');

  if (isJpFr) {
    document.getElementById('q-dir').textContent = 'JP → FR';
    qw.className = 'q-word';
    qw.innerHTML = furiVisible ? `<ruby>${curWord.kanji}<rt>${curWord.kana}</rt></ruby>` : curWord.kanji;
    curOpts.forEach((o, i) => {
      const b = makeBtn(o.fr, false, o.kanji === curWord.kanji, i + 1);
      b.classList.add('fr-opt');
      grid.appendChild(b);
    });
  } else {
    document.getElementById('q-dir').textContent = 'FR → JP';
    qw.className = 'q-word latin';
    qw.textContent = curWord.fr;
    curOpts.forEach((o, i) => {
      const content = furiVisible ? `<ruby>${o.kanji}<rt>${o.kana}</rt></ruby>` : o.kanji;
      grid.appendChild(makeBtn(content, true, o.kanji === curWord.kanji, i + 1));
    });
  }
  updateFuriBtn();
}

function updateFuriBtn() {
  const btn = document.getElementById('furi-btn');
  const lbl = document.getElementById('furi-lbl');
  btn.classList.toggle('on', furiVisible);
  lbl.textContent = furiVisible ? 'Masquer' : 'Furigana';
}

function toggleFuri() {
  furiVisible = !furiVisible;
  const qw = document.getElementById('q-word');
  if (isJpFr) {
    qw.innerHTML = furiVisible ? `<ruby>${curWord.kanji}<rt>${curWord.kana}</rt></ruby>` : curWord.kanji;
  } else {
    Array.from(document.getElementById('opts-grid').children).forEach((b, i) => {
      const o = curOpts[i];
      if (!o) return;
      const kh = b.querySelector('.kh');
      const khText = kh ? kh.textContent : '';
      b.innerHTML = `<span class="kh">${khText}</span>`;
      b.innerHTML += furiVisible ? `<ruby>${o.kanji}<rt>${o.kana}</rt></ruby>` : o.kanji;
    });
  }
  updateFuriBtn();
}

function makeBtn(content, isHtml, isCorrect, num) {
  const b = document.createElement('button');
  b.className = 'opt-btn';
  b.innerHTML = `<span class="kh">${num}</span>`;
  if (isHtml) b.innerHTML += content;
  else b.appendChild(document.createTextNode(content));
  b.dataset.ok = String(isCorrect);
  b.addEventListener('click', () => checkAnswer(b, isCorrect));
  return b;
}

function checkAnswer(btn, isCorrect) {
  if (answered) return;
  answered = true;
  clearInterval(timerInt);
  totalAns++;

  let justMastered = false;
  if (curWord && curWord.id) {
    const r = updateSRSQuiz(curCardId(), isCorrect);
    justMastered = r.justMastered;
  }

  if (isCorrect) {
    btn.classList.add('correct');
    document.getElementById('q-card').classList.add('ok');
    flash('rgba(88,204,2,.08)');
    score++; combo++;
    if (combo > bestCombo) bestCombo = combo;

    let baseGained = 1;
    if (gTimer && timeLeft > questionTime * 0.75) { score++; baseGained = 2; spawnPop('+2 ⚡', btn); }
    else spawnPop('+1', btn);

    const gained = applyBoost(baseGained);
    state.permTotal     += gained;
    state.lifetimeTotal += gained;
    save();
    Cloud.logPoints(gained).catch(() => { /* best-effort */ });

    if (justMastered) awardMasteryBonus();

    updateScore(); updateCombo(); updateStreak();

    const mt = { 10:'10 mots !', 25:'En feu 🔥', 50:'Mi-chemin ⚡', 69:'nice.', 100:'Centurion 💀', 150:'Légendaire', 200:'Rang S 🔥' };
    if (mt[score]) toast(mt[score]);
    const ct = { 5:'×5 🔥 Combo', 10:'×10 🔥 Unstoppable', 20:'×20 💀 Indécent', 30:'×30 ⚡ T\'es pas réel' };
    if (ct[combo]) toast(ct[combo]);

    Array.from(document.getElementById('opts-grid').children).forEach(b => b.disabled = true);
    setTimeout(nextQ, 280);
  } else {
    btn.classList.add('wrong');
    btn.disabled = true;
    flash('rgba(255,75,75,.08)');
    combo = 0; wrongAns++; lives--;
    loseLive(); updateCombo(); updateStreak();

    if (lives <= 0) { revealCorrect(); setTimeout(endGame, 1800); }
    else answered = false;
  }
}

function spawnPop(txt, btn) {
  const pop = document.createElement('div');
  pop.className = 'score-pop';
  pop.textContent = txt;
  const r  = btn.getBoundingClientRect();
  const ar = document.getElementById('app').getBoundingClientRect();
  pop.style.left = `${r.left - ar.left + r.width / 2 - 12}px`;
  pop.style.top  = `${r.top  - ar.top  - 6}px`;
  document.getElementById('app').appendChild(pop);
  setTimeout(() => pop.remove(), 750);
}

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

  if (cmb >= 10 && s <= 20) pool.push(`Ton ×${cmb} combo c'était de la chance pure. Regarde le score final, ça dit tout.`);
  if (acc < 40 && totalAns > 10) pool.push("Moins de 40% de précision. T'as littéralement cliqué en dormant les yeux fermés.");
  if (elapsed < 15 && s <= 5) pool.push("Moins de 15 secondes de survie. Speedrun de la nullité totale. Un record de médiocrité.");
  if (gDiff === 'blitz' && s <= 5)  pool.push("Mode Blitz avec ce score. Les mobs de Lies of P réagissent plus vite que toi.");
  if (gDiff === 'blitz' && s > 30)  pool.push("Mode Blitz, 30+ mots. Respect total, c'est du niveau.");
  if (!gTimer && s <= 10)           pool.push("T'as joué sans timer et t'as quand même foiré. Il n'y a aucune excuse valable.");
  if (gDiff === 'hard'  && s > 40)  pool.push("Hard mode, 40+ mots. Légitimement impressionnant, t'as du niveau.");
  if (s > 0 && acc === 100)         pool.push("100% de précision. Soit t'es une machine, soit t'as triché. Probablement les deux.");

  return pool[Math.floor(Math.random() * pool.length)];
}

function endGame() {
  clearInterval(timerInt);
  const elapsed = Math.round((Date.now() - gameStart) / 1000);
  const acc     = totalAns > 0 ? Math.round((score / totalAns) * 100) : 0;

  const key = `${gLevel}_${gDiff}`;
  let isRecord = false;
  if (score > (state.hs[key] || 0)) { state.hs[key] = score; isRecord = true; }
  save();

  sessionStorage.setItem('jc_gameover', JSON.stringify({
    score, bestCombo, acc, elapsed, gameStartPermTotal, isRecord, level: gLevel, diff: gDiff,
    quote: pickQuote(score, acc, elapsed, bestCombo),
  }));

  pushFullProgress();
  location.href = `gameover.html?level=${gLevel}&diff=${gDiff}&timer=${gTimer ? 1 : 0}`;
}

function bindGameEvents() {
  document.getElementById('furi-btn').addEventListener('click', toggleFuri);

  document.addEventListener('keydown', e => {
    const activeTag = (document.activeElement && document.activeElement.tagName) || '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') { toggleFuri(); return; }
    const map = { '1':0, '2':1, '3':2, '4':3 };
    if (map[e.key] !== undefined) {
      const btns = Array.from(document.getElementById('opts-grid').children).filter(b => !b.disabled);
      if (btns[map[e.key]]) btns[map[e.key]].click();
    }
  });
}

(async function initGamePage() {
  await initCore();
  bindGameEvents();

  wordList = gLevel === 'ALL' ? Object.values(state.db).flat() : (state.db[gLevel] || []);
  if (wordList.length < 4) {
    toast('Données manquantes pour ce niveau.');
    setTimeout(() => { location.href = 'index.html'; }, 1600);
    return;
  }
  startGame();
})();
