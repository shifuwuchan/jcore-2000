'use strict';
/* page-leaderboard.js — Écran Classement (leaderboard.html) */

let lbPeriod = 'day';

async function loadLeaderboard(period) {
  const list     = document.getElementById('lb-list');
  const empty    = document.getElementById('lb-empty');
  const guestMsg = document.getElementById('lb-guest');

  list.innerHTML = '';
  empty.classList.add('hidden');
  guestMsg.classList.toggle('hidden', Cloud.isLoggedIn() || !Cloud.isAvailable());

  if (!Cloud.isAvailable()) {
    empty.textContent = 'Classement indisponible — configuration Supabase manquante (voir SETUP.md).';
    empty.classList.remove('hidden');
    return;
  }

  const rows = await Cloud.fetchLeaderboard(period);
  if (!rows.length) {
    empty.textContent = "Personne ici pour l'instant — sois le premier !";
    empty.classList.remove('hidden');
    return;
  }

  rows.forEach((r, i) => {
    const rankNum   = i + 1;
    const isMe      = state.cloudUsername && r.username === state.cloudUsername;
    const rebirths  = r.rebirths || 0;
    const tierClass = rebirthTierClass(rebirths);
    const isStreak  = period === 'streak';
    const value     = isStreak ? r.day_streak : r.total_points;
    const suffix    = isStreak ? ` jour${value === 1 ? '' : 's'}` : ' pts';

    const div = document.createElement('div');
    div.className = 'lb-row' + (rankNum <= 3 ? ` top${rankNum}` : '') + (isMe ? ' me' : '');
    div.innerHTML =
      `<span class="lb-rank">${rankNum}</span>` +
      `<span class="lb-name ${tierClass}">${escHtml(r.username)}</span>` +
      (rebirths > 0 ? `<span class="lb-rebirth">🔄${rebirths}</span>` : '') +
      `<span class="lb-pts">${value}${suffix}</span>`;
    list.appendChild(div);
  });
}

function setLbPeriod(period) {
  lbPeriod = period;
  document.querySelectorAll('.diff-btn[data-period]').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  loadLeaderboard(period);
}

(async function initLeaderboardPage() {
  await initCore();
  document.querySelectorAll('.diff-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => setLbPeriod(btn.dataset.period));
  });
  loadLeaderboard(lbPeriod);
})();
