-- Readback: initial schema, RLS, audit hash chain, storage.
-- Target: Postgres 15 (Supabase). Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- tables

create table if not exists public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  voice_traits text[] not null default '{}',
  palette     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  name      text not null,
  role      text not null check (role in ('owner','creator','reviewer','agency')),
  org       text not null default '',
  brand_id  uuid references public.brands(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.clauses (
  id        uuid primary key default gen_random_uuid(),
  brand_id  uuid not null references public.brands(id) on delete cascade,
  code      text not null,
  title     text not null,
  body      text not null default '',
  kind      text not null default 'ai' check (kind in ('rule','ai')),
  confirmed boolean not null default true,
  unique (brand_id, code)
);

create table if not exists public.facts (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  code       text not null,
  statement  text not null,
  source     text not null default '',
  owner      text not null default '',
  expires_on date,
  version    int not null default 1,
  status     text not null default 'active' check (status in ('active','expired','retired')),
  embedding  vector(768),
  updated_at timestamptz not null default now(),
  unique (brand_id, code)
);

create table if not exists public.terms (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  kind        text not null check (kind in ('banned','preferred','disclaimer','embargo')),
  phrase      text not null,
  replacement text,
  clause_code text,
  triggers    text[],
  unique (brand_id, kind, phrase)
);

create table if not exists public.personas (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  name        text not null,
  description text not null default '',
  lang        text not null default 'en' check (lang in ('en','hi','hinglish')),
  builtin     boolean not null default false,
  unique (brand_id, name)
);

create sequence if not exists public.submission_number_seq start 150;

create table if not exists public.submissions (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brands(id) on delete cascade,
  number         int not null unique default nextval('public.submission_number_seq'),
  title          text not null,
  channel        text not null check (channel in ('instagram','website','amazon','nykaa','whatsapp','email','other')),
  lang           text not null default 'en' check (lang in ('en','hi','hinglish')),
  intent         text not null default '',
  status         text not null default 'draft'
                 check (status in ('draft','in_review','changes_requested','approved','published','recalled')),
  author_id      uuid not null references public.profiles(id),
  locked_phrases text[] not null default '{}',
  published_url  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists submissions_author_idx on public.submissions(author_id);
create index if not exists submissions_status_idx on public.submissions(status);

create table if not exists public.versions (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  n             int not null,
  body          text not null,
  image_path    text,
  image_alt     text,
  content_hash  text not null default '',
  findings      jsonb not null default '[]'::jsonb,
  summary       jsonb,
  created_at    timestamptz not null default now(),
  unique (submission_id, n)
);

create table if not exists public.comments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  version_n     int not null default 1,
  author_id     uuid not null references public.profiles(id),
  body          text not null,
  anchor        jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists comments_submission_idx on public.comments(submission_id);

create table if not exists public.fact_citations (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  fact_code     text not null,
  fact_version  int not null,
  unique (submission_id, fact_code)
);
create index if not exists fact_citations_code_idx on public.fact_citations(fact_code);

-- Recall queue is computed (see listRecallQueue): approved/published submissions whose
-- fact_citations point at a fact that is now expired/retired or has a newer version.

create sequence if not exists public.audit_log_id_seq;

create table if not exists public.audit_log (
  id            bigint primary key,
  submission_id uuid,                       -- deliberately no FK: audit outlives submissions
  actor_id      uuid,
  actor_name    text not null,
  actor_role    text not null,
  action        text not null,
  detail        jsonb not null default '{}'::jsonb,
  version_hash  text,
  fact_versions jsonb,
  prev_hash     text not null default '',
  hash          text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists audit_log_submission_idx on public.audit_log(submission_id);

-- ---------------------------------------------------------------- indexes

create index if not exists facts_embedding_idx
  on public.facts using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------- helpers

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public, extensions as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Spec name. CURRENT_ROLE is an SQL keyword, so it must be quoted; call as public."current_role"().
create or replace function public."current_role"() returns text
language sql stable security definer set search_path = public, extensions as $$
  select public.app_role()
$$;

create or replace function public.app_brand() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select brand_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(public.app_role() in ('owner','creator','reviewer'), false)
$$;

grant execute on function public.app_role(), public."current_role"(), public.app_brand(), public.is_staff()
  to authenticated, service_role;

-- ---------------------------------------------------------------- triggers

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists submissions_touch on public.submissions;
create trigger submissions_touch before update on public.submissions
  for each row execute function public.touch_updated_at();

-- Only reviewer/owner may move a submission to approved or recalled.
-- auth.uid() is null for the service role, which is allowed through (seed, audit tooling).
create or replace function public.guard_submission_status() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null
     and new.status is distinct from old.status
     and new.status in ('approved','recalled')
     and coalesce(public.app_role(), '') not in ('reviewer','owner') then
    raise exception 'Only a reviewer or owner can set status %', new.status using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists submissions_guard_status on public.submissions;
create trigger submissions_guard_status before update on public.submissions
  for each row execute function public.guard_submission_status();

-- Audit: canonical hash of a row (stable across sessions: epoch seconds, jsonb text).
create or replace function public.audit_compute_hash(a public.audit_log) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(
    digest(
      a.prev_hash || jsonb_build_array(
        a.id, a.submission_id, a.actor_id, a.actor_name, a.actor_role, a.action,
        a.detail, a.version_hash, a.fact_versions,
        extract(epoch from a.created_at)::text
      )::text,
      'sha256'),
    'hex')
$$;

create or replace function public.audit_chain_before_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  last_hash text;
begin
  perform pg_advisory_xact_lock(727301);   -- serialise chain writers
  new.id := nextval('public.audit_log_id_seq');
  select hash into last_hash from public.audit_log order by id desc limit 1;
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.created_at := coalesce(new.created_at, now());
  new.hash := public.audit_compute_hash(new);
  return new;
end $$;

drop trigger if exists audit_chain on public.audit_log;
create trigger audit_chain before insert on public.audit_log
  for each row execute function public.audit_chain_before_insert();

create or replace function public.audit_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is insert-only' using errcode = '42501';
end $$;

drop trigger if exists audit_no_update_delete on public.audit_log;
create trigger audit_no_update_delete before update or delete on public.audit_log
  for each row execute function public.audit_block_mutation();

drop trigger if exists audit_no_truncate on public.audit_log;
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_block_mutation();

-- Walk the chain; returns ok=false and the first broken id if tampered.
create or replace function public.verify_audit_chain()
returns table (ok boolean, broken_at bigint)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r public.audit_log;
  expected_prev text := repeat('0', 64);
begin
  for r in select * from public.audit_log order by id loop
    if r.prev_hash is distinct from expected_prev
       or r.hash is distinct from public.audit_compute_hash(r) then
      return query select false, r.id;
      return;
    end if;
    expected_prev := r.hash;
  end loop;
  return query select true, null::bigint;
end $$;

grant execute on function public.verify_audit_chain() to authenticated, service_role;

-- ---------------------------------------------------------------- vector search

create or replace function public.match_facts(query vector(768), k int default 3, brand uuid default null)
returns table (
  id uuid, code text, statement text, source text, owner text,
  expires_on date, version int, status text, similarity float
)
language sql stable set search_path = public, extensions as $$
  select f.id, f.code, f.statement, f.source, f.owner, f.expires_on, f.version, f.status,
         1 - (f.embedding <=> query) as similarity
  from public.facts f
  where f.embedding is not null
    and f.status <> 'retired'
    and f.brand_id = coalesce(brand, public.app_brand())
  order by f.embedding <=> query
  limit greatest(k, 1)
$$;

grant execute on function public.match_facts(vector, int, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- RLS

alter table public.brands         enable row level security;
alter table public.profiles       enable row level security;
alter table public.clauses        enable row level security;
alter table public.facts          enable row level security;
alter table public.terms          enable row level security;
alter table public.personas       enable row level security;
alter table public.submissions    enable row level security;
alter table public.versions       enable row level security;
alter table public.comments       enable row level security;
alter table public.fact_citations enable row level security;
alter table public.audit_log      enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (public.is_staff() and brand_id = public.app_brand()));

-- brands
drop policy if exists brands_select on public.brands;
create policy brands_select on public.brands for select to authenticated
  using (id = public.app_brand());
drop policy if exists brands_update on public.brands;
create policy brands_update on public.brands for update to authenticated
  using (id = public.app_brand() and public.app_role() = 'owner')
  with check (id = public.app_brand() and public.app_role() = 'owner');

-- Brand Space tables: everyone in the brand reads (agency read-only), only owner writes.
do $$
declare t text;
begin
  foreach t in array array['clauses','facts','terms','personas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (brand_id = public.app_brand())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (brand_id = public.app_brand() and public.app_role() = ''owner'') with check (brand_id = public.app_brand() and public.app_role() = ''owner'')', t || '_write', t);
  end loop;
end $$;

-- submissions
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (brand_id = public.app_brand() and (public.is_staff() or author_id = auth.uid()));
drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions for insert to authenticated
  with check (brand_id = public.app_brand() and author_id = auth.uid());
drop policy if exists submissions_update on public.submissions;
create policy submissions_update on public.submissions for update to authenticated
  using (brand_id = public.app_brand() and (public.is_staff() or author_id = auth.uid()))
  with check (brand_id = public.app_brand() and (public.is_staff() or author_id = auth.uid()));

-- child tables inherit visibility from the parent submission (whose own RLS applies)
drop policy if exists versions_select on public.versions;
create policy versions_select on public.versions for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists versions_insert on public.versions;
create policy versions_insert on public.versions for insert to authenticated
  with check (exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists versions_update on public.versions;
create policy versions_update on public.versions for update to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id))
  with check (exists (select 1 from public.submissions s where s.id = submission_id));

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and exists (select 1 from public.submissions s where s.id = submission_id));

drop policy if exists fact_citations_select on public.fact_citations;
create policy fact_citations_select on public.fact_citations for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists fact_citations_insert on public.fact_citations;
create policy fact_citations_insert on public.fact_citations for insert to authenticated
  with check (exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists fact_citations_update on public.fact_citations;
create policy fact_citations_update on public.fact_citations for update to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id))
  with check (exists (select 1 from public.submissions s where s.id = submission_id));
drop policy if exists fact_citations_delete on public.fact_citations;
create policy fact_citations_delete on public.fact_citations for delete to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id));

-- audit_log: readable by staff (all) and agency (own submissions); no client INSERT policy,
-- writes happen through the service role only.
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.submissions s where s.id = audit_log.submission_id)
  );

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('assets', 'assets', false)
on conflict (id) do update set public = false;

-- Path convention: <author uuid>/<file>. Staff read everything; agency only their own folder.
drop policy if exists assets_select on storage.objects;
create policy assets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'assets'
    and (public.is_staff() or (storage.foldername(name))[1] = auth.uid()::text)
  );
drop policy if exists assets_insert on storage.objects;
create policy assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists assets_update on storage.objects;
create policy assets_update on storage.objects for update to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = auth.uid()::text);
