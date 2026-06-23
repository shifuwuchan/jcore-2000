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
    return data;
  }

  async function signOut() {
    if (!available) return;
    try { await client.auth.signOut(); } catch (e) { console.error('[Cloud] signOut', e); }
    session = null;
  }

  /** Récupère le pseudo public de l'utilisateur connecté. */
  async function getUsername() {
    if (!available || !isLoggedIn()) return null;
    const { data, error } = await client
      .from('profiles').select('username')
      .eq('id', currentUser().id).maybeSingle();
    if (error) { console.error('[Cloud] getUsername', error); return null; }
    return data ? data.username : null;
  }

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
  async function pushProgress({ permTotal, rebirths, lifetimeTotal, hs, srsData }) {
    if (!available || !isLoggedIn()) return;
    const row = {
      user_id: currentUser().id,
      perm_total: permTotal,
      rebirths: rebirths,
      lifetime_total: lifetimeTotal,
      hs: hs,
      srs_data: srsData,
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
   * @param {'day'|'week'|'all'} period
   * @returns {Promise<Array<{username:string, total_points:number}>>}
   */
  async function fetchLeaderboard(period) {
    if (!available) return [];
    const rpcName = period === 'all' ? 'get_overall_leaderboard' : 'get_leaderboard';
    const args    = period === 'all' ? {} : { p_period: period };
    const { data, error } = await client.rpc(rpcName, args);
    if (error) { console.error('[Cloud] fetchLeaderboard', error); return []; }
    return data || [];
  }

  return {
    init, isAvailable, restoreSession,
    isLoggedIn, currentUser, currentEmail,
    signUp, signIn, signOut, getUsername,
    pullProgress, pushProgress, logPoints, fetchLeaderboard,
  };
})();
