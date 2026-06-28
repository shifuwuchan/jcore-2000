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
    <div class="player-row${p.is_admin ? ' is-admin' : ''}" data-id="${escHtml(p.user_id)}">
      <div class="pr-info">
        <div class="pr-name-row">
          <span class="pr-name">${escHtml(p.username || '—')}</span>
          ${p.is_admin ? '<span class="pr-admin-badge">ADMIN</span>' : ''}
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
  document.getElementById('admin-edit-msg').classList.add('hidden');

  // Empêche de se retirer ses propres droits admin par erreur (on
  // resterait bloqué hors de cet écran sans plus aucun admin restant).
  const isSelf = Cloud.currentUser() && Cloud.currentUser().id === p.user_id;
  document.getElementById('admin-f-isadmin').disabled = isSelf;
  document.getElementById('admin-edit-delete').classList.toggle('hidden', isSelf);

  document.getElementById('admin-edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('admin-edit-modal').classList.add('hidden');
  editingPlayer = null;
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

(async function initAdminPage() {
  await initCore();

  if (!Cloud.isLoggedIn() || !Cloud.isAdmin()) {
    document.getElementById('admin-denied').classList.remove('hidden');
    return;
  }

  document.getElementById('admin-wrap').classList.remove('hidden');
  await loadPlayers();

  document.getElementById('admin-search').addEventListener('input', e => renderPlayerList(e.target.value));
  document.getElementById('admin-f-isadmin').addEventListener('click', e => {
    if (!e.currentTarget.disabled) e.currentTarget.classList.toggle('active');
  });
  document.getElementById('admin-edit-save').addEventListener('click', saveEdit);
  document.getElementById('admin-edit-delete').addEventListener('click', deleteEdit);
  document.getElementById('admin-edit-cancel').addEventListener('click', closeEditModal);
})();
