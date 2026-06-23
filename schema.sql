-- ════════════════════════════════════════════════════════════════
-- J-Core 2000 — Schéma Supabase
-- À copier-coller dans Project → SQL Editor → New query → Run.
-- Voir SETUP.md pour les instructions pas à pas.
-- ════════════════════════════════════════════════════════════════

-- 1) PROFILS PUBLICS ────────────────────────────────────────────
-- Le pseudo affiché dans le classement. Lié 1-pour-1 à auth.users.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profils lisibles par tous (classement public)"
  on public.profiles for select
  using (true);

create policy "Chacun crée uniquement son propre profil"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Chacun modifie uniquement son propre profil"
  on public.profiles for update
  using (auth.uid() = id);


-- 2) PROGRESSION (sync cross-device) ────────────────────────────
-- Une ligne par utilisateur : snapshot complet de la sauvegarde
-- (équivalent du localStorage, mais accessible depuis n'importe
-- quel appareil une fois connecté).
create table if not exists public.progress (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  perm_total     int  not null default 0,
  rebirths       int  not null default 0,
  lifetime_total int  not null default 0,
  hs             jsonb not null default '{}'::jsonb,
  srs_data       jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

alter table public.progress enable row level security;

create policy "Chacun lit uniquement sa propre progression"
  on public.progress for select
  using (auth.uid() = user_id);

create policy "Chacun insère uniquement sa propre progression"
  on public.progress for insert
  with check (auth.uid() = user_id);

create policy "Chacun met à jour uniquement sa propre progression"
  on public.progress for update
  using (auth.uid() = user_id);


-- 3) JOURNAL DES POINTS (classements quotidien / hebdo) ─────────
-- Une ligne par "gain de points" en mode QCM, horodatée. Permet
-- de calculer "qui a le plus marqué aujourd'hui / cette semaine"
-- sans avoir besoin de remettre les compteurs à zéro côté client.
create table if not exists public.points_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  points     int  not null check (points > 0),
  created_at timestamptz not null default now()
);

alter table public.points_log enable row level security;

create policy "Chacun insère uniquement ses propres points"
  on public.points_log for insert
  with check (auth.uid() = user_id);

create policy "Chacun lit uniquement ses propres logs"
  on public.points_log for select
  using (auth.uid() = user_id);

create index if not exists points_log_user_created_idx
  on public.points_log (user_id, created_at);


-- 4) CLASSEMENT QUOTIDIEN / HEBDOMADAIRE ─────────────────────────
-- Fonction "security definer" : elle tourne avec des droits élevés
-- pour pouvoir agréger les points de TOUS les joueurs, alors que
-- points_log n'est lisible que par son propriétaire en direct.
-- C'est la manière standard, sur Supabase, d'exposer un classement
-- public à partir d'une table privée.
create or replace function public.get_leaderboard(p_period text)
returns table (username text, total_points bigint)
language sql
security definer
set search_path = public
as $$
  select pr.username, sum(pl.points)::bigint as total_points
  from public.points_log pl
  join public.profiles pr on pr.id = pl.user_id
  where
    case p_period
      when 'day'  then pl.created_at >= date_trunc('day', now())
      when 'week' then pl.created_at >= date_trunc('week', now())
      else true
    end
  group by pr.username
  order by total_points desc
  limit 50;
$$;

grant execute on function public.get_leaderboard(text) to anon, authenticated;


-- 5) CLASSEMENT GÉNÉRAL (total à vie, jamais remis à zéro) ───────
-- Basé sur progress.lifetime_total plutôt que sur la somme de tout
-- points_log (beaucoup plus rapide, et c'est exactement la valeur
-- déjà maintenue côté client pour ce cas d'usage).
create or replace function public.get_overall_leaderboard()
returns table (username text, total_points bigint)
language sql
security definer
set search_path = public
as $$
  select pr.username, pg.lifetime_total::bigint as total_points
  from public.progress pg
  join public.profiles pr on pr.id = pg.user_id
  order by total_points desc
  limit 50;
$$;

grant execute on function public.get_overall_leaderboard() to anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- Fin du schéma. Étape suivante : voir SETUP.md pour les réglages
-- d'authentification (confirmation email) et le remplissage de
-- config.js avec ton URL + clé anon.
-- ════════════════════════════════════════════════════════════════
