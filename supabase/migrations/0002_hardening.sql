-- 0002: enforce the review workflow in the database too, so it holds for anyone calling PostgREST directly with the
-- public anon key and a signed-in session, not only for the app's server code. Safe to run more than once.
-- The service role (seed script, server-side audit writes) has no auth.uid() and is not restricted here.

-- 1. Submission status follows the workflow, and ownership columns never change.
create or replace function public.guard_submission_status() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  r text := coalesce(public.app_role(), '');
  reviewer boolean := r in ('reviewer', 'owner');
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.author_id is distinct from old.author_id or new.brand_id is distinct from old.brand_id then
    raise exception 'A submission cannot change author or brand' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not (
      -- author sends for review (first time or after changes were requested)
      (old.status in ('draft', 'changes_requested') and new.status = 'in_review')
      -- a reviewer decides
      or (old.status = 'in_review' and new.status in ('approved', 'changes_requested') and reviewer)
      or (old.status = 'approved' and new.status = 'changes_requested' and reviewer)
      -- recording the live URL publishes an approved piece
      or (old.status = 'approved' and new.status = 'published')
      -- recall
      or (old.status in ('approved', 'published') and new.status = 'recalled' and reviewer)
      -- saving a new version sends reviewed content back to draft
      or (old.status in ('in_review', 'approved', 'published') and new.status = 'draft')
    ) then
      raise exception 'Status cannot move from % to % for role %', old.status, new.status, r using errcode = '42501';
    end if;
    if new.status = 'approved' and old.author_id = auth.uid() then
      raise exception 'You cannot approve your own draft' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists submissions_guard_status on public.submissions;
create trigger submissions_guard_status before update on public.submissions
  for each row execute function public.guard_submission_status();

-- 2. A saved version's content is immutable; only its check results (findings, summary) may be updated.
create or replace function public.guard_version_content() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is not null and (
    new.body is distinct from old.body
    or new.content_hash is distinct from old.content_hash
    or new.image_path is distinct from old.image_path
    or new.image_alt is distinct from old.image_alt
    or new.n is distinct from old.n
    or new.submission_id is distinct from old.submission_id
  ) then
    raise exception 'Saved versions cannot be edited; save a new version instead' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists versions_guard_content on public.versions;
create trigger versions_guard_content before update on public.versions
  for each row execute function public.guard_version_content();

-- 3. Uploads: images only, 8 MB at most (matches the app's upload route).
update storage.buckets
set file_size_limit = 8 * 1024 * 1024,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'assets';
