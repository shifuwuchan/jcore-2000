'use strict';

/* ═══════════════════════════════════════════════════════════════════
   cloud.js — Comptes, synchronisation cross-device & classement
   Backend : Supabase (Postgres + Auth). Voir schema.sql + SETUP.md.

   Ce module ne touche jamais au DOM : il expose uniquement des
   fonctions async que app.js orchestre. Si Supabase n'est pas
   configuré (config.js laissé par défaut), l'app continue de
   fonctionner normalement en mode 100% local (localStorage).
═══════════════════════════════════════════════════════════════════ */

const Cloud = (() => {
  let client    = null;
  let session   = null;
  let available = false; // true si config.js a été rempli correctement
  let isAdminFlag = false; // ⚠️ purement cosmétique (affiche/cache le lien admin) —
                            // la vraie protection est public.is_admin() côté Supabase

  /** Initialise le client Supabase. À appeler une fois au démarrage. */
  function init() {
    const cfg = window.JCORE_CONFIG;
    const hasSdk = typeof window.supabase !== 'undefined';
    const hasCfg = cfg && cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('TON-PROJET')
                       && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('TON-ANON-KEY');

    if (!hasSdk || !hasCfg) {
      console.warn('[Cloud] Supabase non configuré (voir config.js + SETUP.md) — mode local uniquement.');
      available = false;
      return false;
    }

    try {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      available = true;
    } catch (e) {
      console.error('[Cloud] Échec d\'initialisation Supabase', e);
      available = false;
    }
    return available;
  }

  /** true si Supabase est configuré et utilisable. */
  function isAvailable() { return available; }

  /** Restaure la session existante (si l'utilisateur était déjà connecté). */
  async function restoreSession() {
    if (!available) return null;
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      session = data.session || null;
      return session;
    } catch (e) {
      console.error('[Cloud] restoreSession', e);
      return null;
    }
  }

  function isLoggedIn()   { return !!session; }
  function currentUser()  { return session ? session.user : null; }
  function currentEmail() { return session ? session.user.email : null; }

  /**
   * Crée un compte + un profil public (pseudo affiché dans le classement).
   * @throws si l'email est invalide, le mot de passe trop court, ou le
   *         pseudo déjà pris.
   */
  async function signUp(email, password, username) {
    if (!available) throw new Error('Supabase non configuré.');
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;

    if (data.user) {
      const { error: profErr } = await client
        .from('profiles')
        .insert({ id: data.user.id, username });
      if (profErr) {
        if (profErr.code === '23505') throw new Error('Ce pseudo est déjà pris.');
        throw profErr;
      }
    }

    if (data.session) {
      session = data.session;
    } else {
      // Confirmation email requise côté Supabase — pas de session immédiate.
      throw new Error('CONFIRM_EMAIL');
    }
    return data;
  }

  async function signIn(email, password) {
    if (!available) throw new Error('Supabase non configuré.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    session = data.session;

    // Vérifie le bannissement juste après connexion : auth.signInWithPassword
    // réussit toujours côté Supabase Auth (le flag banned ne vit que dans
    // profiles), donc on doit le vérifier nous-mêmes et refuser l'accès.
    const { data: prof } = await client
      .from('profiles').select('banned')
      .eq('id', data.user.id).maybeSingle();
    if (prof && prof.banned) {
      await client.auth.signOut();
      session = null;
      throw new Error('BANNED');
    }

    return data;
  }

  async function signOut() {
    if (!available) return;
    try { await client.auth.signOut(); } catch (e) { console.error('[Cloud] signOut', e); }
    session = null;
    isAdminFlag = false; // sinon le lien admin resterait visible après déconnexion
  }

  /**
   * Récupère le pseudo public de l'utilisateur connecté (et son statut
   * admin). Si le compte est banni, force la déconnexion et retourne
   * null — couvre le cas d'une session déjà active sur ce navigateur
   * au moment où un admin bannit ce compte ailleurs.
   */
  async function getUsername() {
    if (!available || !isLoggedIn()) return null;
    const { data, error } = await client
      .from('profiles').select('username, is_admin, banned')
      .eq('id', currentUser().id).maybeSingle();
    if (error) { console.error('[Cloud] getUsername', error); return null; }

    if (data && data.banned) {
      await signOut();
      return null;
    }

    isAdminFlag = !!(data && data.is_admin);
    return data ? data.username : null;
  }

  /** true si le compte connecté a le flag is_admin (rafraîchi par getUsername). */
  function isAdmin() { return isAdminFlag; }

  /** Récupère le snapshot de progression cloud (ou null si jamais sync). */
  async function pullProgress() {
    if (!available || !isLoggedIn()) return null;
    const { data, error } = await client
      .from('progress').select('*')
      .eq('user_id', currentUser().id).maybeSingle();
    if (error) { console.error('[Cloud] pullProgress', error); return null; }
    return data;
  }

  /** Envoie le snapshot de progression complet (upsert). Fire-and-forget conseillé. */
  async function pushProgress({ permTotal, rebirths, lifetimeTotal, hs, srsData, dayStreak, lastActive, lastFreezeUsed }) {
    if (!available || !isLoggedIn()) return;
    const row = {
      user_id: currentUser().id,
      perm_total: permTotal,
      rebirths: rebirths,
      lifetime_total: lifetimeTotal,
      hs: hs,
      srs_data: srsData,
      day_streak: dayStreak,
      last_active: lastActive || null,
      last_freeze_used: lastFreezeUsed || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from('progress').upsert(row);
    if (error) console.error('[Cloud] pushProgress', error);
  }

  /** Enregistre des points gagnés à l'instant T (pour les classements quotidien/hebdo). */
  async function logPoints(points) {
    if (!available || !isLoggedIn() || points <= 0) return;
    const { error } = await client
      .from('points_log')
      .insert({ user_id: currentUser().id, points });
    if (error) console.error('[Cloud] logPoints', error);
  }

  /**
   * Récupère le top 50 d'une période.
   * @param {'day'|'week'|'all'|'streak'} period
   * @returns {Promise<Array<{username:string, total_points?:number, day_streak?:number, rebirths:number}>>}
   */
  async function fetchLeaderboard(period) {
    if (!available) return [];
    let rpcName, args;
    if (period === 'all')         { rpcName = 'get_overall_leaderboard'; args = {}; }
    else if (period === 'streak') { rpcName = 'get_streak_leaderboard';  args = {}; }
    else                            { rpcName = 'get_leaderboard'; args = { p_period: period }; }
    const { data, error } = await client.rpc(rpcName, args);
    if (error) { console.error('[Cloud] fetchLeaderboard', error); return []; }
    return data || [];
  }

  /**
   * Liste tous les joueurs avec leurs stats (admin uniquement — la
   * RPC elle-même filtre côté serveur, voir schema.sql section 7).
   * @returns {Promise<Array>} liste vide si non-admin ou erreur.
   */
  async function adminListPlayers() {
    if (!available || !isLoggedIn()) return [];
    const { data, error } = await client.rpc('admin_list_players');
    if (error) { console.error('[Cloud] adminListPlayers', error); return []; }
    return data || [];
  }

  /**
   * Modifie le profil/la progression d'un joueur (admin uniquement).
   * Tous les champs sont optionnels : seuls ceux fournis sont écrits.
   * @throws si l'appelant n'est pas admin (vérifié côté serveur).
   */
  async function adminUpdatePlayer(userId, fields) {
    if (!available) throw new Error('Supabase non configuré.');
    const { error } = await client.rpc('admin_update_player', {
      p_user_id: userId,
      p_username: fields.username ?? null,
      p_is_admin: fields.isAdmin ?? null,
      p_banned: fields.banned ?? null,
      p_perm_total: fields.permTotal ?? null,
      p_rebirths: fields.rebirths ?? null,
      p_lifetime_total: fields.lifetimeTotal ?? null,
      p_day_streak: fields.dayStreak ?? null,
    });
    if (error) throw error;
  }

  /**
   * Supprime totalement un compte (admin uniquement, pas son propre
   * compte). @throws si l'appelant n'est pas admin, ou si la cible
   * est l'appelant lui-même (vérifié côté serveur).
   */
  async function adminDeletePlayer(userId) {
    if (!available) throw new Error('Supabase non configuré.');
    const { error } = await client.rpc('admin_delete_player', { p_user_id: userId });
    if (error) throw error;
  }

  /**
   * Détail SRS brut (par mot) d'un joueur — à la demande, pas chargé
   * avec la liste complète (gros JSON). admin uniquement.
   * @returns {Promise<Object>} objet vide si non-admin ou erreur.
   */
  async function adminGetPlayerSrs(userId) {
    if (!available) return {};
    const { data, error } = await client.rpc('admin_get_player_srs', { p_user_id: userId });
    if (error) { console.error('[Cloud] adminGetPlayerSrs', error); return {}; }
    return data || {};
  }

  /**
   * Statistiques globales (total joueurs, actifs 7j, points cumulés,
   * rebirths cumulés, comptes bannis). admin uniquement.
   * @returns {Promise<Object|null>} null si non-admin ou erreur.
   */
  async function adminGetGlobalStats() {
    if (!available) return null;
    const { data, error } = await client.rpc('admin_get_global_stats');
    if (error) { console.error('[Cloud] adminGetGlobalStats', error); return null; }
    return (data && data[0]) || null;
  }

  /**
   * Journal des 50 dernières actions admin (qui, quoi, quand, sur qui).
   * admin uniquement.
   * @returns {Promise<Array>} liste vide si non-admin ou erreur.
   */
  async function adminGetLog() {
    if (!available) return [];
    const { data, error } = await client.rpc('admin_get_log');
    if (error) { console.error('[Cloud] adminGetLog', error); return []; }
    return data || [];
  }

  return {
    init, isAvailable, restoreSession,
    isLoggedIn, currentUser, currentEmail,
    signUp, signIn, signOut, getUsername, isAdmin,
    pullProgress, pushProgress, logPoints, fetchLeaderboard,
    adminListPlayers, adminUpdatePlayer, adminDeletePlayer,
    adminGetPlayerSrs, adminGetGlobalStats, adminGetLog,
  };
})();

/* Expose explicitement sur window : une déclaration `const` au niveau
   global d'un <script> ne crée PAS automatiquement window.Cloud (au
   contraire de `var`), donc le `if (window.Cloud)` dans core.js
   échouait toujours silencieusement sans cette ligne. */
window.Cloud = Cloud;
