'use strict';
/* page-wordlist-editor.js — Écran Admin Vocabulaire (wordlist-editor.html)
   Écrit sur GitHub via l'Edge Function admin-vocab (cloud.js →
   Cloud.adminEditVocab). Le token GitHub ne touche jamais ce fichier —
   il vit uniquement comme secret côté Supabase Edge Function. */

let wleLevel = 1;
let wleWords = [];
let wleEditingId = null; // null = mode "ajout"

function renderWleList(filter) {
  const q = (filter || '').toLowerCase().trim();
  const filtered = !q ? wleWords : wleWords.filter(w =>
    w.kanji.includes(q) || w.kana.includes(q) || w.fr.toLowerCase().includes(q)
  );

  document.getElementById('wle-count').textContent =
    `${filtered.length} mot${filtered.length === 1 ? '' : 's'}${q ? ` (sur ${wleWords.length})` : ''}`;

  const list = document.getElementById('wle-list');
  list.innerHTML = filtered.map(w => `
    <div class="word-item" data-id="${escHtml(w.id)}" style="cursor:pointer;">
      <div>
        <span class="wi-jp">${escHtml(w.kanji)}</span>
        <span class="wi-kana">${escHtml(w.kana)}</span>
      </div>
      <div class="wi-fr">${escHtml(w.fr)}</div>
    </div>
  `).join('') || '<div class="lb-empty">Aucun mot ne correspond.</div>';

  list.querySelectorAll('.word-item').forEach(row => {
    row.addEventListener('click', () => openWleModal(row.dataset.id));
  });
}

function setWleLevel(level) {
  wleLevel = level;
  [1, 2, 3, 4].forEach(l => document.getElementById(`wle-tab-${l}`).classList.toggle('active', l === level));
  wleWords = state.db[String(level)] || [];
  document.getElementById('wle-search').value = '';
  renderWleList('');
}

function openWleModal(id) {
  wleEditingId = id || null;
  const w = id ? wleWords.find(x => x.id === id) : null;

  document.getElementById('wle-modal-title').textContent = w ? `Modifier ${w.id}` : 'Ajouter un mot';
  document.getElementById('wle-f-id').value    = w ? w.id    : `c${wleLevel}_`;
  document.getElementById('wle-f-id').disabled = !!w; // id jamais modifiable après création (clé SRS)
  document.getElementById('wle-f-kanji').value = w ? w.kanji : '';
  document.getElementById('wle-f-kana').value  = w ? w.kana  : '';
  document.getElementById('wle-f-fr').value    = w ? w.fr    : '';
  document.getElementById('wle-f-ex').value    = w ? w.ex    : '';
  document.getElementById('wle-modal-msg').classList.add('hidden');
  document.getElementById('wle-modal-delete').classList.toggle('hidden', !w);

  document.getElementById('wle-modal').classList.remove('hidden');
}

function closeWleModal() {
  document.getElementById('wle-modal').classList.add('hidden');
  wleEditingId = null;
}

function showWleMsg(text) {
  const msg = document.getElementById('wle-modal-msg');
  msg.textContent = text;
  msg.classList.remove('hidden');
}

async function saveWleModal() {
  const btn = document.getElementById('wle-modal-save');
  const id    = document.getElementById('wle-f-id').value.trim();
  const kanji = document.getElementById('wle-f-kanji').value.trim();
  const kana  = document.getElementById('wle-f-kana').value.trim();
  const fr    = document.getElementById('wle-f-fr').value.trim();
  const ex    = document.getElementById('wle-f-ex').value.trim();

  if (!id || !kanji || !kana || !fr) { showWleMsg('Identifiant, kanji, kana et traduction sont requis.'); return; }

  btn.disabled = true;
  const word = { id, kanji, kana, fr, ex };

  try {
    if (wleEditingId) {
      await Cloud.adminEditVocab('update', wleLevel, word, wleEditingId);
      const idx = wleWords.findIndex(w => w.id === wleEditingId);
      if (idx !== -1) wleWords[idx] = word;
      toast(`✅ ${id} mis à jour`);
    } else {
      await Cloud.adminEditVocab('add', wleLevel, word);
      wleWords.push(word);
      toast(`✅ ${id} ajouté`);
    }
    state.db[String(wleLevel)] = wleWords;
    closeWleModal();
    renderWleList(document.getElementById('wle-search').value);
  } catch (e) {
    showWleMsg(e.message || 'Erreur lors de la sauvegarde.');
  } finally {
    btn.disabled = false;
  }
}

async function deleteWleModal() {
  if (!wleEditingId) return;
  const ok = confirm(`Supprimer définitivement le mot "${wleEditingId}" ? Les joueurs ayant déjà révisé ce mot perdront sa progression SRS associée.`);
  if (!ok) return;

  try {
    await Cloud.adminEditVocab('delete', wleLevel, null, wleEditingId);
    wleWords = wleWords.filter(w => w.id !== wleEditingId);
    state.db[String(wleLevel)] = wleWords;
    toast(`🗑️ ${wleEditingId} supprimé`);
    closeWleModal();
    renderWleList(document.getElementById('wle-search').value);
  } catch (e) {
    showWleMsg(e.message || 'Erreur lors de la suppression.');
  }
}

(async function initWleEditorPage() {
  await initCore();

  if (!Cloud.isLoggedIn() || !Cloud.isAdmin()) {
    document.getElementById('wle-denied').classList.remove('hidden');
    return;
  }

  document.getElementById('wle-wrap').classList.remove('hidden');
  setWleLevel(1);

  [1, 2, 3, 4].forEach(l => {
    document.getElementById(`wle-tab-${l}`).addEventListener('click', () => setWleLevel(l));
  });
  document.getElementById('wle-search').addEventListener('input', e => renderWleList(e.target.value));
  document.getElementById('wle-add-btn').addEventListener('click', () => openWleModal(null));
  document.getElementById('wle-modal-save').addEventListener('click', saveWleModal);
  document.getElementById('wle-modal-delete').addEventListener('click', deleteWleModal);
  document.getElementById('wle-modal-cancel').addEventListener('click', closeWleModal);
})();
