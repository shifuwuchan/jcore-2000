'use strict';
/* page-stats.js — Écran Stats (stats.html) */

(async function initStatsPage() {
  await initCore();

  const allWords = Object.values(state.db).flat();
  const s = getSRSStats(allWords); // srs.js
  const total = Math.max(1, s.newCount + s.learning + s.mature + s.leech);

  const bar = document.getElementById('stat-bar');
  bar.innerHTML =
    `<span class="sb-new" style="width:${s.newCount / total * 100}%"></span>` +
    `<span class="sb-learn" style="width:${s.learning / total * 100}%"></span>` +
    `<span class="sb-mature" style="width:${s.mature / total * 100}%"></span>` +
    `<span class="sb-leech" style="width:${s.leech / total * 100}%"></span>`;

  document.getElementById('sl-new').textContent    = Math.ceil(s.newCount / 2);
  document.getElementById('sl-learn').textContent  = Math.ceil(s.learning / 2);
  document.getElementById('sl-mature').textContent = Math.ceil(s.mature / 2);
  document.getElementById('sl-leech').textContent  = Math.ceil(s.leech / 2);

  const forecast = getForecast(allWords, 7); // srs.js
  const maxVal   = Math.max(1, ...forecast);
  const dayNames = ['Auj.', 'J+1', 'J+2', 'J+3', 'J+4', 'J+5', 'J+6'];
  const wrap = document.getElementById('forecast-bars');
  wrap.innerHTML = forecast.map((n, i) => `
    <div class="fc-col">
      <span class="fc-num">${n}</span>
      <div class="fc-fill" style="height:${Math.max(2, Math.round((n / maxVal) * 70))}px"></div>
      <span class="fc-day">${dayNames[i]}</span>
    </div>
  `).join('');
})();
