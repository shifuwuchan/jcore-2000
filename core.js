/* ═══════════════════════════════════════════════════════
   core.js — J-Core 2000 · Logique partagée entre toutes les pages
   Chargé sur CHAQUE page, après srs.js et cloud.js, avant le
   script spécifique à la page (page-xxx.js).
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════
   CONSTANTES — 16 GRADES
══════════════════════════════════════ */
const RANKS = [
  { id:'mukyu',    label:'Mukyū',    jp:'無級', icon:'⬜', swatch:'#E7E7EC', min:0 },
  { id:'r6kyu',   label:'Rokkyu',   jp:'六級', icon:'⬜', swatch:'#E7E7EC', min:50 },
  { id:'r5kyu',   label:'Gokyu',    jp:'五級', icon:'🟦', swatch:'#4D8FD6', min:150 },
  { id:'r4kyu',   label:'Yonkyu',   jp:'四級', icon:'🟦', swatch:'#4D8FD6', min:300 },
  { id:'r3kyu',   label:'Sankyu',   jp:'三級', icon:'🟩', swatch:'#4FAE5C', min:500 },
  { id:'r2kyu',   label:'Nikkyu',   jp:'二級', icon:'🟩', swatch:'#4FAE5C', min:750 },
  { id:'r1kyu',   label:'Ikkyu',    jp:'一級', icon:'🟫', swatch:'#A1714A', min:1100 },
  { id:'shodan',  label:'Shodan',   jp:'初段', icon:'⬛', swatch:'#3B3B42', min:1500 },
  { id:'nidan',   label:'Nidan',    jp:'二段', icon:'⬛', swatch:'#3B3B42', min:2100 },
  { id:'sandan',  label:'Sandan',   jp:'三段', icon:'🟪', swatch:'#8B5FD6', min:2800 },
  { id:'yondan',  label:'Yondan',   jp:'四段', icon:'🟪', swatch:'#8B5FD6', min:3700 },
  { id:'godan',   label:'Godan',    jp:'五段', icon:'🟥', swatch:'#D6544D', min:4800 },
  { id:'rokudan', label:'Rokudan',  jp:'六段', icon:'🟥', swatch:'#D6544D', min:6200 },
  { id:'nanadan', label:'Nanadan',  jp:'七段', icon:'🏅', swatch:null, min:8000 },
  { id:'hachidan',label:'Hachidan', jp:'八段', icon:'👑', swatch:null, min:10000 },
  { id:'hanshi',  label:'Hanshi',   jp:'範士', icon:'⚡', swatch:null, min:13000 },
];
const MAX_RANK = RANKS[RANKS.length - 1];

/**
 * Retourne le HTML d'icône d'un rang : un carré de couleur fiable en
 * CSS pour les 13 premiers rangs (l'emoji "carré coloré" ne s'affiche
 * pas correctement sur tous les appareils), et l'emoji directement
 * pour les 3 derniers (médaille/couronne/éclair, très bien supportés).
 * @param {Object} rank
 * @returns {string}
 */
function rankIconHtml(rank) {
  if (rank.swatch) return `<span class="rank-swatch" style="background:${rank.swatch}"></span>`;
  return rank.icon;
}

const getRank = pts => { let r = RANKS[0]; for (const x of RANKS) { if (pts >= x.min) r = x; else break; } return r; };
const getNext = pts => { for (let i = 0; i < RANKS.length; i++) if (RANKS[i].min > pts) return { r: RANKS[i], i }; return null; };

/* ══════════════════════════════════════
   POINTS — boost rebirth, Anki, classement
══════════════════════════════════════ */
const ANKI_MASTERY_POINTS = 10;
const ANKI_RATING_POINTS  = { blackout: 0, hard: 0, medium: 1, easy: 2 };
const EXP_BOOST_PER_REBIRTH = 0.05;

const DAILY_NEW_WORD_QUOTA       = 10;
const SESSION_NEW_WORD_CAP       = 3;
const BACKLOG_THROTTLE_THRESHOLD = 40;

function applyBoost(base) {
  return Math.round(base * (1 + state.rebirths * EXP_BOOST_PER_REBIRTH));
}

function rebirthTierClass(rebirths) {
  if (rebirths >= 10) return 'rt-mythic';
  if (rebirths >= 6)  return 'rt-legend';
  if (rebirths >= 3)  return 'rt-epic';
  if (rebirths >= 1)  return 'rt-rare';
  return '';
}

/* ══════════════════════════════════════
   ÉTAT PARTAGÉ (persistant + base de mots)
   Les pages ajoutent leurs propres champs transitoires (score,
   flashQueue...) directement sur cet objet — il ne survit pas à la
   navigation, c'est voulu : chaque page repart d'un état propre et
   ne lit que ce qui est dans localStorage / l'URL / sessionStorage.
══════════════════════════════════════ */
const state = {
  db: {},
  hs: {},
  permTotal: 0,
  rebirths: 0,
  lifetimeTotal: 0,
  dayStreak: 0,
  lastActiveDate: null,
  streakFreezeUsedDate: null,
  newWordsToday: 0,
  newWordsDate: null,
  srsData: {},
  cloudUsername: null,
  kbOverlay: null,
  easterActive: false,
};

/* Alias : srs.js utilise "store" — pointe sur state */
const store = state;

/* ══════════════════════════════════════
   PERSISTANCE — localStorage
══════════════════════════════════════ */
function loadStorage() {
  try { state.hs             = JSON.parse(localStorage.getItem('jc_hs5')      || '{}'); } catch (e) { state.hs = {}; }
  try { state.permTotal      = parseInt(localStorage.getItem('jc_total5')     || '0') || 0; } catch (e) { /* ignore */ }
  try { state.rebirths       = parseInt(localStorage.getItem('jc_rebirth5')   || '0') || 0; } catch (e) { /* ignore */ }
  try { state.lifetimeTotal  = parseInt(localStorage.getItem('jc_lifetime')   || '0') || 0; } catch (e) { /* ignore */ }
  try { state.srsData        = JSON.parse(localStorage.getItem('jc_srs')      || '{}'); } catch (e) { state.srsData = {}; }
  try { state.dayStreak      = parseInt(localStorage.getItem('jc_streak')     || '0') || 0; } catch (e) { /* ignore */ }
  try { state.lastActiveDate = localStorage.getItem('jc_lastactive') || null; }              catch (e) { /* ignore */ }
  try { state.streakFreezeUsedDate = localStorage.getItem('jc_freezeused') || null; }        catch (e) { /* ignore */ }
  try { state.newWordsToday  = parseInt(localStorage.getItem('jc_newcount')   || '0') || 0; } catch (e) { /* ignore */ }
  try { state.newWordsDate   = localStorage.getItem('jc_newdate') || null; }                  catch (e) { /* ignore */ }
  try { state.easterActive   = localStorage.getItem('jc_easter') === '1'; }                    catch (e) { /* ignore */ }
}

function save() {
  try { localStorage.setItem('jc_hs5',      JSON.stringify(state.hs)); }        catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_total5',   String(state.permTotal)); }         catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_rebirth5', String(state.rebirths)); }          catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_lifetime', String(state.lifetimeTotal)); }     catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_srs',      JSON.stringify(state.srsData)); }   catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_newcount', String(state.newWordsToday)); }     catch (e) { /* ignore */ }
  try { if (state.newWordsDate) localStorage.setItem('jc_newdate', state.newWordsDate); } catch (e) { /* ignore */ }
  try { if (state.streakFreezeUsedDate) localStorage.setItem('jc_freezeused', state.streakFreezeUsedDate); } catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_rebirth5', String(state.rebirths)); }          catch (e) { /* ignore */ }
  try { if (state.lastActiveDate) localStorage.setItem('jc_lastactive', state.lastActiveDate); } catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_easter', state.easterActive ? '1' : '0'); } catch (e) { /* ignore */ }
}

/** Remet à zéro la progression locale (state + localStorage). Utilisé
 *  à la déconnexion pour qu'un compte vide/invité ne voie jamais les
 *  valeurs laissées par le compte précédemment connecté sur ce navigateur. */
function resetLocalProgress() {
  state.hs = {};
  state.permTotal = 0;
  state.rebirths = 0;
  state.lifetimeTotal = 0;
  state.srsData = {};
  state.dayStreak = 0;
  state.lastActiveDate = null;
  state.streakFreezeUsedDate = null;
  state.newWordsToday = 0;
  state.newWordsDate = null;
  state.easterActive = false;
  ['jc_hs5','jc_total5','jc_rebirth5','jc_lifetime','jc_srs','jc_newcount',
   'jc_newdate','jc_freezeused','jc_lastactive','jc_easter'].forEach(k => {
    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
  });
}

/* ══════════════════════════════════════
   DATES & STREAK
══════════════════════════════════════ */
function getLocalDateString(d) {
  d = d || new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + 'T00:00:00');
  const b = new Date(dateStrB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/**
 * Enregistre l'activité du jour et met à jour le day streak (avec
 * streak freeze : 1 jour de grâce par semaine glissante). Idempotent.
 * Appelé au début d'une partie QCM ou d'une session flashcard.
 */
function recordActivity() {
  const today = getLocalDateString();
  if (state.lastActiveDate === today) return;

  if (!state.lastActiveDate) {
    state.dayStreak = 1;
  } else {
    const gap = daysBetween(state.lastActiveDate, today);
    const freezeRecentlyUsed = state.streakFreezeUsedDate && daysBetween(state.streakFreezeUsedDate, today) < 7;
    if (gap === 1) {
      state.dayStreak += 1;
    } else if (gap === 2 && !freezeRecentlyUsed) {
      state.dayStreak += 1;
      state.streakFreezeUsedDate = today;
      toast('🧊 Streak freeze utilisé — série sauvée !');
    } else {
      state.dayStreak = 1;
    }
  }
  state.lastActiveDate = today;
  save();

  const milestones = { 3:'🔥 3 jours de suite', 7:'🔥 1 semaine de suite !', 30:'🔥 1 mois de suite !!', 100:'🔥 100 jours, légendaire' };
  if (milestones[state.dayStreak]) toast(milestones[state.dayStreak]);

  pushFullProgress();
}

/* ══════════════════════════════════════
   QUOTA ANKI (nouveaux mots/jour)
══════════════════════════════════════ */
function getDailyRemaining() {
  const today = getLocalDateString();
  if (state.newWordsDate !== today) return DAILY_NEW_WORD_QUOTA;
  return Math.max(0, DAILY_NEW_WORD_QUOTA - state.newWordsToday);
}

function incrementDailyNewCount() {
  const today = getLocalDateString();
  if (state.newWordsDate !== today) { state.newWordsDate = today; state.newWordsToday = 0; }
  state.newWordsToday++;
  save();
}

/* ══════════════════════════════════════
   SYNC CLOUD (best-effort)
   Depuis l'admin panel, le cloud doit pouvoir corriger n'importe
   quel compte sans qu'un ancien état local ne lui résiste : la
   logique de merge "garde le meilleur des deux" a donc été retirée
   au profit d'un simple écrasement local <- cloud (voir syncOnLogin).
══════════════════════════════════════ */

async function syncOnLogin() {
  try {
    const cloudData = await Cloud.pullProgress();

    if (cloudData) {
      // Le cloud est la seule source de vérité dès qu'une session existe :
      // on REMPLACE le state local (pas de merge "garde le meilleur des
      // deux"). Nécessaire en multi-comptes sur le même navigateur — sinon
      // les valeurs du compte précédent restent visibles/écrasent celles
      // qu'on vient de modifier (ex. depuis le panneau admin).
      // Contrepartie acceptée : une session jouée hors-ligne juste avant
      // une reconnexion sera écrasée par le cloud plutôt que fusionnée.
      state.permTotal      = cloudData.perm_total ?? 0;
      state.rebirths        = cloudData.rebirths ?? 0;
      state.lifetimeTotal   = cloudData.lifetime_total ?? 0;
      state.hs              = cloudData.hs || {};
      state.srsData         = cloudData.srs_data || {};
      state.dayStreak        = cloudData.day_streak ?? 0;
      state.lastActiveDate   = cloudData.last_active || null;
      state.streakFreezeUsedDate = cloudData.last_freeze_used || null;
      save();
    } else {
      // Compte tout neuf, jamais encore de ligne progress côté cloud :
      // on initialise le cloud à partir de l'état local actuel (premier push).
      await pushFullProgress();
    }
  } catch (e) {
    console.error('[Sync] syncOnLogin a échoué', e);
  }
}

async function pushFullProgress() {
  if (!Cloud.isLoggedIn()) return;
  try {
    await Cloud.pushProgress({
      permTotal: state.permTotal, rebirths: state.rebirths, lifetimeTotal: state.lifetimeTotal,
      hs: state.hs, srsData: state.srsData, dayStreak: state.dayStreak,
      lastActive: state.lastActiveDate, lastFreezeUsed: state.streakFreezeUsedDate,
    });
  } catch (e) {
    console.error('[Sync] pushFullProgress a échoué', e);
  }
}

/**
 * Accorde le bonus de points quand une carte devient mature pour la
 * première fois — partagé entre le mode flashcard et le mode QCM.
 */
function awardMasteryBonus() {
  const gained   = applyBoost(ANKI_MASTERY_POINTS);
  const prevRank = getRank(state.permTotal);
  state.permTotal     += gained;
  state.lifetimeTotal += gained;
  save();
  Cloud.logPoints(gained).catch(() => { /* best-effort */ });

  const newRank = getRank(state.permTotal);
  if (newRank.id !== prevRank.id) toast(`🎉 ${newRank.label} ${newRank.jp} — carte acquise +${gained} pts`);
  else toast(`📌 Carte acquise ! +${gained} pts`);
}

/* ══════════════════════════════════════
   UTILITAIRES
══════════════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function flash(color) {
  const f = document.getElementById('sf');
  if (!f) return;
  f.style.background = color;
  f.style.opacity = '1';
  setTimeout(() => { f.style.opacity = '0'; }, 110);
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2100);
}

/* ══════════════════════════════════════
   THÈME
══════════════════════════════════════ */
function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('jc_theme') || 'dark'; } catch (e) { /* ignore */ }
  document.documentElement.dataset.theme = saved;
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = saved === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('jc_theme', next); } catch (e) { /* ignore */ }
}

/* ══════════════════════════════════════
   NAVIGATION GLOBALE
   Vraies pages séparées : le bouton retour utilise l'historique du
   navigateur (donc le bouton retour de la souris fonctionne aussi,
   nativement, sans rien coder).
══════════════════════════════════════ */
function bindGlobalNav() {
  const back = document.getElementById('global-back');
  if (back) back.addEventListener('click', () => history.back());
  const theme = document.getElementById('theme-toggle');
  if (theme) theme.addEventListener('click', toggleTheme);
}

/* ── Aide clavier (H / Esc), partagée sur toutes les pages ── */
function toggleKb() { if (state.kbOverlay) closeKb(); else openKb(); }

function openKb() {
  if (state.kbOverlay) return;
  state.kbOverlay = document.createElement('div');
  state.kbOverlay.className = 'kb-ov';
  state.kbOverlay.innerHTML = `<div class="kb-inner">
    <span class="kb-title">Aide</span>
    <div><span class="kb-key">1</span><span class="kb-key">2</span><span class="kb-key">3</span><span class="kb-key">4</span> — Répondre / évaluer</div>
    <div><span class="kb-key">F</span> — Afficher/masquer les furigana (QCM)</div>
    <div><span class="kb-key">Espace</span> — Révéler une flashcard</div>
    <div><span class="kb-key">H</span> — Aide &nbsp; <span class="kb-key">Esc</span> — Fermer</div>
    <div class="kb-close-hint">Cliquer n'importe où pour fermer</div>
  </div>`;
  state.kbOverlay.addEventListener('click', closeKb);
  document.body.appendChild(state.kbOverlay);
}

function closeKb() {
  if (state.kbOverlay) { state.kbOverlay.remove(); state.kbOverlay = null; }
}

document.addEventListener('keydown', e => {
  const activeTag = (document.activeElement && document.activeElement.tagName) || '';
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return; // jamais pendant une saisie

  if (e.key === 'h' || e.key === 'H') { toggleKb(); return; }
  if (e.key === 'Escape')              { closeKb();  return; }
});

/* ══════════════════════════════════════
   CHARGEMENT DES MOTS
   Les variables globales mots_1..4 sont déjà chargées par les
   balises <script> qui précèdent core.js dans chaque page.
══════════════════════════════════════ */
function loadDB() {
  state.db = {
    '1': typeof mots_1 !== 'undefined' ? mots_1 : [],
    '2': typeof mots_2 !== 'undefined' ? mots_2 : [],
    '3': typeof mots_3 !== 'undefined' ? mots_3 : [],
    '4': typeof mots_4 !== 'undefined' ? mots_4 : [],
  };
  return state.db['1'].length > 0;
}

/**
 * Initialisation commune à TOUTES les pages : à appeler en premier
 * dans le script spécifique de chaque page.
 * @returns {Promise<boolean>} true si les données ont bien chargé
 */
async function initCore() {
  loadStorage();
  initTheme();
  bindGlobalNav();
  const ok = loadDB();

  if (window.Cloud) {
    Cloud.init();
    try {
      const session = await Cloud.restoreSession();
      if (session) {
        state.cloudUsername = await Cloud.getUsername();
        await syncOnLogin();
      }
    } catch (e) {
      console.error('[Cloud] Restauration de session échouée', e);
    }
  }
  return ok;
}
