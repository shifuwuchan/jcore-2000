'use strict';
/* page-gameover.js — Écran fin de partie QCM (gameover.html?level=...&diff=...&timer=...) */

(async function initGameoverPage() {
  await initCore();

  const goParams = new URLSearchParams(location.search);
  const level = goParams.get('level') || '1';
  const diff  = goParams.get('diff')  || 'normal';
  const timer = goParams.get('timer') || '1';

  let d = null;
  try { d = JSON.parse(sessionStorage.getItem('jc_gameover') || 'null'); } catch (e) { /* ignore */ }
  sessionStorage.removeItem('jc_gameover');

  if (!d) {
    // Accès direct sans partie jouée — retour au menu.
    location.href = 'index.html';
    return;
  }

  const prevRank = getRank(d.gameStartPermTotal);
  const newRank  = getRank(state.permTotal);
  const isRankUp = newRank.id !== prevRank.id;

  const title = document.getElementById('go-title');
  if (d.score >= 100) {
    title.className = 'go-title good'; title.textContent = 'Maître';
    document.getElementById('go-eyebrow').textContent = 'LÉGENDAIRE';
  } else if (d.score >= 50) {
    title.className = 'go-title good'; title.textContent = 'Solide';
    document.getElementById('go-eyebrow').textContent = 'BON RUN';
  } else {
    title.className = 'go-title fail'; title.textContent = 'Échec';
    document.getElementById('go-eyebrow').textContent = 'RÉSULTAT';
  }

  document.getElementById('st-score').textContent = d.score;
  document.getElementById('st-combo').textContent = d.bestCombo;
  document.getElementById('st-acc').textContent   = d.acc + '%';
  document.getElementById('st-time').textContent  = d.elapsed + 's';

  document.getElementById('grc-icon').innerHTML = rankIconHtml(newRank);
  document.getElementById('grc-name').textContent = `${newRank.label} ${newRank.jp}`;
  document.getElementById('grc-pts').textContent  = `${state.permTotal} pts au total`;

  const card = document.getElementById('go-rank-card');
  card.className = 'go-rank-card' + (newRank.id === MAX_RANK.id ? ' legend' : isRankUp ? ' rankup' : '');
  document.getElementById('grc-new').classList.toggle('hidden', !isRankUp);

  const cmp = document.getElementById('rank-cmp');
  if (isRankUp) {
    cmp.classList.remove('hidden');
    document.getElementById('rc-from').textContent = `${prevRank.label} ${prevRank.jp}`;
    document.getElementById('rc-to').textContent   = `${newRank.label} ${newRank.jp}`;
  } else {
    cmp.classList.add('hidden');
  }

  const nr = getNext(state.permTotal);
  const nbWrap = document.getElementById('nb-wrap');
  if (nr) {
    nbWrap.classList.remove('hidden');
    const prev  = RANKS[nr.i - 1];
    const range = nr.r.min - prev.min;
    const pct   = range > 0 ? Math.min(100, Math.round(((state.permTotal - prev.min) / range) * 100)) : 100;
    document.getElementById('nb-left').textContent  = newRank.label;
    document.getElementById('nb-right').textContent = `${nr.r.label} (${nr.r.min} pts)`;
    const fill = document.getElementById('nb-fill');
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = pct + '%'; }, 80);
  } else {
    nbWrap.classList.add('hidden');
  }

  document.getElementById('rec-banner').classList.toggle('hidden', !d.isRecord);
  document.getElementById('go-quote').textContent = d.quote;

  document.getElementById('btn-replay').addEventListener('click', () => {
    location.href = `game.html?level=${level}&diff=${diff}&timer=${timer}`;
  });
})();
