-- Spread Stack — Supabase schema
-- Run this once in the Supabase SQL Editor for a fresh project.
-- Safe to re-run (uses "if not exists" / "or replace" throughout).

-- ---------- profiles: one row per user, holds their Alpha Vantage key ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  alpha_vantage_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: owner read" on public.profiles;
create policy "profiles: owner read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles: owner insert" on public.profiles;
create policy "profiles: owner insert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles: owner update" on public.profiles;
create policy "profiles: owner update" on public.profiles
  for update using (auth.uid() = id);

-- ---------- trades: one row per saved trade, the whole trade (with its positions) as JSON ----------
create table if not exists public.trades (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists trades_user_id_idx on public.trades(user_id);

alter table public.trades enable row level security;

drop policy if exists "trades: owner read" on public.trades;
create policy "trades: owner read" on public.trades
  for select using (auth.uid() = user_id);

drop policy if exists "trades: owner insert" on public.trades;
create policy "trades: owner insert" on public.trades
  for insert with check (auth.uid() = user_id);

drop policy if exists "trades: owner update" on public.trades;
create policy "trades: owner update" on public.trades
  for update using (auth.uid() = user_id);

drop policy if exists "trades: owner delete" on public.trades;
create policy "trades: owner delete" on public.trades
  for delete using (auth.uid() = user_id);

-- ---------- auto-maintain updated_at ----------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trades_set_updated_at on public.trades;
create trigger trades_set_updated_at
  before update on public.trades
  for each row execute function public.set_updated_at();

-- ---------- auto-create a profile row when someone signs up ----------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
