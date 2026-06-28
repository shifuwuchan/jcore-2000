-- ════════════════════════════════════════════════════════════════
-- J-Core 2000 — Schéma Supabase (v2)
-- À copier-coller dans Project → SQL Editor → New query → Run.
--
-- Ce script est IDEMPOTENT : tu peux le rejouer sans risque, que tu
-- partes de zéro ou que tu aies déjà exécuté une version précédente
-- (v1). Il met juste à jour ce qui doit changer.
--
-- Voir SETUP.md pour les instructions pas à pas.
-- ════════════════════════════════════════════════════════════════

-- 1) PROFILS PUBLICS ────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profils lisibles par tous (classement public)" on public.profiles;
create policy "Profils lisibles par tous (classement public)"
  on public.profiles for select
  using (true);

drop policy if exists "Chacun crée uniquement son propre profil" on public.profiles;
create policy "Chacun crée uniquement son propre profil"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Chacun modifie uniquement son propre profil" on public.profiles;
create policy "Chacun modifie uniquement son propre profil"
  on public.profiles for update
  using (auth.uid() = id);


-- 2) PROGRESSION (sync cross-device) ────────────────────────────
-- day_streak / last_active : jours consécutifs d'activité, pour le
-- classement "Streak" et la cohérence cross-device de la série.
create table if not exists public.progress (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  perm_total     int  not null default 0,
  rebirths       int  not null default 0,
  lifetime_total int  not null default 0,
  hs             jsonb not null default '{}'::jsonb,
  srs_data       jsonb not null default '{}'::jsonb,
  day_streak     int  not null default 0,
  last_active    date,
  last_freeze_used date,
  updated_at     timestamptz not null default now()
);

-- Ajout rétro-compatible si la table existait déjà sans ces colonnes (v1/v2 → v3)
alter table public.progress add column if not exists day_streak int not null default 0;
alter table public.progress add column if not exists last_active date;
alter table public.progress add column if not exists last_freeze_used date;

alter table public.progress enable row level security;

drop policy if exists "Chacun lit uniquement sa propre progression" on public.progress;
create policy "Chacun lit uniquement sa propre progression"
  on public.progress for select
  using (auth.uid() = user_id);

drop policy if exists "Chacun insère uniquement sa propre progression" on public.progress;
create policy "Chacun insère uniquement sa propre progression"
  on public.progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "Chacun met à jour uniquement sa propre progression" on public.progress;
create policy "Chacun met à jour uniquement sa propre progression"
  on public.progress for update
  using (auth.uid() = user_id);


-- 3) JOURNAL DES POINTS (classements quotidien / hebdo) ─────────
create table if not exists public.points_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  points     int  not null check (points > 0),
  created_at timestamptz not null default now()
);

alter table public.points_log enable row level security;

drop policy if exists "Chacun insère uniquement ses propres points" on public.points_log;
create policy "Chacun insère uniquement ses propres points"
  on public.points_log for insert
  with check (auth.uid() = user_id);

drop policy if exists "Chacun lit uniquement ses propres logs" on public.points_log;
create policy "Chacun lit uniquement ses propres logs"
  on public.points_log for select
  using (auth.uid() = user_id);

create index if not exists points_log_user_created_idx
  on public.points_log (user_id, created_at);


-- 4) CLASSEMENT QUOTIDIEN / HEBDOMADAIRE ─────────────────────────
-- "security definer" : tourne avec des droits élevés pour agréger
-- les points de TOUS les joueurs (points_log n'est lisible que par
-- son propriétaire en direct). On expose aussi rebirths, utilisé
-- côté client pour les effets visuels de pseudo dans le classement.
create or replace function public.get_leaderboard(p_period text)
returns table (username text, total_points bigint, rebirths int)
language sql
security definer
set search_path = public
as $$
  select pr.username,
         sum(pl.points)::bigint as total_points,
         coalesce(pg.rebirths, 0) as rebirths
  from public.points_log pl
  join public.profiles pr on pr.id = pl.user_id
  left join public.progress pg on pg.user_id = pl.user_id
  where
    case p_period
      when 'day'  then pl.created_at >= date_trunc('day', now())
      when 'week' then pl.created_at >= date_trunc('week', now())
      else true
    end
  group by pr.username, pg.rebirths
  order by total_points desc
  limit 50;
$$;

grant execute on function public.get_leaderboard(text) to anon, authenticated;


-- 5) CLASSEMENT GÉNÉRAL (total à vie, jamais remis à zéro) ───────
create or replace function public.get_overall_leaderboard()
returns table (username text, total_points bigint, rebirths int)
language sql
security definer
set search_path = public
as $$
  select pr.username, pg.lifetime_total::bigint as total_points, pg.rebirths
  from public.progress pg
  join public.profiles pr on pr.id = pg.user_id
  order by total_points desc
  limit 50;
$$;

grant execute on function public.get_overall_leaderboard() to anon, authenticated;


-- 6) CLASSEMENT STREAK (jours consécutifs) ───────────────────────
create or replace function public.get_streak_leaderboard()
returns table (username text, day_streak int, rebirths int)
language sql
security definer
set search_path = public
as $$
  select pr.username, pg.day_streak, pg.rebirths
  from public.progress pg
  join public.profiles pr on pr.id = pg.user_id
  where pg.day_streak > 0
  order by pg.day_streak desc
  limit 50;
$$;

grant execute on function public.get_streak_leaderboard() to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- Fin du schéma v2.
-- ════════════════════════════════════════════════════════════════
