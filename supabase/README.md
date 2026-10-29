# Supabase setup for Readback

1. **Create a project** at https://supabase.com/dashboard (any region, free tier is fine). Save the database password.
2. **Run the migration.** Open *SQL Editor* > *New query*, paste the full contents of `supabase/migrations/0001_init.sql`, and click *Run*. It is safe to run again. It enables `vector` and `pgcrypto`, creates all tables, RLS policies, the audit hash chain, the `match_facts` function and the private `assets` storage bucket. Then run `supabase/migrations/0002_hardening.sql` the same way: it enforces the review workflow in the database (allowed status changes, no self-approval, immutable versions, image-only uploads). Then run `supabase/migrations/0003_round3.sql`: it adds translations linked to an English master (`submissions.master_id`, guarded by a trigger), Tamil and Marathi as languages, and the `live_pages` table for the demo storefront used by Live Fact Recall. All three files are safe to run again.
3. **Copy the keys.** In *Project Settings > API* copy the Project URL, the `anon` key and the `service_role` key. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only, never expose it)
   - `DEMO_PASSWORD` (any password of 6+ characters; shared by the four demo users)
   - `GOOGLE_GENERATIVE_AI_API_KEY` (optional but recommended: fact embeddings are skipped without it, and live checks fall back to mock mode)
4. **Seed the demo data.**
   ```
   pnpm install
   pnpm seed
   ```
   This creates the four demo users (`owner@velura.demo`, `creator@velura.demo`, `reviewer@velura.demo`, `agency@bloomagency.demo`), the Velura brand, clauses, facts, terms, personas, eleven submissions with precomputed findings (including an English master with Hindi and Tamil translations), demo store pages, comments, and audit entries. It is idempotent; re-running resets brand content and submissions to the baseline. If you add `GOOGLE_GENERATIVE_AI_API_KEY` later, re-run `pnpm seed` to embed the facts.
5. **Run the app:** `pnpm dev`, then use the "Enter as ..." buttons on the landing page.

Notes
- In *Authentication > Providers > Email*, you may turn off "Confirm email" for convenience; the seed marks the demo users as confirmed anyway.
- `public/demo/velura-142.png` is committed; regenerate it with `pnpm seed:image`.
- Recall queue is computed from `fact_citations` against the current fact versions and expiry dates, so editing or expiring a fact in the Fact Ledger updates it immediately. Live-page checks and closures are audit-log entries.
- The daily job (`/api/cron/recall`, scheduled in `vercel.json`) marks lapsed facts expired, records expiry alerts, re-checks live pages and resets the seeded demo drafts. Set `CRON_SECRET` to restrict it to Vercel's scheduler and `DEMO_DAILY_RESET=0` to keep visitors' changes.
- The brand owner can also reset the seeded drafts from Brand Space ("Reset demo drafts"); `pnpm seed` does the same from the command line and additionally refreshes the demo users' passwords.
- `audit_log` is insert-only (a trigger blocks UPDATE, DELETE and TRUNCATE). To reset a demo project completely, drop and recreate the schema or the project.
