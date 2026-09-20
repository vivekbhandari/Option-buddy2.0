-- Spread Stack — trades-api D1 schema
-- Run once against your D1 database:
--   npx wrangler d1 execute spread-stack-db --remote --file=schema.sql
--
-- No row-level security here (D1/SQLite has none) — every query in worker.js
-- filters by the user_id pulled from the verified Supabase JWT, never from a
-- client-supplied value, so that's the actual enforcement boundary.

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
