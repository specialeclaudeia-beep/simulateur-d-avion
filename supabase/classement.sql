-- Classement en ligne (projet Supabase « simulateur-classement », région Paris).
-- Déjà appliqué sur le serveur le 2026-11-12. Le garder ici pour pouvoir le recréer.
-- Lecture : tout le monde (vue public.classement, sans le secret).
-- Écriture : seulement par les fonctions envoyer_score / retirer_score, avec le secret du joueur.

create table public.scores (
  player_id uuid not null,
  game_id text not null check (char_length(game_id) <= 64),
  secret_hash text not null,
  pseudo text not null check (char_length(pseudo) between 1 and 18),
  pseudo_color text not null default '#ffb627' check (pseudo_color ~ '^#[0-9a-fA-F]{6}$'),
  airline text not null check (char_length(airline) between 1 and 40),
  airline_code text not null default '' check (char_length(airline_code) <= 3),
  airline_color text not null default '#ffb627' check (airline_color ~ '^#[0-9a-fA-F]{6}$'),
  country text not null default '' check (char_length(country) <= 3),
  mode text not null check (mode in ('libre', 'echelons')),
  competition boolean not null default false,
  company_value bigint not null,
  pax bigint not null default 0 check (pax >= 0),
  flights bigint not null default 0 check (flights >= 0),
  aircraft integer not null default 0 check (aircraft >= 0),
  lines integer not null default 0 check (lines >= 0),
  level integer not null default 0 check (level >= 0 and level <= 1000),
  game_days integer not null default 0 check (game_days >= 0),
  play_minutes integer not null default 0 check (play_minutes >= 0),
  updated_at timestamptz not null default now(),
  primary key (player_id, game_id)
);

alter table public.scores enable row level security;
create policy "classement lisible par tous" on public.scores for select to anon, authenticated using (true);

revoke all on public.scores from anon, authenticated;
grant select (player_id, game_id, pseudo, pseudo_color, airline, airline_code, airline_color, country, mode, competition,
  company_value, pax, flights, aircraft, lines, level, game_days, play_minutes, updated_at)
  on public.scores to anon, authenticated;

create index scores_value_idx on public.scores (company_value desc);

-- Meilleure compagnie de chaque joueur.
create view public.classement with (security_invoker = true) as
  select distinct on (player_id)
    player_id, game_id, pseudo, pseudo_color, airline, airline_code, airline_color, country, mode, competition,
    company_value, pax, flights, aircraft, lines, level, game_days, play_minutes, updated_at
  from public.scores
  order by player_id, company_value desc;
grant select on public.classement to anon, authenticated;

-- Envoi d'un score : seul l'appareil qui connaît le secret du joueur peut modifier ses lignes.
create function public.envoyer_score(
  p_player uuid, p_secret text, p_game text, p_pseudo text, p_pseudo_color text,
  p_airline text, p_airline_code text, p_airline_color text, p_country text,
  p_mode text, p_competition boolean, p_value bigint, p_pax bigint, p_flights bigint,
  p_aircraft integer, p_lines integer, p_level integer, p_game_days integer, p_play_minutes integer
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  h text;
  known text;
  last timestamptz;
begin
  if p_secret is null or char_length(p_secret) < 20 or char_length(p_secret) > 100 then
    raise exception 'secret invalide';
  end if;
  h := encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  select s.secret_hash, max(s.updated_at) into known, last
    from public.scores s where s.player_id = p_player group by s.secret_hash limit 1;
  if known is not null and known <> h then
    raise exception 'joueur inconnu';
  end if;
  if last is not null and last > now() - interval '20 seconds' then
    return 'trop tôt';
  end if;
  if (select count(*) from public.scores s where s.player_id = p_player and s.game_id <> p_game) >= 20 then
    delete from public.scores s where s.ctid in (
      select ctid from public.scores where player_id = p_player order by updated_at asc limit 1);
  end if;
  insert into public.scores as s (player_id, game_id, secret_hash, pseudo, pseudo_color, airline, airline_code, airline_color,
    country, mode, competition, company_value, pax, flights, aircraft, lines, level, game_days, play_minutes, updated_at)
  values (p_player, p_game, h, left(btrim(p_pseudo), 18), p_pseudo_color, left(btrim(p_airline), 40), left(p_airline_code, 3),
    p_airline_color, left(p_country, 3), p_mode, p_competition, p_value, p_pax, p_flights, p_aircraft, p_lines, p_level,
    p_game_days, p_play_minutes, now())
  on conflict (player_id, game_id) do update set
    pseudo = excluded.pseudo, pseudo_color = excluded.pseudo_color, airline = excluded.airline,
    airline_code = excluded.airline_code, airline_color = excluded.airline_color, country = excluded.country,
    mode = excluded.mode, competition = excluded.competition, company_value = excluded.company_value,
    pax = excluded.pax, flights = excluded.flights, aircraft = excluded.aircraft, lines = excluded.lines,
    level = excluded.level, game_days = excluded.game_days, play_minutes = excluded.play_minutes, updated_at = now();
  -- Le pseudo suit sur toutes les compagnies du joueur.
  update public.scores s set pseudo = left(btrim(p_pseudo), 18), pseudo_color = p_pseudo_color
    where s.player_id = p_player and s.game_id <> p_game;
  return 'ok';
end $$;

-- Quitter le classement : efface toutes les lignes du joueur.
create function public.retirer_score(p_player uuid, p_secret text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.scores s
    where s.player_id = p_player and s.secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  return 'ok';
end $$;

revoke all on function public.envoyer_score from public;
revoke all on function public.retirer_score from public;
grant execute on function public.envoyer_score to anon, authenticated;
grant execute on function public.retirer_score to anon, authenticated;
