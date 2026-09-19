// Spread Stack — Yahoo Finance proxy (Cloudflare Worker)
//
// Yahoo Finance has no public API. Its own website calls an internal,
// undocumented one that (a) requires a cookie+crumb handshake fundamentals
// requests can't do cross-origin from a browser, and (b) sends no CORS
// headers at all. This Worker does the handshake and the Yahoo request
// server-to-server (no CORS restrictions between servers), then returns
// the JSON to the browser with proper CORS headers attached.
//
// Routes:
//   GET /quote/:ticker?modules=assetProfile,financialData,defaultKeyStatistics,summaryDetail
//     -> fundamentals (quoteSummary)
//   GET /chart/:ticker
//     -> price history / current quote (chart)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CRUMB_TTL_MS = 50 * 60 * 1000; // Yahoo's crumb/cookie pair is good for roughly an hour; refresh a bit early
const DEFAULT_MODULES = 'assetProfile,financialData,defaultKeyStatistics,summaryDetail,price';

// Module-scope cache: persists across requests on a warm Worker isolate,
// reset on cold start — fine for this volume, no KV/Durable Object needed.
let cached = { cookie: null, crumb: null, expiresAt: 0 };

async function getCrumb() {
  if (cached.crumb && Date.now() < cached.expiresAt) return cached;

  const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const setCookie = cookieRes.headers.get('set-cookie');
  if (!setCookie) throw new Error('Yahoo did not return a session cookie');
  const cookie = setCookie.split(';')[0];

  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
  });
  if (!crumbRes.ok) throw new Error(`Failed to fetch crumb (HTTP ${crumbRes.status})`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb) throw new Error('Yahoo returned an empty crumb');

  cached = { cookie, crumb, expiresAt: Date.now() + CRUMB_TTL_MS };
  return cached;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

async function withRetryOnAuthFailure(fn) {
  try {
    return await fn();
  } catch (e) {
    // crumb/cookie can expire early or be rejected; clear cache and retry once
    cached = { cookie: null, crumb: null, expiresAt: 0 };
    return await fn();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Only GET is supported' }, 405, env);
    }

    const parts = url.pathname.split('/').filter(Boolean); // ['quote', 'AAPL'] or ['chart', 'AAPL']
    const [route, rawTicker] = parts;
    const ticker = (rawTicker || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    if (!ticker) return json({ error: 'Missing ticker in the URL, e.g. /quote/AAPL' }, 400, env);

    try {
      if (route === 'quote') {
        const modules = (url.searchParams.get('modules') || DEFAULT_MODULES).replace(/[^a-zA-Z,]/g, '');
        const data = await withRetryOnAuthFailure(async () => {
          const { cookie, crumb } = await getCrumb();
          const yRes = await fetch(
            `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
            { headers: { 'User-Agent': UA, 'Cookie': cookie } }
          );
          if (!yRes.ok) throw new Error(`Yahoo quoteSummary returned HTTP ${yRes.status}`);
          return yRes.json();
        });
        const result = data && data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0];
        if (!result) return json({ error: `No fundamentals found for "${ticker}"` }, 404, env);
        return json(result, 200, env);
      }

      if (route === 'chart') {
        const yRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`, {
          headers: { 'User-Agent': UA },
        });
        if (!yRes.ok) return json({ error: `Yahoo chart returned HTTP ${yRes.status}` }, 502, env);
        const data = await yRes.json();
        const result = data && data.chart && data.chart.result && data.chart.result[0];
        if (!result) return json({ error: `No quote found for "${ticker}"` }, 404, env);
        return json(result, 200, env);
      }

      return json({ error: 'Unknown route. Use /quote/:ticker or /chart/:ticker' }, 404, env);
    } catch (e) {
      return json({ error: 'Upstream Yahoo request failed: ' + e.message }, 502, env);
    }
  },
};
