# Yahoo Finance proxy

Yahoo Finance has no public API. Its fundamentals endpoint requires a
cookie+crumb handshake that can't be done cross-origin from a browser, and
even its simpler quote endpoint sends no CORS headers at all — so the
static site can't call Yahoo directly. This is a small Cloudflare Worker
that does the handshake and the Yahoo request server-to-server, then
returns the JSON with CORS headers attached so the browser can read it.

## Routes

- `GET /quote/:ticker?modules=assetProfile,financialData,defaultKeyStatistics,summaryDetail`
  — fundamentals (Yahoo's `quoteSummary`). `modules` is optional; see
  [Yahoo's known module names](https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=assetProfile)
  for the full list — commonly used ones are `assetProfile` (company info),
  `financialData` (margins, cash flow), `defaultKeyStatistics` (P/E,
  market cap, beta), `summaryDetail` (52-week range, dividend yield).
- `GET /chart/:ticker` — current price / recent history (Yahoo's `chart`).

Both return the raw Yahoo JSON for that ticker (already unwrapped from
Yahoo's `{ result: [ ... ] }` envelope) or `{ "error": "..." }` on failure.

## One-time setup

1. Create a free account at [cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**
   template. Copy the token.
3. Find your **Account ID**: Cloudflare dashboard → Workers & Pages → it's
   shown in the right-hand sidebar.
4. In this GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**, add two secrets:
   - `CLOUDFLARE_API_TOKEN` — the token from step 2
   - `CLOUDFLARE_ACCOUNT_ID` — the ID from step 3
5. Push (or re-run the "Deploy Yahoo proxy" workflow from the Actions tab).
   It deploys to `https://spread-stack-yahoo-proxy.<your-subdomain>.workers.dev`
   — that URL is shown in the workflow's log and in the Cloudflare dashboard.

Neither secret is ever visible to anyone but GitHub Actions — they're
entered directly into GitHub's UI, never committed to the repo.

## Updating

Edit `worker.js` and push — the
[`deploy-yahoo-proxy.yml`](../.github/workflows/deploy-yahoo-proxy.yml)
workflow redeploys automatically on any change under this directory.
