# Trades API

Stores every signed-in user's trades in Cloudflare D1 (serverless SQLite).
Identity comes entirely from Supabase — this Worker never sees a password,
only a Supabase-issued access token, which it verifies itself against
Supabase's public key set (no shared secret ever touches this Worker).

Signed-out users are unaffected: the app still works fully offline via
local storage, exactly as before. This is an optional sync layer on top.

## One-time setup

### 1. Supabase project (identity only — no tables needed here)

1. Create a free project at [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers → Google** → toggle on. You'll need
   a Google OAuth Client ID + Secret:
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create Credentials → OAuth client ID** → type **Web application**.
   - Under **Authorized redirect URIs**, add the callback URL Supabase shows
     on its Google provider settings page (looks like
     `https://<project-ref>.supabase.co/auth/v1/callback`).
   - Copy the generated **Client ID** and **Client Secret** into Supabase's
     Google provider settings, then **Save**.
3. **Authentication → URL Configuration** → set **Site URL** to
   `https://vivekbhandari.github.io/Option-buddy2.0/` and add it under
   **Redirect URLs** too.
4. **Settings → API** → copy the **Project URL** and the **anon / public
   key** — send both to me, same as before, they're safe to embed in
   client code.

### 2. Cloudflare D1 database

1. Cloudflare dashboard → **Workers & Pages → D1** → **Create database** →
   name it `spread-stack-db`.
2. Copy the **Database ID** shown after creation and send it to me — I'll
   fill it into `wrangler.toml` and run `schema.sql` against it.

No new Cloudflare secrets needed — this reuses the `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` repository secrets already set up for the
Yahoo proxy.

### 3. Deploy

Once `wrangler.toml` has real values, push (or re-run the
[`deploy-trades-api.yml`](../.github/workflows/deploy-trades-api.yml)
workflow) — it deploys automatically, same pattern as the Yahoo proxy.
