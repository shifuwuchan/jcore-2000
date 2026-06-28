'use strict';
/* page-wordlist.js — Écran Liste des mots (wordlist.html?level=1|2|3|4|ALL) */

const wlParams = new URLSearchParams(location.search);
const wlLevel  = wlParams.get('level') || '1';
let wlWords    = [];

function renderWordList(list) {
  document.getElementById('list-count').textContent = `${list.length} mots`;
  const el = document.getElementById('word-list');
  el.innerHTML = '';
  list.forEach(w => {
    const d = document.createElement('div');
    d.className = 'word-item';
    d.innerHTML = `<div>
      <span class="wi-jp">${escHtml(w.kanji)}</span>
      <span class="wi-kana">${escHtml(w.kana)}</span>
    </div>
    <div class="wi-fr">${escHtml(w.fr)}</div>`;
    el.appendChild(d);
  });
}

function filterWordList(q) {
  q = q.toLowerCase().trim();
  renderWordList(wlWords.filter(w =>
    w.kanji.includes(q) || w.kana.includes(q) || w.fr.toLowerCase().includes(q)
  ));
}

(async function initWordlistPage() {
  await initCore();

  wlWords = wlLevel === 'ALL' ? Object.values(state.db).flat() : (state.db[wlLevel] || []);
  renderWordList(wlWords);

  document.getElementById('list-search').addEventListener('input', e => filterWordList(e.target.value));
})();
