-- 0003 (Round 3): translation variants linked to their English master, Tamil and Marathi, and demo storefront
-- pages for live fact recall. Safe to run more than once. Run after 0001 and 0002.

-- 1. Languages: Tamil and Marathi join English, Hindi and Hinglish.
alter table public.submissions drop constraint if exists submissions_lang_check;
alter table public.submissions add constraint submissions_lang_check
  check (lang in ('en', 'hi', 'hinglish', 'ta', 'mr'));
alter table public.personas drop constraint if exists personas_lang_check;
alter table public.personas add constraint personas_lang_check
  check (lang in ('en', 'hi', 'hinglish', 'ta', 'mr'));

-- 2. A translation (variant) points at its master submission. One level only: a variant cannot have variants.
alter table public.submissions add column if not exists master_id uuid references public.submissions(id) on delete set null;
create index if not exists submissions_master_idx on public.submissions(master_id);

create or replace function public.guard_submission_master() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  m public.submissions;
begin
  if tg_op = 'UPDATE' and new.master_id is distinct from old.master_id and auth.uid() is not null then
    raise exception 'A translation cannot be re-linked to another master' using errcode = '42501';
  end if;
  if new.master_id is null then
    return new;
  end if;
  if new.master_id = new.id then
    raise exception 'A submission cannot be its own master' using errcode = '23514';
  end if;
  select * into m from public.submissions where id = new.master_id;
  if m.id is null or m.brand_id <> new.brand_id then
    raise exception 'The master must be a submission of the same brand' using errcode = '23514';
  end if;
  if m.master_id is not null then
    raise exception 'The master is itself a translation; link to its English master instead' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists submissions_guard_master on public.submissions;
create trigger submissions_guard_master before insert or update on public.submissions
  for each row execute function public.guard_submission_master();

-- 3. Demo storefront pages: stand-ins for the brand's live product pages, so a judge can watch Live Fact Recall
--    find a stale claim on a live page, edit the page, and see the recall close. Public read, brand staff write.
create table if not exists public.live_pages (
  slug       text primary key,
  brand_id   uuid not null references public.brands(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.live_pages enable row level security;

drop policy if exists live_pages_read on public.live_pages;
create policy live_pages_read on public.live_pages for select to anon, authenticated using (true);
drop policy if exists live_pages_write on public.live_pages;
create policy live_pages_write on public.live_pages for update to authenticated
  using (brand_id = public.app_brand() and public.is_staff())
  with check (brand_id = public.app_brand() and public.is_staff());

drop trigger if exists live_pages_touch on public.live_pages;
create trigger live_pages_touch before update on public.live_pages
  for each row execute function public.touch_updated_at();
