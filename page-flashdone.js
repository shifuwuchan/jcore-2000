'use strict';
/* page-flashdone.js — Écran fin de session (flashdone.html?mode=...&level=...) */

(async function initFlashdonePage() {
  await initCore();

  const fdParams = new URLSearchParams(location.search);
  const mode  = fdParams.get('mode')  || 'normal';
  const level = fdParams.get('level') || '1';

  let data = null;
  try { data = JSON.parse(sessionStorage.getItem('jc_flashdone') || 'null'); } catch (e) { /* ignore */ }
  sessionStorage.removeItem('jc_flashdone');

  if (data) {
    document.getElementById('done-stats').innerHTML = `
      <div class="done-stat"><span class="ds-num">${data.total}</span><span class="ds-lbl">Cartes</span></div>
      <div class="done-stat"><span class="ds-num">${data.easy}</span><span class="ds-lbl">Facile</span></div>
      <div class="done-stat"><span class="ds-num">${data.retravailler}</span><span class="ds-lbl">À retravailler</span></div>
    `;
    document.getElementById('done-rank').textContent = `${data.dueLeft} cartes encore dues aujourd'hui`;
  }

  document.getElementById('btn-flash-again').addEventListener('click', () => {
    location.href = `flashcard.html?mode=${mode}&level=${level}`;
  });
})();
