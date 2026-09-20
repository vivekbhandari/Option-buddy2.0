// Spread Stack — trades API (Cloudflare Worker + D1)
//
// Stores each user's trades in Cloudflare D1. Identity comes from Supabase:
// the browser signs in with Supabase (Google OAuth), and every request here
// carries the resulting Supabase access token as a Bearer header. This Worker
// verifies that token itself against Supabase's public JWKS endpoint (no
// shared secret involved — asymmetric verification) and trusts the token's
// "sub" claim as the user id. D1 has no row-level security, so every query
// below filters by that verified user id — never by anything the client sends.
//
// Routes (all require "Authorization: Bearer <supabase access token>"):
//   GET    /trades       -> list this user's trades
//   PUT    /trades/:id   -> upsert one trade (body: the trade JSON)
//   DELETE /trades/:id   -> delete one trade

import { jwtVerify, createRemoteJWKSet } from 'jose';

let jwks = null; // createRemoteJWKSet caches responses internally; cache the set itself per isolate
function getJWKS(env) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

async function getUserId(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], getJWKS(env), {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch (e) {
    return null;
  }
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
function json(data, status, env) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(env) } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });

    const parts = url.pathname.split('/').filter(Boolean); // ['trades'] or ['trades', ':id']
    if (parts[0] !== 'trades') return json({ error: 'Unknown route. Use /trades or /trades/:id' }, 404, env);

    const userId = await getUserId(request, env);
    if (!userId) return json({ error: 'Missing or invalid Authorization token' }, 401, env);

    try {
      if (request.method === 'GET' && parts.length === 1) {
        const { results } = await env.DB.prepare('SELECT id, data, updated_at FROM trades WHERE user_id = ?').bind(userId).all();
        return json({ trades: results.map(r => ({ ...JSON.parse(r.data), _updatedAt: r.updated_at })) }, 200, env);
      }

      if (request.method === 'PUT' && parts.length === 2) {
        const id = parts[1];
        const trade = await request.json();
        await env.DB.prepare(
          'INSERT INTO trades (id, user_id, data, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE trades.user_id = ?'
        ).bind(id, userId, JSON.stringify(trade), Date.now(), userId).run();
        return json({ ok: true }, 200, env);
      }

      if (request.method === 'DELETE' && parts.length === 2) {
        const id = parts[1];
        await env.DB.prepare('DELETE FROM trades WHERE id = ? AND user_id = ?').bind(id, userId).run();
        return json({ ok: true }, 200, env);
      }

      return json({ error: 'Unsupported method/route' }, 405, env);
    } catch (e) {
      return json({ error: 'Server error: ' + e.message }, 500, env);
    }
  },
};
