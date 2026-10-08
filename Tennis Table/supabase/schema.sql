-- Before signing in from TablePro:
-- 1. Create the admin Auth user in Supabase with the existing admin email.
-- 2. Run the following once, after replacing the email if your admin email differs:
--    insert into public.tablepro_admins (user_id)
--    select id from auth.users where email = 'admin@tablepro.com'
--    on conflict do nothing;

create table if not exists public.tablepro_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tablepro_publications (
  id uuid primary key,
  title text not null,
  type text not null check (type in ('simple', 'vip')),
  price integer not null default 0 check (price >= 0),
  published boolean not null default false,
  ever_published boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.tablepro_matches (
  id uuid primary key,
  publication_id uuid not null references public.tablepro_publications (id) on delete cascade,
  competition text not null,
  player1 text not null,
  player2 text not null,
  match_date text not null,
  match_time text not null,
  market text not null default 'Vainqueur du match',
  status text not null default 'à venir' check (status in ('à venir', 'gagné', 'perdu'))
);

create table if not exists public.tablepro_match_picks (
  match_id uuid primary key references public.tablepro_matches (id) on delete cascade,
  prediction text not null,
  odds text not null,
  confidence integer not null check (confidence between 1 and 100)
);

alter table public.tablepro_admins enable row level security;
alter table public.tablepro_publications enable row level security;
alter table public.tablepro_matches enable row level security;
alter table public.tablepro_match_picks enable row level security;

create or replace function public.tablepro_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tablepro_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.tablepro_is_admin() from public;
grant execute on function public.tablepro_is_admin() to anon, authenticated;

drop policy if exists "Anyone can read published TablePro publications" on public.tablepro_publications;
create policy "Anyone can read published TablePro publications"
  on public.tablepro_publications for select to anon, authenticated
  using ((published and not archived) or public.tablepro_is_admin());

drop policy if exists "Admins can create TablePro publications" on public.tablepro_publications;
create policy "Admins can create TablePro publications"
  on public.tablepro_publications for insert to authenticated
  with check (public.tablepro_is_admin());

drop policy if exists "Admins can update TablePro publications" on public.tablepro_publications;
create policy "Admins can update TablePro publications"
  on public.tablepro_publications for update to authenticated
  using (public.tablepro_is_admin())
  with check (public.tablepro_is_admin());

drop policy if exists "Admins can delete TablePro publications" on public.tablepro_publications;
create policy "Admins can delete TablePro publications"
  on public.tablepro_publications for delete to authenticated
  using (public.tablepro_is_admin());

drop policy if exists "Anyone can read matches in visible publications" on public.tablepro_matches;
create policy "Anyone can read matches in visible publications"
  on public.tablepro_matches for select to anon, authenticated
  using (
    public.tablepro_is_admin()
    or exists (
      select 1
      from public.tablepro_publications
      where tablepro_publications.id = tablepro_matches.publication_id
        and tablepro_publications.published
        and not tablepro_publications.archived
    )
  );

drop policy if exists "Admins can create TablePro matches" on public.tablepro_matches;
create policy "Admins can create TablePro matches"
  on public.tablepro_matches for insert to authenticated
  with check (public.tablepro_is_admin());

drop policy if exists "Admins can update TablePro matches" on public.tablepro_matches;
create policy "Admins can update TablePro matches"
  on public.tablepro_matches for update to authenticated
  using (public.tablepro_is_admin())
  with check (public.tablepro_is_admin());

drop policy if exists "Admins can delete TablePro matches" on public.tablepro_matches;
create policy "Admins can delete TablePro matches"
  on public.tablepro_matches for delete to authenticated
  using (public.tablepro_is_admin());

drop policy if exists "Admins and public simple matches can read picks" on public.tablepro_match_picks;
create policy "Admins and public simple matches can read picks"
  on public.tablepro_match_picks for select to anon, authenticated
  using (
    public.tablepro_is_admin()
    or exists (
      select 1
      from public.tablepro_matches
      join public.tablepro_publications
        on tablepro_publications.id = tablepro_matches.publication_id
      where tablepro_matches.id = tablepro_match_picks.match_id
        and tablepro_publications.type = 'simple'
        and tablepro_publications.published
        and not tablepro_publications.archived
    )
  );

drop policy if exists "Admins can create TablePro picks" on public.tablepro_match_picks;
create policy "Admins can create TablePro picks"
  on public.tablepro_match_picks for insert to authenticated
  with check (public.tablepro_is_admin());

drop policy if exists "Admins can update TablePro picks" on public.tablepro_match_picks;
create policy "Admins can update TablePro picks"
  on public.tablepro_match_picks for update to authenticated
  using (public.tablepro_is_admin())
  with check (public.tablepro_is_admin());

drop policy if exists "Admins can delete TablePro picks" on public.tablepro_match_picks;
create policy "Admins can delete TablePro picks"
  on public.tablepro_match_picks for delete to authenticated
  using (public.tablepro_is_admin());

grant select on public.tablepro_publications, public.tablepro_matches, public.tablepro_match_picks to anon, authenticated;
grant insert, update, delete on public.tablepro_publications, public.tablepro_matches, public.tablepro_match_picks to authenticated;

create or replace function public.tablepro_admin_publish_publication(
  p_publication jsonb,
  p_matches jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_id uuid;
  match_data jsonb;
  publication_type text;
  match_count integer;
begin
  if not public.tablepro_is_admin() then
    raise exception 'Administrator access required';
  end if;

  publication_id := (p_publication ->> 'id')::uuid;
  publication_type := p_publication ->> 'type';
  match_count := jsonb_array_length(p_matches);

  if publication_type not in ('simple', 'vip') then
    raise exception 'Invalid publication type';
  end if;
  if publication_type = 'simple' and match_count <> 2 then
    raise exception 'Simple publications must contain exactly two matches';
  end if;
  if publication_type = 'vip' and match_count < 5 then
    raise exception 'VIP publications must contain at least five matches';
  end if;

  insert into public.tablepro_publications (id, title, type, price, published, ever_published, archived, created_at)
  values (
    publication_id,
    p_publication ->> 'title',
    publication_type,
    case when publication_type = 'vip' then (p_publication ->> 'price')::integer else 0 end,
    true,
    true,
    false,
    coalesce((p_publication ->> 'created_at')::timestamptz, now())
  );

  for match_data in select value from jsonb_array_elements(p_matches)
  loop
    insert into public.tablepro_matches (
      id, publication_id, competition, player1, player2, match_date, match_time, market, status
    )
    values (
      (match_data ->> 'id')::uuid,
      publication_id,
      match_data ->> 'competition',
      match_data ->> 'player1',
      match_data ->> 'player2',
      match_data ->> 'date',
      match_data ->> 'time',
      coalesce(match_data ->> 'market', 'Vainqueur du match'),
      'à venir'
    );

    insert into public.tablepro_match_picks (match_id, prediction, odds, confidence)
    values (
      (match_data ->> 'id')::uuid,
      match_data ->> 'prediction',
      match_data ->> 'odds',
      (match_data ->> 'confidence')::integer
    );
  end loop;

  return publication_id;
end;
$$;

revoke all on function public.tablepro_admin_publish_publication(jsonb, jsonb) from public;
grant execute on function public.tablepro_admin_publish_publication(jsonb, jsonb) to authenticated;
