/* ═══════════════════════════════════════════════════════
   app.js — J-Core 2000 · Hiro Edition v6
   Architecture : état centralisé + chargement async JSON
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════
   CONSTANTES — 16 GRADES
══════════════════════════════════════ */
const RANKS = [
  { id:'mukyu',    label:'Mukyū',    jp:'無級', icon:'⬜', min:0 },
  { id:'r6kyu',   label:'Rokkyu',   jp:'六級', icon:'⬜', min:50 },
  { id:'r5kyu',   label:'Gokyu',    jp:'五級', icon:'🟦', min:150 },
  { id:'r4kyu',   label:'Yonkyu',   jp:'四級', icon:'🟦', min:300 },
  { id:'r3kyu',   label:'Sankyu',   jp:'三級', icon:'🟩', min:500 },
  { id:'r2kyu',   label:'Nikkyu',   jp:'二級', icon:'🟩', min:750 },
  { id:'r1kyu',   label:'Ikkyu',    jp:'一級', icon:'🟫', min:1100 },
  { id:'shodan',  label:'Shodan',   jp:'初段', icon:'⬛', min:1500 },
  { id:'nidan',   label:'Nidan',    jp:'二段', icon:'⬛', min:2100 },
  { id:'sandan',  label:'Sandan',   jp:'三段', icon:'🟪', min:2800 },
  { id:'yondan',  label:'Yondan',   jp:'四段', icon:'🟪', min:3700 },
  { id:'godan',   label:'Godan',    jp:'五段', icon:'🟥', min:4800 },
  { id:'rokudan', label:'Rokudan',  jp:'六段', icon:'🟥', min:6200 },
  { id:'nanadan', label:'Nanadan',  jp:'七段', icon:'🏅', min:8000 },
  { id:'hachidan',label:'Hachidan', jp:'八段', icon:'👑', min:10000 },
  { id:'hanshi',  label:'Hanshi',   jp:'範士', icon:'⚡', min:13000 },
];
const MAX_RANK = RANKS[RANKS.length - 1];

/** Points de rang accordés quand un mot devient "mature" (acquis) en Anki. */
const ANKI_MASTERY_POINTS = 10;

/** Boost XP permanent par rebirth (5% par rebirth, cumulatif). */
const EXP_BOOST_PER_REBIRTH = 0.05;

/* ── Quotas Anki (définis avec l'utilisateur) ──────────────────────
   Décomptés uniquement quand une carte est VRAIMENT notée (pas juste
   parce qu'elle était dans la file). Quota jour = global, partagé
   entre les 4 niveaux. */
const DAILY_NEW_WORD_QUOTA       = 10;  // nouveaux mots max par jour (global)
const SESSION_NEW_WORD_CAP       = 3;   // nouveaux mots max d'un coup dans UNE session
const BACKLOG_THROTTLE_THRESHOLD = 40;  // au-delà, on coupe les nouveaux mots (rattrapage prioritaire)

/**
 * Applique le boost XP des rebirths à un gain de points de base.
 * @param {number} base
 * @returns {number} points réellement accordés (arrondis)
 */
function applyBoost(base) {
  return Math.round(base * (1 + state.rebirths * EXP_BOOST_PER_REBIRTH));
}

/**
 * Retourne la classe CSS d'effet de pseudo selon le nombre de rebirths
 * (visible dans les classements : plus de rebirths = effet plus rare).
 * @param {number} rebirths
 * @returns {string}
 */
function rebirthTierClass(rebirths) {
  if (rebirths >= 10) return 'rt-mythic';
  if (rebirths >= 6)  return 'rt-legend';
  if (rebirths >= 3)  return 'rt-epic';
  if (rebirths >= 1)  return 'rt-rare';
  return '';
}

/** Retourne le rang correspondant à un total de points. */
const getRank = pts => {
  let r = RANKS[0];
  for (const x of RANKS) { if (pts >= x.min) r = x; else break; }
  return r;
};

/** Retourne le prochain rang (ou null si au maximum). */
const getNext = pts => {
  for (let i = 0; i < RANKS.length; i++) {
    if (RANKS[i].min > pts) return { r: RANKS[i], i };
  }
  return null;
};

/* ══════════════════════════════════════
   NAVIGATION — écran parent pour le bouton retour
══════════════════════════════════════ */
const SCREEN_PARENT = {
  config:      'menu',
  wordlist:    'config',
  flashcard:   'menu',
  flashdone:   'menu',
  game:        'config',
  gameover:    'menu',
  auth:        'menu',
  leaderboard: 'menu',
  stats:       'menu',
};
const NO_BACK_SCREENS = new Set(['menu', 'loading']);

/* ══════════════════════════════════════
   ÉTAT CENTRALISÉ DE L'APPLICATION
══════════════════════════════════════ */
const state = {
  /* Base de données des mots (chargée depuis /data/) */
  db: {},            // { "1": [...], "2": [...], "3": [...], "4": [...] }

  /* Navigation */
  currentScreen: 'loading',

  /* Session de jeu en cours */
  currentLevel:  null,
  wordList:      [],
  lives:         3,
  maxLives:      3,
  score:         0,
  combo:         0,
  bestCombo:     0,
  totalAns:      0,
  wrongAns:      0,
  gameStart:     0,
  curWord:       null,
  curOpts:       [],
  isJpFr:        true,
  furiVisible:   false,
  answered:      false,

  /* Configuration */
  diff:          'normal',
  timerOn:       true,
  questionTime:  15,
  timerInt:      null,
  timeLeft:      0,

  /* Persistance (localStorage) */
  hs:            {},   // high scores par niveau/diff
  permTotal:     0,    // total de points cumulés (base du rang, remis à 0 au rebirth)
  rebirths:      0,    // nombre de rebirths effectués
  lifetimeTotal: 0,    // total de points gagnés depuis toujours, JAMAIS remis à zéro (classement général)
  dayStreak:     0,    // jours consécutifs d'activité
  lastActiveDate: null, // 'YYYY-MM-DD' (heure locale) du dernier jour d'activité comptabilisé
  streakFreezeUsedDate: null, // dernière date où le streak freeze a été consommé

  /* Quota Anki — décompté uniquement quand une carte est VRAIMENT notée */
  newWordsToday: 0,    // nouveaux mots déjà notés aujourd'hui (quota global)
  newWordsDate:  null, // 'YYYY-MM-DD' de ce compteur (reset auto si jour différent)

  /* Snapshot pris au début d'une partie QCM, pour comparer le rang
     avant/après malgré le crédit de points en direct (boost rebirth) */
  gameStartPermTotal: 0,

  /* SRS — Spaced Repetition System (clé = cardId = "{wordId}_read"/"_prod") */
  srsData:       {},

  /* Divers */
  kbOverlay:     null,
  easterClicks:  0,
  easterActive:  false,

  /* Flash — session flashcard / mode mots difficiles */
  flashWordList:    [],
  flashQueue:       [],   // [{ word, dir, cardId }, ...]
  flashIndex:       0,
  flashCurrentItem: null, // { word, dir, cardId }
  flashIsFlipped:   false,
  flashIsJpFr:      true,
  flashStats:       {},
  lastFlashWordList: [],
  isLeechSession:   false,

  /* Compte / cloud */
  cloudUsername: null,
  authMode:      'login',

  /* Classement */
  lbPeriod: 'day',
};

/* Alias : srs.js utilise "store" — pointe sur state */
const store = state;

/* ══════════════════════════════════════
   PERSISTANCE — localStorage
══════════════════════════════════════ */

/** Charge toutes les données sauvegardées depuis le localStorage. */
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
}

/** Sauvegarde l'état persistant dans le localStorage. */
function save() {
  try { localStorage.setItem('jc_hs5',      JSON.stringify(state.hs)); }        catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_total5',   String(state.permTotal)); }         catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_rebirth5', String(state.rebirths)); }          catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_lifetime', String(state.lifetimeTotal)); }     catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_srs',      JSON.stringify(state.srsData)); }   catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_newcount', String(state.newWordsToday)); }     catch (e) { /* ignore */ }
  try { if (state.newWordsDate) localStorage.setItem('jc_newdate', state.newWordsDate); } catch (e) { /* ignore */ }
  try { if (state.streakFreezeUsedDate) localStorage.setItem('jc_freezeused', state.streakFreezeUsedDate); } catch (e) { /* ignore */ }
  try { localStorage.setItem('jc_streak',   String(state.dayStreak)); }         catch (e) { /* ignore */ }
  try { if (state.lastActiveDate) localStorage.setItem('jc_lastactive', state.lastActiveDate); } catch (e) { /* ignore */ }
}

/* ══════════════════════════════════════
   SRS — délégué à srs.js (chargé avant app.js)
   Fonctions disponibles : getSRSEntry, updateSRSFlashcard,
   updateSRSQuiz, buildFlashcardQueue, reinsertInSession,
   previewIntervalLabel, getDueWords, getSRSStats
══════════════════════════════════════ */

/* ══════════════════════════════════════
   SYNC CLOUD — délégué à cloud.js
   Fusionne la progression locale et distante au login, puis
   repousse régulièrement un snapshot complet (best-effort,
   pas de résolution de conflit temps réel — suffisant pour
   un usage "un appareil à la fois").
══════════════════════════════════════ */

/** Fusionne deux jeux de high scores en gardant le meilleur de chaque clé. */
function mergeHS(a, b) {
  const out = { ...a };
  for (const k in b) out[k] = Math.max(out[k] || 0, b[k] || 0);
  return out;
}

/** Fusionne deux jeux de données SRS — l'entrée la plus récemment vue gagne. */
function mergeSRS(a, b) {
  const out = { ...a };
  for (const id in b) {
    const cur = out[id];
    const inc = b[id];
    if (!cur || (inc.lastSeen || 0) > (cur.lastSeen || 0)) out[id] = inc;
  }
  return out;
}

/**
 * Fusionne le day streak local et distant : c'est la donnée associée à
 * la date d'activité la PLUS RÉCENTE qui gagne (pas un simple max, pour
 * éviter de "ressusciter" une série rompue à partir d'un vieux snapshot).
 * Le streak freeze utilisé suit le même côté gagnant.
 */
function mergeStreak(localStreak, localLastActive, localFreeze, cloudStreak, cloudLastActive, cloudFreeze) {
  if (!cloudLastActive) return { streak: localStreak, lastActive: localLastActive, freeze: localFreeze };
  if (!localLastActive)  return { streak: cloudStreak, lastActive: cloudLastActive, freeze: cloudFreeze };
  return cloudLastActive > localLastActive
    ? { streak: cloudStreak, lastActive: cloudLastActive, freeze: cloudFreeze }
    : { streak: localStreak, lastActive: localLastActive, freeze: localFreeze };
}

/** Au login : récupère le snapshot cloud, fusionne avec le local, repousse le résultat. */
async function syncOnLogin() {
  try {
    const cloudData = await Cloud.pullProgress();
    if (cloudData) {
      const cloudFurther = cloudData.rebirths > state.rebirths ||
        (cloudData.rebirths === state.rebirths && cloudData.perm_total > state.permTotal);
      if (cloudFurther) {
        state.rebirths  = cloudData.rebirths;
        state.permTotal = cloudData.perm_total;
      }
      state.lifetimeTotal = Math.max(state.lifetimeTotal, cloudData.lifetime_total || 0);
      state.hs      = mergeHS(state.hs, cloudData.hs || {});
      state.srsData = mergeSRS(state.srsData, cloudData.srs_data || {});

      const merged = mergeStreak(
        state.dayStreak, state.lastActiveDate, state.streakFreezeUsedDate,
        cloudData.day_streak || 0, cloudData.last_active || null, cloudData.last_freeze_used || null
      );
      state.dayStreak           = merged.streak;
      state.lastActiveDate      = merged.lastActive;
      state.streakFreezeUsedDate = merged.freeze;

      save();
      renderStreakChip();
    }
    await pushFullProgress();
  } catch (e) {
    console.error('[Sync] syncOnLogin a échoué', e);
  }
}

/** Repousse un snapshot complet de la progression vers le cloud (fire-and-forget conseillé). */
async function pushFullProgress() {
  if (!Cloud.isLoggedIn()) return;
  try {
    await Cloud.pushProgress({
      permTotal:     state.permTotal,
      rebirths:      state.rebirths,
      lifetimeTotal: state.lifetimeTotal,
      hs:            state.hs,
      srsData:       state.srsData,
      dayStreak:     state.dayStreak,
      lastActive:    state.lastActiveDate,
      lastFreezeUsed: state.streakFreezeUsedDate,
    });
  } catch (e) {
    console.error('[Sync] pushFullProgress a échoué', e);
  }
}

/* ══════════════════════════════════════
   NAVIGATION — SYSTÈME D'ÉCRANS
══════════════════════════════════════ */

/**
 * Affiche l'écran demandé et masque les autres.
 * @param {string} name - Valeur de l'attribut data-screen
 */
function goTo(name) {
  document.querySelectorAll('[data-screen]').forEach(el => {
    el.classList.toggle('active', el.dataset.screen === name);
  });
  state.currentScreen = name;
  const backBtn = document.getElementById('global-back');
  if (backBtn) backBtn.classList.toggle('hidden', NO_BACK_SCREENS.has(name));
}

/** Bouton retour global : remonte vers l'écran "parent" logique. */
function goBack() {
  clearInterval(state.timerInt);
  const parent = SCREEN_PARENT[state.currentScreen] || 'menu';
  if (parent === 'menu') renderMenu();
  goTo(parent);
}

/* ══════════════════════════════════════
   THÈME (clair / sombre)
══════════════════════════════════════ */

function initTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('jc_theme') || 'dark'; } catch (e) { /* ignore */ }
  document.documentElement.dataset.theme = saved;
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = saved === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
  const cur  = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('jc_theme', next); } catch (e) { /* ignore */ }
}

/* ══════════════════════════════════════
   UTILITAIRES
══════════════════════════════════════ */

/** Échappe les caractères HTML spéciaux. */
function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** Date locale au format 'YYYY-MM-DD' (évite les soucis de fuseau horaire de toISOString). */
function getLocalDateString(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Nombre de jours calendaires entre deux dates 'YYYY-MM-DD'. */
function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + 'T00:00:00');
  const b = new Date(dateStrB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/**
 * Enregistre l'activité du jour et met à jour le day streak.
 * Idempotent : ne fait rien si déjà appelé aujourd'hui.
 * Streak freeze : si exactement 1 jour a été manqué, et qu'aucun
 * freeze n'a été utilisé dans les 7 derniers jours, la série n'est
 * pas cassée (1 jour de grâce par semaine glissante).
 * Appelé au début d'une partie QCM ou d'une session flashcard.
 */
function recordActivity() {
  const today = getLocalDateString();
  if (state.lastActiveDate === today) return; // déjà comptabilisé aujourd'hui

  if (!state.lastActiveDate) {
    state.dayStreak = 1;
  } else {
    const gap = daysBetween(state.lastActiveDate, today);
    const freezeRecentlyUsed = state.streakFreezeUsedDate &&
      daysBetween(state.streakFreezeUsedDate, today) < 7;

    if (gap === 1) {
      state.dayStreak += 1;
    } else if (gap === 2 && !freezeRecentlyUsed) {
      // 1 jour manqué, freeze disponible : la série continue quand même.
      state.dayStreak += 1;
      state.streakFreezeUsedDate = today;
      toast('🧊 Streak freeze utilisé — série sauvée !');
    } else {
      state.dayStreak = 1; // série rompue (ou tout premier jour)
    }
  }
  state.lastActiveDate = today;
  save();

  const milestones = { 3:'🔥 3 jours de suite', 7:'🔥 1 semaine de suite !', 30:'🔥 1 mois de suite !!', 100:'🔥 100 jours, légendaire' };
  if (milestones[state.dayStreak]) toast(milestones[state.dayStreak]);

  renderStreakChip();
  pushFullProgress();
}

/** Met à jour l'affichage du streak chip dans le menu. */
function renderStreakChip() {
  const chip = document.getElementById('streak-chip');
  const text = document.getElementById('streak-text');
  if (!chip || !text) return;
  text.textContent = `${state.dayStreak} jour${state.dayStreak === 1 ? '' : 's'} de suite`;
  chip.classList.toggle('on', state.dayStreak > 0);
}

/* ── Quota Anki (nouveaux mots/jour) ────────────────────────────── */

/** Nombre de nouveaux mots encore autorisés aujourd'hui (quota global). */
function getDailyRemaining() {
  const today = getLocalDateString();
  if (state.newWordsDate !== today) return DAILY_NEW_WORD_QUOTA; // jour différent → quota frais
  return Math.max(0, DAILY_NEW_WORD_QUOTA - state.newWordsToday);
}

/** Incrémente le compteur de nouveaux mots du jour (reset auto si jour différent). */
function incrementDailyNewCount() {
  const today = getLocalDateString();
  if (state.newWordsDate !== today) { state.newWordsDate = today; state.newWordsToday = 0; }
  state.newWordsToday++;
  save();
}

/* ══════════════════════════════════════
   CHARGEMENT DES DONNÉES (async/await)
   Fichiers JS dans /data/mots_1.json … mots_4.json
══════════════════════════════════════ */

/**
 * Charge les variables globales (mots_1, mots_2...), peuple state.db,
 * puis redirige vers le menu.
 */
async function loadDB() {
  goTo('loading');
  try {
    // On lit directement les variables chargées depuis les balises <script>
    state.db = {
      '1': typeof mots_1 !== 'undefined' ? mots_1 : [],
      '2': typeof mots_2 !== 'undefined' ? mots_2 : [],
      '3': typeof mots_3 !== 'undefined' ? mots_3 : [],
      '4': typeof mots_4 !== 'undefined' ? mots_4 : [],
    };

    if (state.db['1'].length === 0) {
      throw new Error("Données introuvables. As-tu bien placé les fichiers dans /data ?");
    }

    renderMenu();
    renderAccountCard();
    goTo('menu');
  } catch (e) {
    console.error("Erreur détaillée du chargement des données :", e);
    const loadingScreen = document.querySelector('[data-screen="loading"]');
    loadingScreen.innerHTML =
      `<div class="ld-err" style="text-align:left; background:var(--red-t); padding:16px; border-radius:12px; margin:16px;">
        <strong>❌ Impossible de charger les données</strong><br><br>
        <span style="color:var(--red); font-weight:bold;">${escHtml(e.message)}</span><br><br>
        <em>Pistes à vérifier :</em>
        <ul style="margin-left:16px; margin-top:8px; color:var(--text1);">
          <li><strong>En local :</strong> Utilises-tu bien un serveur local (Live Server) ? Le double-clic bloque le chargement.</li>
          <li><strong>Sur GitHub :</strong> Le dossier s'appelle-t-il bien "data" en minuscules ?</li>
          <li><strong>Sur GitHub :</strong> Les fichiers JSON ont-ils bien la bonne extension (pas de .json.txt caché) ?</li>
        </ul>
      </div>`;
  }
}

/* ══════════════════════════════════════
   MENU
══════════════════════════════════════ */

/** Met à jour l'affichage complet du menu (rang, stats Anki, high scores, grille). */
function renderMenu() {
  // Carte de rang
  const rank = getRank(state.permTotal);
  const nr   = getNext(state.permTotal);
  document.getElementById('mrc-name').textContent  = `${rank.label} ${rank.jp}`;
  document.getElementById('mrc-pts').textContent   = `${state.permTotal} pts`;
  document.getElementById('mrc-badge').textContent = rank.icon;

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

  // Bandeau Rebirth (visible uniquement au rang max)
  const rb = document.getElementById('rebirth-banner');
  if (rank.id === MAX_RANK.id) {
    rb.classList.remove('hidden');
    const boostPct = Math.round(state.rebirths * EXP_BOOST_PER_REBIRTH * 100);
    document.getElementById('rebirth-sub').textContent = `Rebirth ×${state.rebirths} · Boost XP +${boostPct}%`;
  } else {
    rb.classList.add('hidden');
  }

  renderStreakChip();

  // Stats Anki globales (tous niveaux confondus)
  const allWords = Object.values(state.db).flat();
  const stats = getSRSStats(allWords); // srs.js
  document.getElementById('anki-new-count').textContent    = stats.newCount;
  document.getElementById('anki-due-count').textContent    = stats.due;
  document.getElementById('anki-mature-count').textContent = stats.mature;
  document.getElementById('leech-count').textContent       = `(${stats.leech})`;

  // High scores par niveau
  ['1','2','3','4'].forEach(l => {
    let best = 0;
    ['normal','hard','blitz'].forEach(d => { best = Math.max(best, state.hs[`${l}_${d}`] || 0); });
    const el = document.getElementById(`hs-${l}`);
    if (el) el.textContent = best > 0 ? `HS ${best}` : '';
  });

  // Grille des 16 grades
  const grid = document.getElementById('ranks-grid');
  grid.innerHTML = '';
  RANKS.forEach(r => {
    const d = document.createElement('div');
    d.className = `rk-chip${r.id === rank.id ? ' cur' : ''}`;
    d.innerHTML = `<span class="rk-icon">${r.icon}</span><span class="rk-lbl">${r.label}</span><span class="rk-pts">${r.min}pts</span>`;
    grid.appendChild(d);
  });
}

/** Affiche l'état connecté/invité dans la carte compte du menu. */
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
}

/** Ouvre l'écran stats et le peuple. */
function openStatsScreen() {
  renderStats();
  goTo('stats');
}

/** Calcule et affiche la répartition + la prévision sur 7 jours. */
function renderStats() {
  const allWords = Object.values(state.db).flat();
  const s = getSRSStats(allWords); // srs.js
  const total = Math.max(1, s.newCount + s.learning + s.mature + s.leech);

  const bar = document.getElementById('stat-bar');
  bar.innerHTML =
    `<span class="sb-new" style="width:${s.newCount / total * 100}%"></span>` +
    `<span class="sb-learn" style="width:${s.learning / total * 100}%"></span>` +
    `<span class="sb-mature" style="width:${s.mature / total * 100}%"></span>` +
    `<span class="sb-leech" style="width:${s.leech / total * 100}%"></span>`;

  document.getElementById('sl-new').textContent    = s.newCount;
  document.getElementById('sl-learn').textContent  = s.learning;
  document.getElementById('sl-mature').textContent = s.mature;
  document.getElementById('sl-leech').textContent  = s.leech;

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
}

/* ══════════════════════════════════════
   REBIRTH
══════════════════════════════════════ */
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

/* ══════════════════════════════════════
   SÉLECTION NIVEAU / DIFFICULTÉ / TIMER
══════════════════════════════════════ */

/**
 * Sélectionne un niveau et navigue vers l'écran de configuration.
 * @param {string} l - '1', '2', '3', '4' ou 'ALL'
 */
function selectLevel(l) {
  state.currentLevel = l;
  state.wordList = l === 'ALL'
    ? Object.values(state.db).flat()
    : state.db[l] || [];

  if (state.wordList.length < 4) {
    toast('Données manquantes pour ce niveau.');
    return;
  }
  document.getElementById('cfg-title').textContent = l === 'ALL' ? 'Tous les niveaux' : `Niveau 0${l}`;
  document.getElementById('cfg-sub').textContent    = `${state.wordList.length} mots disponibles`;

  document.querySelectorAll('.diff-btn[data-diff]').forEach(b => b.classList.toggle('active', b.dataset.diff === state.diff));
  updateTimerHint();
  goTo('config');
}

/**
 * Change la difficulté et met à jour l'affichage.
 * @param {string} d   - 'normal', 'hard' ou 'blitz'
 * @param {Element} el - Le bouton cliqué
 */
function setDiff(d, el) {
  state.diff         = d;
  state.questionTime = d === 'normal' ? 15 : d === 'hard' ? 10 : 6;
  document.querySelectorAll('.diff-btn[data-diff]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  updateTimerHint();
}

/** Bascule l'activation du timer. */
function toggleTimer() {
  state.timerOn = !state.timerOn;
  document.getElementById('timer-toggle').classList.toggle('active', state.timerOn);
  updateTimerHint();
}

/** Retourne le nombre de vies selon la difficulté (et l'easter egg). */
function getMaxLives() {
  if (state.easterActive) return 99;
  return state.diff === 'normal' ? 3 : state.diff === 'hard' ? 2 : 1;
}

/** Met à jour le texte d'indication du timer. */
function updateTimerHint() {
  document.getElementById('timer-hint').textContent = state.timerOn
    ? `Activé — ${state.questionTime}s par question`
    : 'Désactivé — prends ton temps';
}

/* ══════════════════════════════════════
   LISTE DES MOTS (révision / recherche)
══════════════════════════════════════ */

/** Ouvre l'écran de liste avec les mots du niveau sélectionné. */
function showWordList() {
  document.getElementById('list-search').value = '';
  renderWordList([...state.wordList]);
  goTo('wordlist');
}

/**
 * Affiche une liste de mots.
 * @param {Array} list - Tableau de mots à afficher
 */
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

/**
 * Filtre la liste selon la saisie.
 * @param {string} q - Terme de recherche (kanji, kana ou français)
 */
function filterWordList(q) {
  q = q.toLowerCase().trim();
  renderWordList([...state.wordList].filter(w =>
    w.kanji.includes(q) || w.kana.includes(q) || w.fr.toLowerCase().includes(q)
  ));
}

/* ══════════════════════════════════════
   MOTEUR DE JEU (QCM)
══════════════════════════════════════ */

/** Initialise et démarre une nouvelle partie. */
function startGame() {
  state.maxLives  = getMaxLives();
  state.lives     = state.maxLives;
  state.score     = 0;
  state.combo     = 0;
  state.bestCombo = 0;
  state.totalAns  = 0;
  state.wrongAns  = 0;
  state.gameStart = Date.now();
  state.answered  = false;
  state.gameStartPermTotal = state.permTotal; // pour comparer le rang en fin de partie

  recordActivity(); // day streak

  document.getElementById('hud-diff').textContent =
    state.diff.charAt(0).toUpperCase() + state.diff.slice(1) + (state.timerOn ? '' : ' ∞');

  goTo('game');
  buildStreak();
  renderLives();
  updateScore();
  nextQ();
}

/* ── Vies ── */

/** Reconstruit l'affichage des cœurs. */
function renderLives() {
  const row = document.getElementById('hud-lives');
  row.innerHTML = '';
  if (state.maxLives > 8) {
    // Mode easter egg : affichage compact
    row.innerHTML = `<span style="font-family:'Space Mono',monospace;font-size:.9rem;">❤ ×${state.lives}</span>`;
    return;
  }
  for (let i = 0; i < state.maxLives; i++) {
    const s = document.createElement('span');
    s.className = `heart${i >= state.lives ? ' dead' : ''}`;
    s.textContent = '❤';
    row.appendChild(s);
  }
}

/** Anime la perte d'un cœur. */
function loseLive() {
  const alive = document.querySelectorAll('.heart:not(.dead)');
  if (alive.length) {
    const last = alive[alive.length - 1];
    last.classList.add('lose-anim');
    setTimeout(() => last.classList.add('dead'), 220);
  }
}

/* ── Streak (barre de combo) ── */

/** Construit les 5 points de la barre de streak. */
function buildStreak() {
  const row = document.getElementById('streak-row');
  row.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div');
    d.className = 'sdot';
    row.appendChild(d);
  }
}

/** Met à jour l'état visuel de la barre de streak. */
function updateStreak() {
  const dots = document.querySelectorAll('.sdot');
  const pos  = state.combo % 5;
  const full = state.combo > 0 && pos === 0;
  dots.forEach((d, i) => {
    d.classList.remove('lit', 'max');
    if (full) d.classList.add('max');
    else if (i < pos) d.classList.add('lit');
  });
}

/** Met à jour l'affichage du score (avec animation). */
function updateScore() {
  const el = document.getElementById('score-num');
  el.textContent = state.score;
  el.classList.remove('bump');
  void el.offsetWidth; // force reflow pour relancer l'animation CSS
  el.classList.add('bump');
}

/** Met à jour l'affichage du combo. */
function updateCombo() {
  const cb = document.getElementById('combo-disp');
  if (state.combo >= 3) {
    cb.textContent = `×${state.combo} combo${state.combo >= 10 ? ' 💀' : ''}`;
    cb.classList.add('on');
  } else {
    cb.classList.remove('on');
  }
}

/* ── Timer ── */

/** Lance le timer de la question en cours. */
function startTimer() {
  clearInterval(state.timerInt);
  const wrap = document.getElementById('timer-wrap');
  const bar  = document.getElementById('timer-bar');

  if (!state.timerOn) { wrap.style.opacity = '0'; return; }
  wrap.style.opacity = '1';
  state.timeLeft = state.questionTime;
  bar.style.width      = '100%';
  bar.style.background = 'var(--acc)';

  state.timerInt = setInterval(() => {
    state.timeLeft = Math.max(0, state.timeLeft - 0.1);
    const pct = (state.timeLeft / state.questionTime) * 100;
    bar.style.width      = pct + '%';
    bar.style.background = pct > 60 ? 'var(--acc)' : pct > 30 ? 'var(--amber)' : 'var(--red)';
    if (state.timeLeft <= 0) { clearInterval(state.timerInt); onTimeout(); }
  }, 100);
}

/** Gère l'expiration du timer. */
function onTimeout() {
  if (state.answered) return;
  state.answered = true;
  state.combo    = 0;
  state.wrongAns++;
  state.totalAns++;
  state.lives--;

  // Mise à jour SRS : échec par timeout (sur le sens effectivement testé)
  if (state.curWord && state.curWord.id) updateSRSQuiz(curCardId(), false);

  flash('rgba(255,75,75,.1)');
  loseLive(); updateCombo(); updateStreak();
  toast('⏱ Temps écoulé');
  revealCorrect();
  if (state.lives <= 0) setTimeout(endGame, 1600); else setTimeout(nextQ, 1300);
}

/** Révèle la bonne réponse en grisant les autres. */
function revealCorrect() {
  Array.from(document.getElementById('opts-grid').children).forEach(b => {
    b.disabled = true;
    if (b.dataset.ok === 'true') b.classList.add('reveal');
  });
}

/* ── Question ── */

/* ── Distracteurs intelligents (similarité phonétique/visuelle) ──── */

/** Distance de Levenshtein entre deux chaînes (similarité phonétique sur les kana). */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) { dp.push(new Array(n + 1).fill(0)); dp[i][0] = i; }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Choisit des distracteurs PROCHES du mot cible (kana similaires ou
 * premier kanji partagé) plutôt que purement aléatoires — pour
 * s'entraîner sur les vraies confusions du japonais.
 * @param {Object} target - le mot à deviner
 * @param {Array} pool    - le pool de mots disponibles (le niveau en cours)
 * @param {number} count  - nombre de distracteurs voulus
 * @returns {Array}
 */
function pickSmartDistractors(target, pool, count) {
  const candidates = pool.filter(w => w.kanji !== target.kanji);
  const scored = candidates.map(w => ({
    w,
    score: levenshtein(target.kana, w.kana) - (w.kanji[0] === target.kanji[0] ? 1.5 : 0),
  })).sort((a, b) => a.score - b.score);

  const picked = [];
  const used = new Set();
  for (const s of scored) {
    if (picked.length >= count) break;
    if (used.has(s.w.kanji)) continue;
    // Un peu de hasard parmi les plus proches pour ne pas être 100% déterministe.
    if (Math.random() < 0.7 || picked.length === count - 1) {
      picked.push(s.w);
      used.add(s.w.kanji);
    }
  }
  // Complète avec du random si pas assez de candidats proches trouvés.
  while (picked.length < count && candidates.length > 0) {
    const rw = candidates[Math.floor(Math.random() * candidates.length)];
    if (!used.has(rw.kanji)) { picked.push(rw); used.add(rw.kanji); }
  }
  return picked;
}

/** Construit le cardId (sens inclus) du mot actuellement testé en QCM. */
function curCardId() {
  return cardId(state.curWord.id, state.isJpFr ? 'read' : 'prod'); // srs.js
}

/** Prépare et affiche la prochaine question. */
function nextQ() {
  clearInterval(state.timerInt);
  state.answered    = false;
  state.furiVisible = false;

  state.curWord = state.wordList[Math.floor(Math.random() * state.wordList.length)];
  const dist    = pickSmartDistractors(state.curWord, state.wordList, 3);

  state.curOpts = [state.curWord, ...dist].sort(() => Math.random() - 0.5);
  state.isJpFr  = Math.random() > 0.45; // 55 % JP→FR, 45 % FR→JP

  renderQ();
  startTimer();
}

/** Construit l'affichage de la question et des options. */
function renderQ() {
  const grid = document.getElementById('opts-grid');
  grid.innerHTML = '';
  const qw   = document.getElementById('q-word');
  const card = document.getElementById('q-card');
  card.classList.remove('ok', 'err');

  if (state.isJpFr) {
    // JP → FR : affiche le kanji, réponses en français
    document.getElementById('q-dir').textContent = 'JP → FR';
    qw.className = 'q-word';
    qw.innerHTML = state.furiVisible
      ? `<ruby>${state.curWord.kanji}<rt>${state.curWord.kana}</rt></ruby>`
      : state.curWord.kanji;

    state.curOpts.forEach((o, i) => {
      const b = makeBtn(o.fr, false, o.kanji === state.curWord.kanji, i + 1);
      b.classList.add('fr-opt');
      grid.appendChild(b);
    });
  } else {
    // FR → JP : affiche la traduction française, réponses en japonais
    document.getElementById('q-dir').textContent = 'FR → JP';
    qw.className = 'q-word latin';
    qw.textContent = state.curWord.fr;

    state.curOpts.forEach((o, i) => {
      const content = state.furiVisible
        ? `<ruby>${o.kanji}<rt>${o.kana}</rt></ruby>`
        : o.kanji;
      grid.appendChild(makeBtn(content, true, o.kanji === state.curWord.kanji, i + 1));
    });
  }

  updateFuriBtn();
}

/** Met à jour l'état visuel du bouton furigana. */
function updateFuriBtn() {
  const btn = document.getElementById('furi-btn');
  const lbl = document.getElementById('furi-lbl');
  btn.classList.toggle('on', state.furiVisible);
  lbl.textContent = state.furiVisible ? 'Masquer' : 'Furigana';
}

/** Bascule l'affichage des furigana et re-rend la question. */
function toggleFuri() {
  state.furiVisible = !state.furiVisible;
  const qw = document.getElementById('q-word');

  if (state.isJpFr) {
    qw.innerHTML = state.furiVisible
      ? `<ruby>${state.curWord.kanji}<rt>${state.curWord.kana}</rt></ruby>`
      : state.curWord.kanji;
  } else {
    // En mode FR→JP, on re-rend les options
    Array.from(document.getElementById('opts-grid').children).forEach((b, i) => {
      const o = state.curOpts[i];
      if (!o) return;
      const kh = b.querySelector('.kh');
      const khText = kh ? kh.textContent : '';
      b.innerHTML = `<span class="kh">${khText}</span>`;
      b.innerHTML += state.furiVisible
        ? `<ruby>${o.kanji}<rt>${o.kana}</rt></ruby>`
        : o.kanji;
    });
  }
  updateFuriBtn();
}

/**
 * Crée un bouton d'option de réponse.
 * @param {string}  content   - Contenu textuel ou HTML du bouton
 * @param {boolean} isHtml    - Vrai si content doit être injecté en innerHTML
 * @param {boolean} isCorrect - Vrai si c'est la bonne réponse
 * @param {number}  num       - Numéro de raccourci clavier (1–4)
 * @returns {HTMLButtonElement}
 */
function makeBtn(content, isHtml, isCorrect, num) {
  const b = document.createElement('button');
  b.className  = 'opt-btn';
  b.innerHTML  = `<span class="kh">${num}</span>`;
  if (isHtml) b.innerHTML += content;
  else b.appendChild(document.createTextNode(content));
  b.dataset.ok = String(isCorrect);
  b.addEventListener('click', () => checkAnswer(b, isCorrect));
  return b;
}

/* ── Réponse ── */

/**
 * Traite la réponse de l'utilisateur.
 * @param {HTMLButtonElement} btn       - Le bouton cliqué
 * @param {boolean}           isCorrect - Vrai si la réponse est correcte
 */
function checkAnswer(btn, isCorrect) {
  if (state.answered) return;
  state.answered = true;
  clearInterval(state.timerInt);
  state.totalAns++;

  // Mise à jour SRS (sur le sens effectivement testé)
  let justMastered = false;
  if (state.curWord && state.curWord.id) {
    const r = updateSRSQuiz(curCardId(), isCorrect);
    justMastered = r.justMastered;
  }

  if (isCorrect) {
    btn.classList.add('correct');
    document.getElementById('q-card').classList.add('ok');
    flash('rgba(88,204,2,.08)');
    state.score++;
    state.combo++;
    if (state.combo > state.bestCombo) state.bestCombo = state.combo;

    // Bonus rapidité : +2 (brut) si réponse en premier quart du temps
    let baseGained = 1;
    if (state.timerOn && state.timeLeft > state.questionTime * 0.75) {
      state.score++;
      baseGained = 2;
      spawnPop('+2 ⚡', btn);
    } else {
      spawnPop('+1', btn);
    }

    // Crédit immédiat du rang + classement (avec boost XP des rebirths)
    const gained = applyBoost(baseGained);
    state.permTotal     += gained;
    state.lifetimeTotal += gained;
    save();
    Cloud.logPoints(gained).catch(() => { /* best-effort */ });

    if (justMastered) awardMasteryBonus();

    updateScore(); updateCombo(); updateStreak();

    // Toasts de milestones
    const mt = { 10:'10 mots !', 25:'En feu 🔥', 50:'Mi-chemin ⚡', 69:'nice.', 100:'Centurion 💀', 150:'Légendaire', 200:'Rang S 🔥' };
    if (mt[state.score]) toast(mt[state.score]);
    const ct = { 5:'×5 🔥 Combo', 10:'×10 🔥 Unstoppable', 20:'×20 💀 Indécent', 30:'×30 ⚡ T\'es pas réel' };
    if (ct[state.combo]) toast(ct[state.combo]);

    // Désactive toutes les options et passe à la suivante
    Array.from(document.getElementById('opts-grid').children).forEach(b => b.disabled = true);
    setTimeout(nextQ, 280);
  } else {
    btn.classList.add('wrong');
    btn.disabled = true;
    flash('rgba(255,75,75,.08)');
    state.combo = 0;
    state.wrongAns++;
    state.lives--;
    loseLive(); updateCombo(); updateStreak();

    if (state.lives <= 0) {
      revealCorrect();
      setTimeout(endGame, 1800);
    } else {
      // L'utilisateur peut réessayer (sans réinitialiser answered)
      state.answered = false;
    }
  }
}

/**
 * Fait apparaître une pop animation de score au-dessus du bouton.
 * @param {string}          txt - Texte à afficher (ex. "+1", "+2 ⚡")
 * @param {HTMLButtonElement} btn - Bouton de référence pour le positionnement
 */
function spawnPop(txt, btn) {
  const pop = document.createElement('div');
  pop.className  = 'score-pop';
  pop.textContent = txt;
  const r  = btn.getBoundingClientRect();
  const ar = document.getElementById('app').getBoundingClientRect();
  pop.style.left = `${r.left - ar.left + r.width / 2 - 12}px`;
  pop.style.top  = `${r.top  - ar.top  - 6}px`;
  document.getElementById('app').appendChild(pop);
  setTimeout(() => pop.remove(), 750);
}

/* ══════════════════════════════════════
   FIN DE PARTIE — rang basé sur permTotal
══════════════════════════════════════ */

/** Calcule les résultats, met à jour le rang et affiche l'écran game over. */
function endGame() {
  clearInterval(state.timerInt);

  const elapsed   = Math.round((Date.now() - state.gameStart) / 1000);
  const acc       = state.totalAns > 0 ? Math.round((state.score / state.totalAns) * 100) : 0;
  // Le rang de départ a été figé dans startGame() : les points de cette
  // partie ont déjà été crédités en direct (avec boost) dans checkAnswer().
  const prevRank  = getRank(state.gameStartPermTotal);
  save();

  const newRank  = getRank(state.permTotal);
  const isRankUp = newRank.id !== prevRank.id;

  // Titre de résultat
  const title = document.getElementById('go-title');
  if (state.score >= 100) {
    title.className  = 'go-title good';
    title.textContent = 'Maître';
    document.getElementById('go-eyebrow').textContent = 'LÉGENDAIRE';
  } else if (state.score >= 50) {
    title.className  = 'go-title good';
    title.textContent = 'Solide';
    document.getElementById('go-eyebrow').textContent = 'BON RUN';
  } else {
    title.className  = 'go-title fail';
    title.textContent = 'Échec';
    document.getElementById('go-eyebrow').textContent = 'RÉSULTAT';
  }

  // Stats
  document.getElementById('st-score').textContent = state.score;
  document.getElementById('st-combo').textContent = state.bestCombo;
  document.getElementById('st-acc').textContent   = acc + '%';
  document.getElementById('st-time').textContent  = elapsed + 's';

  // Carte de rang
  document.getElementById('grc-icon').textContent = newRank.icon;
  document.getElementById('grc-name').textContent = `${newRank.label} ${newRank.jp}`;
  document.getElementById('grc-pts').textContent  = `${state.permTotal} pts au total`;

  const card = document.getElementById('go-rank-card');
  card.className = 'go-rank-card' +
    (newRank.id === MAX_RANK.id ? ' legend' : isRankUp ? ' rankup' : '');
  document.getElementById('grc-new').classList.toggle('hidden', !isRankUp);

  // Comparaison avant/après rang
  const cmp = document.getElementById('rank-cmp');
  if (isRankUp) {
    cmp.classList.remove('hidden');
    document.getElementById('rc-from').textContent = `${prevRank.label} ${prevRank.jp}`;
    document.getElementById('rc-to').textContent   = `${newRank.label} ${newRank.jp}`;
  } else {
    cmp.classList.add('hidden');
  }

  // Barre de progression vers le prochain rang
  const nr = getNext(state.permTotal);
  const nbWrap = document.getElementById('nb-wrap');
  if (nr) {
    nbWrap.classList.remove('hidden');
    const prev  = RANKS[nr.i - 1];
    const range = nr.r.min - prev.min;
    const pct   = range > 0
      ? Math.min(100, Math.round(((state.permTotal - prev.min) / range) * 100))
      : 100;
    document.getElementById('nb-left').textContent  = newRank.label;
    document.getElementById('nb-right').textContent = `${nr.r.label} (${nr.r.min} pts)`;
    const fill = document.getElementById('nb-fill');
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = pct + '%'; }, 80);
  } else {
    nbWrap.classList.add('hidden');
  }

  // Record par niveau/difficulté
  const key = `${state.currentLevel}_${state.diff}`;
  if (state.score > (state.hs[key] || 0)) {
    state.hs[key] = state.score;
    save();
    document.getElementById('rec-banner').classList.remove('hidden');
  } else {
    document.getElementById('rec-banner').classList.add('hidden');
  }

  document.getElementById('go-quote').textContent = pickQuote(state.score, acc, elapsed, state.bestCombo);
  renderMenu();
  goTo('gameover');
  pushFullProgress();
}

/* ══════════════════════════════════════
   CITATIONS (fin de partie)
══════════════════════════════════════ */

/**
 * Sélectionne une citation adaptée au résultat.
 * @param {number} s   - Score final
 * @param {number} acc - Précision en %
 * @param {number} elapsed - Durée en secondes
 * @param {number} cmb - Meilleur combo
 * @returns {string}
 */
function pickQuote(s, acc, elapsed, cmb) {
  let pool = [];

  if (s <= 5) pool = [
    "Ton Ryzen 9800X3D tourne à plein régime pour afficher un score de merde.",
    "Yuka a vomi en voyant ton résultat. Elle a bloqué le numéro.",
    "Même un bot Valorant Silver a plus de vocabulaire que toi.",
    "Tu vas te faire racketter par des collégiens à Sannomiya.",
    "Retourne sur Minecraft, t'es clairement pas prêt pour la vraie vie.",
    "T'es une erreur de compilation vivante et non récupérable.",
    "Ce score c'est un bug. Non attends c'est juste toi. Le bug c'est toi.",
    "Même un pigeon de Shibuya comprend mieux le japonais que toi.",
    "T'aurais eu un meilleur score en fermant les yeux et en cliquant au hasard.",
    "Ta future vie au Japon : nettoyer les toilettes des konbini de nuit.",
    "Avec ce niveau tu comprendras même pas l'emballage du riz.",
    "C'est pathétique. Désinstalle l'appli et réfléchis à tes choix de vie.",
    "Oublie le Japon, t'as même pas le niveau pour Duolingo niveau débutant.",
    "La Z33 que t'as jamais achetée te regarde avec honte.",
    "Ton 9800X3D méritait un meilleur propriétaire.",
    "T'as cliqué au pif sur toutes les réponses et t'as quand même foiré. Respect.",
    "Si c'était Wordle t'aurais trouvé le mot en 47 essais.",
    "L'IA qui génère ces vannes est sincèrement gênée pour toi.",
  ];
  else if (s <= 15) pool = [
    "T'es bloqué au tuto de ta propre vie depuis des mois.",
    "Tu vas finir SDF à Shibuya avec ce vocabulaire de touriste.",
    "Tu parles tellement mal que même les touristes français vont te corriger.",
    "Un gamin japonais de 6 ans t'éclate en dormant les deux mains attachées.",
    "T'as juste prouvé que tu sais cliquer. Parfois même au bon endroit.",
    "T'es le Iron 1 de l'apprentissage des langues mondiales.",
    "Même sans timer t'as quand même foiré. La constance dans la médiocrité.",
    "Yuka a vu le score et a mis le téléphone en mode avion.",
    "Tu maîtrises peut-être les kanas. Peut-être. On en est pas sûrs.",
    "C'est le niveau d'un touriste qui a regardé 10 minutes d'anime en 2015.",
    "La Z33 t'attend au garage, mais t'as même pas le niveau pour lire le manuel.",
  ];
  else if (s <= 30) pool = [
    "Score de quelqu'un qui va abandonner son projet Japon au premier obstacle.",
    "Tu vas te contenter de ramen éco et de convenience store toute ta vie.",
    "Tu sais dire bonjour et merci. Félicitations pour ton niveau CE1.",
    "Tu survis, mais tu fais sincèrement pitié à tout le monde.",
    "T'es l'équivalent d'une connexion Wi-Fi à -3 barres dans le métro japonais.",
    "Tu vas pouvoir commander de l'eau au restaurant. Grosse évolution sur l'année.",
    "C'est le niveau N5 de la survie en milieu hostile.",
    "Yuka sourit poliment parce qu'elle a pitié de ton accent catastrophique.",
    "Retourne poncer ta liste au lieu de faire semblant d'être prêt.",
    "Un score de milieu de tableau dans un classement fondamentalement honteux.",
    "La Z33 pleure dans le garage.",
  ];
  else if (s <= 50) pool = [
    "Ça commence à ressembler à un cerveau fonctionnel. Enfin.",
    "T'as enfin le niveau pour regarder un anime sans bégayer devant les sous-titres.",
    "Le projet Japon devient sérieux. Très lentement, mais sérieux.",
    "Plus besoin de Google Traduction pour survivre dans un konbini.",
    "Solide. Maintenant double ce score ou c'était du hasard.",
    "Les kanjis commencent à rentrer. Continue avant qu'ils ressortent.",
    "T'es plus un simple touriste. T'es un touriste avancé.",
    "La Z33 commence à ronronner.",
  ];
  else if (s <= 120) pool = [
    "Sérieusement chaud. On commence vraiment à parler d'un niveau correct.",
    "T'es passé Sankyu et tu le réalises même pas encore.",
    "Tokyo commence à te sembler moins terrifiant. C'est un début.",
    "Yuka hésite à répondre au message. Elle réfléchit.",
    "T'as de la mémoire musculaire sur les kanjis. C'est du vrai travail.",
    "T'es plus un touriste, t'es un résident en devenir. Presque.",
    "100 mots, du vrai niveau. Maintenant fais-le en Blitz.",
    "La database commence à transpirer légèrement.",
    "La Z33 donne tout sur la ligne droite.",
  ];
  else pool = [
    "Masterclass absolue. T'es prêt pour le vol direction Tokyo.",
    "Le roi de Fujisawa est dans la place, chapeau.",
    "Ton cerveau turbine plus vite que ton 9800X3D en mode turbo.",
    "Yuka prépare le repas, t'as plié la partie et le futur.",
    "Score de pur crack du vocabulaire japonais.",
    "Tu peux direct écrire des light novels sans traducteur.",
    "C'est complètement indécent comme score, continue.",
    "Tu lis les kanjis plus vite que ton écran 240Hz peut les afficher.",
    "Pure domination linguistique et intellectuelle.",
    "T'as hacké la database du Core 2000, félicitations.",
    "Le niveau est irréprochable. Légendaire. Incontestable.",
    "La Z33 fait des wheelspin sur tout le premier tour.",
  ];

  // Citations contextuelles bonus
  if (cmb >= 10 && s <= 20) pool.push(`Ton ×${cmb} combo c'était de la chance pure. Regarde le score final, ça dit tout.`);
  if (acc < 40 && state.totalAns > 10) pool.push("Moins de 40% de précision. T'as littéralement cliqué en dormant les yeux fermés.");
  if (elapsed < 15 && s <= 5) pool.push("Moins de 15 secondes de survie. Speedrun de la nullité totale. Un record de médiocrité.");
  if (state.diff === 'blitz' && s <= 5)  pool.push("Mode Blitz avec ce score. Les mobs de Lies of P réagissent plus vite que toi.");
  if (state.diff === 'blitz' && s > 30)  pool.push("Mode Blitz, 30+ mots. Respect total, c'est du niveau.");
  if (!state.timerOn && s <= 10)         pool.push("T'as joué sans timer et t'as quand même foiré. Il n'y a aucune excuse valable.");
  if (state.diff === 'hard'  && s > 40)  pool.push("Hard mode, 40+ mots. Légitimement impressionnant, t'as du niveau.");
  if (s > 0 && acc === 100)              pool.push("100% de précision. Soit t'es une machine, soit t'as triché. Probablement les deux.");

  return pool[Math.floor(Math.random() * pool.length)];
}

/* ══════════════════════════════════════════════════════════════════════
   MODE FLASHCARD (Anki) & MODE MOTS DIFFICILES (leechs)
   buildFlashcardQueue (srs.js) gère le pool actif = contenu réel de la
   session (mots vus, dus ou pas, triés du plus faible au plus mûr) +
   nouveaux mots bornés par un quota JOUR (10, global) ET un quota
   SESSION (3 max d'un coup) — décomptés seulement quand une carte est
   vraiment notée. "Black-out" boucle serrée immédiate. Chaque carte
   apparaît ≥2 fois par session (3 si niveau ≤1). Lecture et production
   sont suivies séparément (deux "cartes" par mot).
══════════════════════════════════════════════════════════════════════ */

/**
 * Démarre une session flashcard normale sur un pool de mots, avec les
 * quotas jour/session et le frein anti-retard.
 * @param {Array} wordList - pool complet du niveau choisi
 */
function startFlashSession(wordList) {
  if (!wordList || wordList.length === 0) {
    toast('Aucun mot disponible pour ce niveau.');
    return;
  }

  // Frein anti-retard : basé sur le retard GLOBAL (tous niveaux), pour
  // rester cohérent avec le quota de nouveaux mots qui est lui aussi global.
  const globalBacklog = getBacklogCount(Object.values(state.db).flat()); // srs.js
  const throttled = globalBacklog > BACKLOG_THROTTLE_THRESHOLD;

  const quota = {
    dailyRemaining: throttled ? 0 : getDailyRemaining(),
    sessionCap:     throttled ? 0 : SESSION_NEW_WORD_CAP,
  };

  const queue = buildFlashcardQueue(wordList, quota); // srs.js
  if (queue.length === 0) {
    toast('Rien à réviser pour le moment — reviens plus tard !');
    return;
  }
  if (throttled) {
    toast('⏸️ Trop de retard accumulé — on se concentre sur le rattrapage avant les nouveaux mots');
  }

  state.flashWordList     = wordList;
  state.lastFlashWordList = wordList;
  state.flashQueue        = queue;
  state.flashIndex        = 0;
  state.flashCurrentItem   = null;
  state.flashIsFlipped     = false;
  state.flashStats         = { blackout: 0, hard: 0, medium: 0, easy: 0 };
  state.isLeechSession     = false;

  recordActivity(); // day streak

  goTo('flashcard');
  renderFlashCard();
}

/**
 * Démarre une session dédiée aux mots difficiles (leechs : 4 échecs
 * consécutifs). Hors quota — ce sont par définition des cartes déjà vues.
 */
function startLeechSession() {
  const allWords = Object.values(state.db).flat();
  const queue = buildLeechQueue(allWords); // srs.js
  if (queue.length === 0) {
    toast('😌 Aucun mot difficile en ce moment !');
    return;
  }

  state.flashWordList     = allWords;
  state.lastFlashWordList = allWords;
  state.flashQueue        = queue;
  state.flashIndex        = 0;
  state.flashCurrentItem   = null;
  state.flashIsFlipped     = false;
  state.flashStats         = { blackout: 0, hard: 0, medium: 0, easy: 0 };
  state.isLeechSession     = true;

  toast(`💀 Mode mots difficiles — ${queue.length} cartes`);
  goTo('flashcard');
  renderFlashCard();
}

/** Affiche la carte courante (face recto). */
function renderFlashCard() {
  if (state.flashIndex >= state.flashQueue.length) {
    finishFlashSession();
    return;
  }

  const item = state.flashQueue[state.flashIndex];
  const w    = item.word;
  state.flashCurrentItem = item;
  state.flashIsFlipped   = false;
  state.flashIsJpFr      = item.dir === 'read'; // le sens vient de la file, plus de hasard

  // Progression
  const progFill = document.getElementById('flash-prog-fill');
  const progText = document.getElementById('flash-prog-text');
  progFill.style.width = Math.round((state.flashIndex / state.flashQueue.length) * 100) + '%';
  progText.textContent = (state.flashIndex + 1) + ' / ' + state.flashQueue.length;

  // Badges SRS (propres au sens affiché : lecture ou production)
  const e = getSRSEntry(item.cardId); // srs.js
  const stateBadge = document.getElementById('flash-badge-state');
  const levelBadge = document.getElementById('flash-badge-level');
  if (e.totalReviews === 0)            stateBadge.textContent = 'Nouveau';
  else if (e.isLeech)                  stateBadge.textContent = 'Difficile';
  else if (e.nextReview <= Date.now()) stateBadge.textContent = 'À réviser';
  else                                  stateBadge.textContent = 'Vu';
  levelBadge.textContent = (state.flashIsJpFr ? 'Lecture' : 'Prod.') + ' · Niv. ' + e.srsLevel;

  // Recto
  const cfDir  = document.getElementById('cf-dir');
  const cfMain = document.getElementById('cf-main');
  const cfKana = document.getElementById('cf-kana');
  if (state.flashIsJpFr) {
    cfDir.textContent  = 'JP → FR';
    cfMain.className   = 'cf-main';
    cfMain.textContent = w.kanji;
    cfKana.textContent = w.kana;
    cfKana.style.display = '';
  } else {
    cfDir.textContent  = 'FR → JP';
    cfMain.className   = 'cf-main cf-latin';
    cfMain.textContent = w.fr;
    cfKana.textContent = '';
    cfKana.style.display = 'none';
  }

  // Masquer verso + boutons, afficher le conseil
  document.getElementById('flash-card').classList.remove('flipped');
  document.getElementById('rate-grid').classList.add('hidden');
  document.getElementById('flash-tip').classList.remove('hidden');
}

/** Retourne la carte (flip verso + boutons d'évaluation + preview des intervalles). */
function flipFlashCard() {
  if (state.flashIsFlipped) return;
  state.flashIsFlipped = true;

  const item = state.flashCurrentItem;
  const w    = item.word;
  document.getElementById('flash-card').classList.add('flipped');

  const cbAnswer  = document.getElementById('cb-answer');
  const cbExample = document.getElementById('cb-example');
  if (state.flashIsJpFr) {
    cbAnswer.textContent = w.fr;
  } else {
    cbAnswer.innerHTML =
      `<span class="cb-jp">${escHtml(w.kanji)}</span><span class="cb-kana">${escHtml(w.kana)}</span>`;
  }
  cbExample.textContent = w.ex || '';

  // Prévisualise l'intervalle de chaque bouton avant que l'utilisateur ne choisisse
  ['blackout', 'hard', 'medium', 'easy'].forEach(ease => {
    const el = document.getElementById('ri-' + ease);
    if (el) el.textContent = previewIntervalLabel(item.cardId, ease); // srs.js
  });

  document.getElementById('flash-tip').classList.add('hidden');
  document.getElementById('rate-grid').classList.remove('hidden');
}

/**
 * Accorde le bonus de points quand une carte devient mature pour la
 * première fois (lecture ET production comptent séparément). Partagé
 * entre le mode flashcard et le mode QCM.
 */
function awardMasteryBonus() {
  const gained   = applyBoost(ANKI_MASTERY_POINTS);
  const prevRank = getRank(state.permTotal);
  state.permTotal     += gained;
  state.lifetimeTotal += gained;
  save();
  Cloud.logPoints(gained).catch(() => { /* best-effort */ });

  const newRank = getRank(state.permTotal);
  if (newRank.id !== prevRank.id) {
    toast(`🎉 ${newRank.label} ${newRank.jp} — carte acquise +${gained} pts`);
  } else {
    toast(`📌 Carte acquise ! +${gained} pts`);
  }
}

/**
 * Évalue la carte et passe à la suivante.
 * "blackout" → vrai échec, boucle serrée immédiate (1–3 cartes plus loin),
 * EN PLUS de ses passages déjà programmés dans la session.
 * "hard" → neutre, ne déclenche plus de rappel supplémentaire (il a déjà
 * ses passages normaux programmés).
 * @param {'blackout'|'hard'|'medium'|'easy'} ease
 */
function rateFlashCard(ease) {
  if (!state.flashIsFlipped || !state.flashCurrentItem) return;
  const item = state.flashCurrentItem;

  const eBefore = getSRSEntry(item.cardId); // srs.js
  const wasNew  = eBefore.totalReviews === 0;

  const { justMastered } = updateSRSFlashcard(item.cardId, ease); // srs.js
  state.flashStats[ease] = (state.flashStats[ease] || 0) + 1;

  // Le quota de nouveaux mots n'est décompté QUE quand la carte est
  // vraiment notée pour la première fois (pas juste parce qu'elle
  // était dans la file).
  if (wasNew && !state.isLeechSession) incrementDailyNewCount();

  if (justMastered) awardMasteryBonus();

  save();

  if (ease === 'blackout') {
    reinsertInSession(state.flashQueue, state.flashIndex, item, 1, 3); // srs.js
  }

  state.flashIndex++;
  renderFlashCard();
}

/** Fin de session — stats + retour menu. */
function finishFlashSession() {
  const s = state.flashStats || {};
  const total = (s.blackout || 0) + (s.hard || 0) + (s.medium || 0) + (s.easy || 0);

  const doneStats = document.getElementById('done-stats');
  doneStats.innerHTML = `
    <div class="done-stat"><span class="ds-num">${total}</span><span class="ds-lbl">Cartes</span></div>
    <div class="done-stat"><span class="ds-num">${s.easy || 0}</span><span class="ds-lbl">Facile</span></div>
    <div class="done-stat"><span class="ds-num">${(s.blackout || 0) + (s.hard || 0)}</span><span class="ds-lbl">À retravailler</span></div>
  `;
  document.getElementById('done-rank').textContent = `${getDueWords().length} cartes encore dues aujourd'hui`;

  renderMenu();
  const fd = document.querySelector('[data-screen="flashdone"]');
  goTo(fd ? 'flashdone' : 'menu');
  pushFullProgress();
}

/* ══════════════════════════════════════
   EFFETS VISUELS — Flash & Toast
══════════════════════════════════════ */

/**
 * Déclenche un flash de couleur sur tout l'écran.
 * @param {string} color - Couleur CSS (rgba recommandé)
 */
function flash(color) {
  const f = document.getElementById('sf');
  f.style.background = color;
  f.style.opacity    = '1';
  setTimeout(() => { f.style.opacity = '0'; }, 110);
}

/**
 * Affiche un toast de notification temporaire.
 * @param {string} msg - Message à afficher
 */
function toast(msg) {
  // Supprime les toasts existants pour éviter l'empilement
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className  = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2100);
}

/* ══════════════════════════════════════
   COMPTE — connexion / inscription / profil
══════════════════════════════════════ */

/** Ouvre l'écran compte (formulaire ou profil selon l'état de connexion). */
function openAuthScreen() {
  renderAuthScreen();
  goTo('auth');
}

/** Affiche le bon contenu (formulaire ou profil) sur l'écran compte. */
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

/** Bascule entre les modes connexion / inscription du formulaire. */
function setAuthMode(mode) {
  state.authMode = mode;
  document.getElementById('auth-tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('auth-tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('auth-username-field').classList.toggle('hidden', mode === 'login');
  document.getElementById('btn-auth-submit').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  document.getElementById('auth-msg').classList.add('hidden');
}

/** Affiche un message dans le formulaire compte. */
function showAuthMsg(text, ok) {
  const msg = document.getElementById('auth-msg');
  msg.textContent = text;
  msg.classList.remove('hidden');
  msg.classList.toggle('ok', !!ok);
}

/** Traduit les erreurs Supabase les plus courantes en français. */
function translateAuthError(message) {
  if (!message) return 'Une erreur est survenue.';
  if (/already registered|already exists/i.test(message)) return 'Un compte existe déjà avec cet email.';
  if (/Invalid login credentials/i.test(message))          return 'Email ou mot de passe incorrect.';
  if (/Password should be at least/i.test(message))        return 'Mot de passe trop court (6 caractères minimum).';
  if (/déjà pris/i.test(message))                           return message;
  return message;
}

/** Gère la soumission du formulaire connexion/inscription. */
async function handleAuthSubmit() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const username = document.getElementById('auth-username').value.trim();
  const btn      = document.getElementById('btn-auth-submit');

  document.getElementById('auth-msg').classList.add('hidden');

  if (!Cloud.isAvailable()) {
    showAuthMsg('Comptes indisponibles — configuration Supabase manquante (voir SETUP.md).');
    return;
  }
  if (!email || !password) {
    showAuthMsg('Email et mot de passe requis.');
    return;
  }
  if (state.authMode === 'signup' && username.length < 3) {
    showAuthMsg('Choisis un pseudo de 3 caractères minimum.');
    return;
  }

  btn.disabled = true;
  try {
    if (state.authMode === 'login') {
      await Cloud.signIn(email, password);
      state.cloudUsername = await Cloud.getUsername();
    } else {
      await Cloud.signUp(email, password, username);
      state.cloudUsername = username;
    }
    await syncOnLogin();
    toast(`☁️ Connecté en tant que ${state.cloudUsername}`);
    renderMenu();
    renderAccountCard();
    goTo('menu');
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

/** Déconnexion — la progression reste intacte en local. */
async function doLogout() {
  await Cloud.signOut();
  state.cloudUsername = null;
  renderAccountCard();
  toast('Déconnecté — progression conservée localement');
}

/* ══════════════════════════════════════
   CLASSEMENT
══════════════════════════════════════ */

/** Ouvre l'écran classement et charge la période courante. */
function openLeaderboard() {
  goTo('leaderboard');
  loadLeaderboard(state.lbPeriod);
}

/** Change la période affichée (jour / semaine / général). */
function setLbPeriod(period) {
  state.lbPeriod = period;
  document.querySelectorAll('.diff-btn[data-period]').forEach(b => b.classList.toggle('active', b.dataset.period === period));
  loadLeaderboard(period);
}

/** Charge et affiche le top 50 d'une période. */
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

/* ══════════════════════════════════════
   RACCOURCIS CLAVIER
══════════════════════════════════════ */
document.addEventListener('keydown', e => {
  // Ne jamais intercepter les raccourcis pendant une saisie (email, mot de
  // passe, pseudo, recherche...) — sinon taper "h" dans un champ ouvrait
  // l'aide au milieu de la frappe.
  const activeTag = (document.activeElement && document.activeElement.tagName) || '';
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

  if (e.key === 'h' || e.key === 'H') { toggleKb(); return; }
  if (e.key === 'Escape')              { closeKb();  return; }

  if (state.currentScreen === 'game') {
    if (e.key === 'f' || e.key === 'F') { toggleFuri(); return; }
    const map = { '1':0, '2':1, '3':2, '4':3 };
    if (map[e.key] !== undefined) {
      const btns = Array.from(document.getElementById('opts-grid').children)
                        .filter(b => !b.disabled);
      if (btns[map[e.key]]) btns[map[e.key]].click();
    }
  }

  if (state.currentScreen === 'flashcard') {
    if ((e.key === ' ' || e.key === 'Enter') && !state.flashIsFlipped) {
      e.preventDefault();
      flipFlashCard();
      return;
    }
    if (state.flashIsFlipped) {
      const easeMap = { '1':'blackout', '2':'hard', '3':'medium', '4':'easy' };
      if (easeMap[e.key]) rateFlashCard(easeMap[e.key]);
    }
  }
});

/* ── Overlay aide clavier ── */

function toggleKb() { if (state.kbOverlay) { closeKb(); } else { openKb(); } }

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
  document.getElementById('app').appendChild(state.kbOverlay);
}

function closeKb() {
  if (state.kbOverlay) { state.kbOverlay.remove(); state.kbOverlay = null; }
}

/* ══════════════════════════════════════
   BINDING DES ÉVÉNEMENTS
══════════════════════════════════════ */
function bindEvents() {
  // Navigation globale
  document.getElementById('global-back').addEventListener('click', goBack);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Easter egg (clic sur le wordmark)
  const wmName = document.querySelector('.wm-name');
  if (wmName) {
    wmName.addEventListener('click', () => {
      state.easterClicks++;
      if (state.easterClicks === 5)  { state.easterActive = true; toast('Mode Shifu activé — vies infinies'); }
      if (state.easterClicks === 10) { wmName.textContent = 'Hiro King'; toast('Dieu du japonais débloqué'); }
    });
  }

  // Compte
  document.getElementById('btn-go-auth').addEventListener('click', openAuthScreen);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('auth-tab-login').addEventListener('click', () => setAuthMode('login'));
  document.getElementById('auth-tab-signup').addEventListener('click', () => setAuthMode('signup'));
  document.getElementById('btn-auth-submit').addEventListener('click', handleAuthSubmit);
  document.getElementById('btn-auth-guest').addEventListener('click', () => goTo('menu'));
  document.getElementById('btn-auth-logout').addEventListener('click', async () => {
    await doLogout();
    goTo('menu');
  });

  // Classement
  document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
  document.getElementById('btn-stats').addEventListener('click', openStatsScreen);
  document.querySelectorAll('.diff-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => setLbPeriod(btn.dataset.period));
  });

  // Rebirth
  document.getElementById('rebirth-btn').addEventListener('click', openRebirthModal);
  document.getElementById('rebirth-confirm').addEventListener('click', doRebirth);
  document.getElementById('rebirth-cancel').addEventListener('click', closeRebirthModal);

  // Menu : Anki global + niveaux
  document.getElementById('btn-anki-all').addEventListener('click', () => {
    startFlashSession(Object.values(state.db).flat());
  });
  document.getElementById('btn-leeches').addEventListener('click', startLeechSession);
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => selectLevel(btn.dataset.level));
  });
  document.getElementById('btn-all-levels').addEventListener('click', () => selectLevel('ALL'));

  // Configuration : difficulté + timer + actions
  document.querySelectorAll('.diff-btn[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => setDiff(btn.dataset.diff, btn));
  });
  document.getElementById('timer-toggle').addEventListener('click', toggleTimer);
  document.getElementById('btn-start-quiz').addEventListener('click', startGame);
  document.getElementById('btn-start-flash-level').addEventListener('click', () => startFlashSession(state.wordList));
  document.getElementById('btn-show-list').addEventListener('click', showWordList);

  // Liste des mots : recherche
  document.getElementById('list-search').addEventListener('input', e => filterWordList(e.target.value));

  // Furigana (QCM)
  document.getElementById('furi-btn').addEventListener('click', toggleFuri);

  // Flashcard : flip + évaluation
  document.getElementById('flash-card').addEventListener('click', flipFlashCard);
  ['blackout', 'hard', 'medium', 'easy'].forEach(ease => {
    document.getElementById('rate-' + ease).addEventListener('click', () => rateFlashCard(ease));
  });
  document.getElementById('btn-flash-again').addEventListener('click', () => startFlashSession(state.lastFlashWordList));
  document.getElementById('btn-flash-menu').addEventListener('click', () => { renderMenu(); goTo('menu'); });

  // Game over
  document.getElementById('btn-replay').addEventListener('click', startGame);
  document.getElementById('btn-go-menu').addEventListener('click', () => goTo('menu'));
}

/* ══════════════════════════════════════
   INITIALISATION
   DOMContentLoaded garantit que tous les
   éléments HTML existent avant le binding.
══════════════════════════════════════ */
async function startApp() {
  loadStorage();  // Charge la progression depuis localStorage
  initTheme();    // Applique le thème sauvegardé
  bindEvents();   // Attache tous les écouteurs d'événements
  Cloud.init();   // Initialise le client Supabase (no-op si non configuré)

  await loadDB(); // Charge les mots, affiche le menu

  // Restaure une éventuelle session existante et synchronise en arrière-plan
  try {
    const session = await Cloud.restoreSession();
    if (session) {
      state.cloudUsername = await Cloud.getUsername();
      await syncOnLogin();
      renderMenu();
      renderAccountCard();
    }
  } catch (e) {
    console.error('[Cloud] Restauration de session échouée', e);
  }
}

document.addEventListener('DOMContentLoaded', startApp);
