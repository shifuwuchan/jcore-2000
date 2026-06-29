'use strict';
/* page-menu.js — Écran Menu (index.html)*/

function renderMenu() {
  const rank = getRank(state.permTotal);
  const nr   = getNext(state.permTotal);
  document.getElementById('mrc-name').textContent  = `${rank.label} ${rank.jp}`;
  document.getElementById('mrc-pts').textContent   = `${state.permTotal} pts`;
  document.getElementById('mrc-badge').innerHTML = rankIconHtml(rank);

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

  const rb = document.getElementById('rebirth-banner');
  if (rank.id === MAX_RANK.id) {
    rb.classList.remove('hidden');
    const boostPct = Math.round(state.rebirths * EXP_BOOST_PER_REBIRTH * 100);
    document.getElementById('rebirth-sub').textContent = `Rebirth ×${state.rebirths} · Boost XP +${boostPct}%`;
  } else {
    rb.classList.add('hidden');
  }

  document.getElementById('streak-text').textContent = `${state.dayStreak} jour${state.dayStreak === 1 ? '' : 's'} de suite`;
  document.getElementById('streak-chip').classList.toggle('on', state.dayStreak > 0);

  const allWords = Object.values(state.db).flat();
  const stats = getSRSStats(allWords); // srs.js
  // Affichage en "mots" plutôt qu'en "cartes" : chaque mot a 2 cartes
  // (lecture + production), donc on divise les compteurs par 2 pour
  // l'écran d'accueil. Math.ceil évite d'afficher 0 quand il reste 1
  // carte isolée (un seul sens commencé sur un mot donné).
  document.getElementById('anki-new-count').textContent    = Math.ceil(stats.newCount / 2);
  document.getElementById('anki-due-count').textContent    = Math.ceil(stats.due / 2);
  document.getElementById('anki-mature-count').textContent = Math.ceil(stats.mature / 2);
  document.getElementById('leech-count').textContent       = `(${Math.ceil(stats.leech / 2)})`;
  document.getElementById('mastered-count').textContent    = `(${Math.ceil(stats.mature / 2)})`;

  ['1','2','3','4'].forEach(l => {
    let best = 0;
    ['normal','hard','blitz'].forEach(d => { best = Math.max(best, state.hs[`${l}_${d}`] || 0); });
    const el = document.getElementById(`hs-${l}`);
    if (el) el.textContent = best > 0 ? `HS ${best}` : '';
  });

  const grid = document.getElementById('ranks-grid');
  grid.innerHTML = '';
  RANKS.forEach(r => {
    const d = document.createElement('div');
    d.className = `rk-chip${r.id === rank.id ? ' cur' : ''}`;
    d.innerHTML = `<span class="rk-icon">${rankIconHtml(r)}</span><span class="rk-lbl">${r.label}</span><span class="rk-pts">${r.min}pts</span>`;
    grid.appendChild(d);
  });
}

function renderAccountCard() {
  const guestEl  = document.getElementById('acc-guest');
  const loggedEl = document.getElementById('acc-logged');
  if (Cloud.isLoggedIn()) {
    guestEl.classList.add('hidden');
    loggedEl.classList.remove('hidden');
    document.getElementById('acc-username').textContent = state.cloudUsername || Cloud.currentEmail() || 'Connecté';
  } else {
    guestEl.classList.remove('hidden');
    loggedEl.classList.add('hidden');
  }
  document.getElementById('btn-admin').classList.toggle('hidden', !Cloud.isAdmin());
}

function openRebirthModal()  { document.getElementById('rebirth-modal').classList.remove('hidden'); }
function closeRebirthModal() { document.getElementById('rebirth-modal').classList.add('hidden'); }
function doRebirth() {
  state.rebirths++;
  state.permTotal = 0;
  save();
  closeRebirthModal();
  renderMenu();
  toast(`🔄 Rebirth #${state.rebirths} — bonne chance !`);
  pushFullProgress();
}

async function doLogout() {
  await Cloud.signOut();
  state.cloudUsername = null;
  resetLocalProgress();
  renderAccountCard();
  renderMenu(); // ré-affiche tout en mode invité (0 partout)
  toast('Déconnecté');
}

function bindMenuEvents() {
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('rebirth-btn').addEventListener('click', openRebirthModal);
  document.getElementById('rebirth-confirm').addEventListener('click', doRebirth);
  document.getElementById('rebirth-cancel').addEventListener('click', closeRebirthModal);

  // Easter egg (clic sur le wordmark)
  let easterClicks = 0;
  const wmName = document.querySelector('.wm-name');
  if (wmName) {
    wmName.addEventListener('click', () => {
      easterClicks++;
      if (easterClicks === 5)  { state.easterActive = true; save(); toast('Mode Shifu activé — vies infinies (niveau QCM)'); }
      if (easterClicks === 10) { wmName.textContent = 'Hiro King'; toast('Dieu du japonais débloqué'); }
    });
  }
}

(async function initMenuPage() {
  await initCore();
  bindMenuEvents();
  renderMenu();
  renderAccountCard();
})();
