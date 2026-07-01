'use strict';
/* page-admin.js — Écran Admin (admin.html)
   Sécurité réelle = côté serveur (policies RLS + RPC qui vérifient
   public.is_admin() en SQL, voir schema.sql). Tout ce qui suit côté
   client est uniquement de l'UX — un faux is_admin côté JS ne donne
   jamais accès aux vraies données d'autrui. */

let allPlayers = [];
let editingPlayer = null;

function renderPlayerList(filter) {
  const list = document.getElementById('admin-list');
  const q = (filter || '').trim().toLowerCase();

  const filtered = !q ? allPlayers : allPlayers.filter(p =>
    (p.username || '').toLowerCase().includes(q) ||
    (p.email || '').toLowerCase().includes(q)
  );

  document.getElementById('admin-count').textContent =
    `${filtered.length} joueur${filtered.length === 1 ? '' : 's'}${q ? ` (sur ${allPlayers.length})` : ''}`;

  list.innerHTML = filtered.map(p => `
    <div class="player-row${p.is_admin ? ' is-admin' : ''}${p.banned ? ' is-banned' : ''}" data-id="${escHtml(p.user_id)}">
      <div class="pr-info">
        <div class="pr-name-row">
          <span class="pr-name">${escHtml(p.username || '—')}</span>
          ${p.is_admin ? '<span class="pr-admin-badge">ADMIN</span>' : ''}
          ${p.banned ? '<span class="pr-ban-badge">BANNI</span>' : ''}
        </div>
        <span class="pr-email">${escHtml(p.email || '')}</span>
      </div>
      <div class="pr-stats">
        <span><b>${p.perm_total}</b> pts</span>
        <span><b>${p.rebirths}</b> rb</span>
      </div>
      <span class="pr-chevron">›</span>
    </div>
  `).join('') || '<div class="lb-empty">Aucun joueur ne correspond.</div>';

  list.querySelectorAll('.player-row').forEach(row => {
    row.addEventListener('click', () => openEditModal(row.dataset.id));
  });
}

async function loadPlayers() {
  allPlayers = await Cloud.adminListPlayers();
  renderPlayerList(document.getElementById('admin-search').value);
}

function openEditModal(userId) {
  const p = allPlayers.find(x => x.user_id === userId);
  if (!p) return;
  editingPlayer = p;

  document.getElementById('admin-edit-title').textContent = `Modifier ${p.username || p.email}`;
  document.getElementById('admin-f-username').value   = p.username || '';
  document.getElementById('admin-f-permtotal').value  = p.perm_total;
  document.getElementById('admin-f-rebirths').value   = p.rebirths;
  document.getElementById('admin-f-lifetime').value   = p.lifetime_total;
  document.getElementById('admin-f-streak').value     = p.day_streak;
  document.getElementById('admin-f-isadmin').classList.toggle('active', !!p.is_admin);
  document.getElementById('admin-f-banned').classList.toggle('active', !!p.banned);
  document.getElementById('admin-edit-msg').classList.add('hidden');
  document.getElementById('admin-srs-detail').classList.add('hidden');
  document.getElementById('admin-srs-detail').innerHTML = '';
  document.getElementById('admin-srs-toggle').textContent = '📊 Voir le détail SRS';

  // Empêche de se retirer ses propres droits admin (ou de se bannir
  // soi-même) par erreur — on resterait bloqué hors de cet écran.
  const isSelf = Cloud.currentUser() && Cloud.currentUser().id === p.user_id;
  document.getElementById('admin-f-isadmin').disabled = isSelf;
  document.getElementById('admin-f-banned').disabled  = isSelf;
  document.getElementById('admin-edit-delete').classList.toggle('hidden', isSelf);

  document.getElementById('admin-edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('admin-edit-modal').classList.add('hidden');
  editingPlayer = null;
}

/**
 * Reproduit la logique de getSRSStats() (srs.js) mais sur un srsData
 * arbitraire passé en paramètre, sans jamais toucher à state.srsData
 * (qui reste celui du compte admin connecté localement). DIRECTIONS
 * et cardId() viennent de srs.js, chargé avant ce script.
 */
function computeSrsStatsFor(srsData, wordList) {
  const now = Date.now();
  let newCount = 0, due = 0, learning = 0, mature = 0, leech = 0;
  wordList.forEach(w => DIRECTIONS.forEach(dir => {
    const id = cardId(w.id, dir);
    const e = srsData[id];
    if (!e || e.totalReviews === 0) { newCount++; return; }
    if (e.isLeech) { leech++; return; }
    if (e.stage === 'mature') { mature++; if (e.nextReview <= now) due++; }
    else { learning++; if (e.nextReview <= now) due++; }
  }));
  return { newCount, due, learning, mature, leech };
}

async function toggleSrsDetail() {
  const detail = document.getElementById('admin-srs-detail');
  const btn = document.getElementById('admin-srs-toggle');

  if (!detail.classList.contains('hidden')) {
    detail.classList.add('hidden');
    btn.textContent = '📊 Voir le détail SRS';
    return;
  }

  btn.textContent = 'Chargement…';
  const srsData = await Cloud.adminGetPlayerSrs(editingPlayer.user_id);
  const wordList = Object.values(state.db).flat();
  const s = computeSrsStatsFor(srsData, wordList);

  detail.innerHTML = `
    <div class="anki-stats" style="margin-bottom:14px;">
      <div class="anki-stat"><span class="as-num">${Math.ceil(s.newCount/2)}</span><span class="as-lbl">Nouveaux</span></div>
      <div class="anki-stat"><span class="as-num">${Math.ceil(s.learning/2)}</span><span class="as-lbl">En cours</span></div>
      <div class="anki-stat"><span class="as-num">${Math.ceil(s.mature/2)}</span><span class="as-lbl">Maîtrisés</span></div>
    </div>
    <div class="pr-stats" style="margin-bottom:14px;">
      <span>À réviser : <b>${s.due}</b></span>
      <span>Mots difficiles : <b>${s.leech}</b></span>
    </div>
  `;
  detail.classList.remove('hidden');
  btn.textContent = '📊 Masquer le détail SRS';
}

function showEditMsg(text) {
  const msg = document.getElementById('admin-edit-msg');
  msg.textContent = text;
  msg.classList.remove('hidden');
}

async function saveEdit() {
  if (!editingPlayer) return;
  const btn = document.getElementById('admin-edit-save');
  btn.disabled = true;

  const fields = {
    username: document.getElementById('admin-f-username').value.trim(),
    permTotal: parseInt(document.getElementById('admin-f-permtotal').value, 10) || 0,
    rebirths: parseInt(document.getElementById('admin-f-rebirths').value, 10) || 0,
    lifetimeTotal: parseInt(document.getElementById('admin-f-lifetime').value, 10) || 0,
    dayStreak: parseInt(document.getElementById('admin-f-streak').value, 10) || 0,
    isAdmin: document.getElementById('admin-f-isadmin').classList.contains('active'),
    banned: document.getElementById('admin-f-banned').classList.contains('active'),
  };

  try {
    await Cloud.adminUpdatePlayer(editingPlayer.user_id, fields);
    toast(`✅ ${fields.username} mis à jour`);
    closeEditModal();
    await loadPlayers();
  } catch (e) {
    showEditMsg(e.message || 'Erreur lors de la sauvegarde.');
  } finally {
    btn.disabled = false;
  }
}

async function deleteEdit() {
  if (!editingPlayer) return;
  const ok = confirm(`Supprimer définitivement le compte de "${editingPlayer.username}" ? Cette action est irréversible.`);
  if (!ok) return;

  try {
    await Cloud.adminDeletePlayer(editingPlayer.user_id);
    toast(`🗑️ Compte de ${editingPlayer.username} supprimé`);
    closeEditModal();
    await loadPlayers();
  } catch (e) {
    showEditMsg(e.message || 'Erreur lors de la suppression.');
  }
}

/* ─── Bandeau de stats globales ─────────────────────────────── */
async function loadGlobalStats() {
  const s = await Cloud.adminGetGlobalStats();
  if (!s) return;
  document.getElementById('ast-total').textContent    = s.total_players;
  document.getElementById('ast-active').textContent   = s.active_7d;
  document.getElementById('ast-points').textContent   = s.total_points;
  document.getElementById('ast-rebirths').textContent = s.total_rebirths;
  document.getElementById('ast-banned').textContent   = s.banned_count;
}

/* ─── Onglets ─────────────────────────────────────────────────── */
function setAdminTab(tab) {
  document.getElementById('admin-tab-players').classList.toggle('active', tab === 'players');
  document.getElementById('admin-tab-leaderboard').classList.toggle('active', tab === 'leaderboard');
  document.getElementById('admin-tab-log').classList.toggle('active', tab === 'log');
  document.getElementById('admin-panel-players').classList.toggle('hidden', tab !== 'players');
  document.getElementById('admin-panel-leaderboard').classList.toggle('hidden', tab !== 'leaderboard');
  document.getElementById('admin-panel-log').classList.toggle('hidden', tab !== 'log');

  if (tab === 'leaderboard') loadAdminLeaderboard(adminLbPeriod);
  if (tab === 'log') loadAdminLog();
}

/* ─── Mini-classement intégré (réutilise Cloud.fetchLeaderboard) ── */
let adminLbPeriod = 'all';

async function loadAdminLeaderboard(period) {
  adminLbPeriod = period;
  document.getElementById('admin-lb-all').classList.toggle('active', period === 'all');
  document.getElementById('admin-lb-week').classList.toggle('active', period === 'week');
  document.getElementById('admin-lb-streak').classList.toggle('active', period === 'streak');

  const list = document.getElementById('admin-lb-list');
  list.innerHTML = '<div class="lb-empty">Chargement…</div>';

  const rows = await Cloud.fetchLeaderboard(period);
  if (!rows.length) { list.innerHTML = '<div class="lb-empty">Aucune donnée.</div>'; return; }

  list.innerHTML = rows.map((r, i) => {
    const rankNum = i + 1;
    const isStreak = period === 'streak';
    const value = isStreak ? r.day_streak : r.total_points;
    const suffix = isStreak ? ` jour${value === 1 ? '' : 's'}` : ' pts';
    const tierClass = rebirthTierClass(r.rebirths || 0);
    return `<div class="lb-row${rankNum <= 3 ? ` top${rankNum}` : ''}">` +
      `<span class="lb-rank">${rankNum}</span>` +
      `<span class="lb-name ${tierClass}">${escHtml(r.username)}</span>` +
      `${r.rebirths > 0 ? `<span class="lb-rebirth">🔄${r.rebirths}</span>` : ''}` +
      `<span class="lb-pts">${value}${suffix}</span>` +
      `</div>`;
  }).join('');
}

/* ─── Journal des actions admin ──────────────────────────────── */
function describeLogEntry(entry) {
  const who = entry.admin_username || 'Un admin';
  const target = entry.target_username || '(compte supprimé)';
  if (entry.action === 'delete_player') return `${who} a supprimé le compte de ${target}`;
  if (entry.action === 'update_player') {
    const changes = Object.entries(entry.details || {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
    return `${who} a modifié ${target} (${changes || 'aucun changement détecté'})`;
  }
  if (entry.action === 'vocab_update' || entry.action === 'vocab_add' || entry.action === 'vocab_delete') {
    const verb = { vocab_update: 'modifié', vocab_add: 'ajouté', vocab_delete: 'supprimé' }[entry.action];
    const wordId = entry.details?.word_id || '?';
    return `${who} a ${verb} le mot ${wordId} (niveau ${entry.details?.level || '?'})`;
  }
  return `${who} → ${entry.action} sur ${target}`;
}

async function loadAdminLog() {
  const list = document.getElementById('admin-log-list');
  const countEl = document.getElementById('admin-log-count');
  list.innerHTML = '<div class="lb-empty">Chargement…</div>';

  const rows = await Cloud.adminGetLog();
  countEl.textContent = `${rows.length} action${rows.length === 1 ? '' : 's'} (50 dernières)`;

  if (!rows.length) { list.innerHTML = '<div class="lb-empty">Aucune action enregistrée.</div>'; return; }

  list.innerHTML = rows.map(r => `
    <div class="log-entry">
      <div class="log-entry-text">${escHtml(describeLogEntry(r))}</div>
      <div class="log-entry-date">${new Date(r.created_at).toLocaleString('fr-FR')}</div>
    </div>
  `).join('');
}

(async function initAdminPage() {
  await initCore();

  if (!Cloud.isLoggedIn() || !Cloud.isAdmin()) {
    document.getElementById('admin-denied').classList.remove('hidden');
    return;
  }

  document.getElementById('admin-wrap').classList.remove('hidden');
  await loadGlobalStats();
  await loadPlayers();

  document.getElementById('admin-search').addEventListener('input', e => renderPlayerList(e.target.value));
  document.getElementById('admin-f-isadmin').addEventListener('click', e => {
    if (!e.currentTarget.disabled) e.currentTarget.classList.toggle('active');
  });
  document.getElementById('admin-f-banned').addEventListener('click', e => {
    if (!e.currentTarget.disabled) e.currentTarget.classList.toggle('active');
  });
  document.getElementById('admin-srs-toggle').addEventListener('click', toggleSrsDetail);
  document.getElementById('admin-edit-save').addEventListener('click', saveEdit);
  document.getElementById('admin-edit-delete').addEventListener('click', deleteEdit);
  document.getElementById('admin-edit-cancel').addEventListener('click', closeEditModal);

  document.getElementById('admin-tab-players').addEventListener('click', () => setAdminTab('players'));
  document.getElementById('admin-tab-leaderboard').addEventListener('click', () => setAdminTab('leaderboard'));
  document.getElementById('admin-tab-log').addEventListener('click', () => setAdminTab('log'));
  document.getElementById('admin-lb-all').addEventListener('click', () => loadAdminLeaderboard('all'));
  document.getElementById('admin-lb-week').addEventListener('click', () => loadAdminLeaderboard('week'));
  document.getElementById('admin-lb-streak').addEventListener('click', () => loadAdminLeaderboard('streak'));
})();
