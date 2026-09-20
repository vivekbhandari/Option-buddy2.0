/*
 * Spread Stack — auth + cloud trade sync.
 * Supabase handles identity only (Google sign-in) — no app data lives there.
 * Trades are stored in Cloudflare D1 via trades-api/, which verifies the
 * Supabase access token itself. Signed-out users are unaffected: everything
 * still works from local storage alone, exactly as before this file existed.
 *
 * Fill these in once you've followed trades-api/README.md:
 */
window.SBAuth = (function () {
  'use strict';
  const SUPABASE_URL = '';
  const SUPABASE_ANON_KEY = '';
  const TRADES_API_URL = '';

  let client = null;
  let currentUser = null;
  let ready = false;
  const listeners = [];

  function configured() {
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);
  }

  function notify() { listeners.forEach(fn => { try { fn(currentUser); } catch (e) { /* ignore */ } }); }

  // Registers a callback for auth state changes; fires immediately with the
  // current state once init() has resolved the initial session (or right
  // away, as "signed out", if Supabase isn't configured yet).
  function onChange(fn) {
    listeners.push(fn);
    if (ready) fn(currentUser);
  }

  function init() {
    if (!configured()) { ready = true; notify(); return; }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    client.auth.getSession().then(({ data }) => {
      currentUser = data.session ? data.session.user : null;
      ready = true;
      notify();
    });
    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session ? session.user : null;
      notify();
    });
  }

  async function signInWithGoogle() {
    if (!client) return { error: 'Sign-in is not configured yet.' };
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    return error ? { error: error.message } : {};
  }
  async function signOut() {
    if (client) await client.auth.signOut();
  }
  function getUser() { return currentUser; }
  async function getAccessToken() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session ? data.session.access_token : null;
  }

  // ---------- trade sync against trades-api (Cloudflare D1) ----------
  function syncConfigured() { return !!TRADES_API_URL; }

  async function apiFetch(path, opts) {
    if (!syncConfigured()) return { error: 'Cloud sync is not configured yet.' };
    const token = await getAccessToken();
    if (!token) return { error: 'Not signed in.' };
    try {
      const res = await fetch(TRADES_API_URL + path, Object.assign({}, opts, {
        headers: Object.assign({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, opts && opts.headers),
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || ('HTTP ' + res.status) };
      return { data };
    } catch (e) {
      return { error: 'Network error reaching the trades API.' };
    }
  }
  function fetchCloudTrades() { return apiFetch('/trades', { method: 'GET' }); }
  function saveTradeToCloud(trade) { return apiFetch('/trades/' + encodeURIComponent(trade.id), { method: 'PUT', body: JSON.stringify(trade) }); }
  function deleteTradeFromCloud(id) { return apiFetch('/trades/' + encodeURIComponent(id), { method: 'DELETE' }); }

  return {
    init, configured, syncConfigured, onChange,
    signInWithGoogle, signOut, getUser, getAccessToken,
    fetchCloudTrades, saveTradeToCloud, deleteTradeFromCloud,
  };
})();

document.addEventListener('DOMContentLoaded', () => window.SBAuth.init());
