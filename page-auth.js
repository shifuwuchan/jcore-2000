'use strict';
/* page-auth.js — Écran Compte (auth.html) */

let authMode = 'login';

function renderAuthScreen() {
  const formWrap = document.getElementById('auth-form-wrap');
  const profWrap = document.getElementById('auth-profile-wrap');
  if (Cloud.isLoggedIn()) {
    formWrap.classList.add('hidden');
    profWrap.classList.remove('hidden');
    document.getElementById('profile-username').textContent = state.cloudUsername || '—';
    document.getElementById('profile-email').textContent    = Cloud.currentEmail() || '';
  } else {
    formWrap.classList.remove('hidden');
    profWrap.classList.add('hidden');
    document.getElementById('auth-msg').classList.add('hidden');
  }
}

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('auth-tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('auth-tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('auth-username-field').classList.toggle('hidden', mode === 'login');
  document.getElementById('btn-auth-submit').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  document.getElementById('auth-msg').classList.add('hidden');
}

function showAuthMsg(text, ok) {
  const msg = document.getElementById('auth-msg');
  msg.textContent = text;
  msg.classList.remove('hidden');
  msg.classList.toggle('ok', !!ok);
}

function translateAuthError(message) {
  if (!message) return 'Une erreur est survenue.';
  if (/already registered|already exists/i.test(message)) return 'Un compte existe déjà avec cet email.';
  if (/Invalid login credentials/i.test(message))          return 'Email ou mot de passe incorrect.';
  if (/Password should be at least/i.test(message))        return 'Mot de passe trop court (6 caractères minimum).';
  if (/déjà pris/i.test(message))                           return message;
  return message;
}

async function handleAuthSubmit() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const username  = document.getElementById('auth-username').value.trim();
  const btn      = document.getElementById('btn-auth-submit');

  document.getElementById('auth-msg').classList.add('hidden');

  if (!Cloud.isAvailable()) { showAuthMsg('Comptes indisponibles — configuration Supabase manquante (voir SETUP.md).'); return; }
  if (!email || !password)  { showAuthMsg('Email et mot de passe requis.'); return; }
  if (authMode === 'signup' && username.length < 3) { showAuthMsg('Choisis un pseudo de 3 caractères minimum.'); return; }

  btn.disabled = true;
  try {
    if (authMode === 'login') {
      await Cloud.signIn(email, password);
      state.cloudUsername = await Cloud.getUsername();
    } else {
      await Cloud.signUp(email, password, username);
      state.cloudUsername = username;
    }
    await syncOnLogin();
    toast(`☁️ Connecté en tant que ${state.cloudUsername}`);
    location.href = 'index.html';
  } catch (e) {
    if (e.message === 'CONFIRM_EMAIL') {
      showAuthMsg('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse avant de te connecter.', true);
    } else {
      showAuthMsg(translateAuthError(e.message));
    }
  } finally {
    btn.disabled = false;
  }
}

async function doLogout() {
  await Cloud.signOut();
  state.cloudUsername = null;
  resetLocalProgress();
  location.href = 'index.html';
}

(async function initAuthPage() {
  await initCore();
  renderAuthScreen();

  document.getElementById('auth-tab-login').addEventListener('click', () => setAuthMode('login'));
  document.getElementById('auth-tab-signup').addEventListener('click', () => setAuthMode('signup'));
  document.getElementById('btn-auth-submit').addEventListener('click', handleAuthSubmit);
  document.getElementById('btn-auth-logout').addEventListener('click', doLogout);
})();
