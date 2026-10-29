// Applies supabase/migrations 0001-0003 (0003 twice, to prove it is re-runnable) to an in-memory Postgres (PGlite)
// with stand-ins for Supabase's auth and storage schemas, then checks the Round 3 guards. Run: pnpm test:db
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { readFileSync } from "fs";
const dir = new URL("../supabase/migrations/", import.meta.url);
const db = new PGlite({ extensions: { vector } });
// stand-ins for the Supabase-managed schemas the migrations reference
await db.exec(`
create schema if not exists extensions;
set search_path = public, extensions; -- as on Supabase
-- pgcrypto is not bundled with this PGlite build; digest() is the only function the migrations use from it
create function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
create role authenticated; create role service_role; create role anon;
create schema auth; create table auth.users (id uuid primary key);
create table auth._uid (id uuid);
create function auth.uid() returns uuid language sql stable as $$ select id from auth._uid limit 1 $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
`);
for (const f of ["0001_init.sql", "0002_hardening.sql", "0003_round3.sql", "0003_round3.sql"]) {
  await db.exec(readFileSync(new URL(f, dir), "utf8").replace(/create extension if not exists pgcrypto[^;]*;/i, ""));
  console.log("applied", f);
}
// exercise 0003: a brand, a profile, a master and translations
const q = (s, p) => db.query(s, p);
const b = (await q(`insert into brands(name) values ('V') returning id`)).rows[0].id;
const b2 = (await q(`insert into brands(name) values ('Other') returning id`)).rows[0].id;
const u = "11111111-1111-1111-1111-111111111111";
await q(`insert into auth.users values ($1)`, [u]);
await q(`insert into profiles(id,name,role,brand_id) values ($1,'p','creator',$2)`, [u, b]);
const m = (await q(`insert into submissions(brand_id,title,channel,lang,author_id) values ($1,'m','website','en',$2) returning id`, [b, u])).rows[0].id;
const t = (await q(`insert into submissions(brand_id,title,channel,lang,author_id,master_id) values ($1,'t','website','ta',$2,$3) returning id`, [b, u, m])).rows[0].id;
console.log("tamil translation ok");
const expectFail = async (label, sql, params) => { try { await q(sql, params); console.log("UNEXPECTED OK:", label); process.exitCode = 1; } catch (e) { console.log("rejected as expected:", label, "->", e.message.slice(0, 90)); } };
await expectFail("translation of a translation", `insert into submissions(brand_id,title,channel,lang,author_id,master_id) values ($1,'x','website','hi',$2,$3)`, [b, u, t]);
await expectFail("master from another brand", `insert into submissions(brand_id,title,channel,lang,author_id,master_id) values ($1,'x','website','hi',$2,$3)`, [b2, u, m]);
await expectFail("unknown language", `insert into submissions(brand_id,title,channel,lang,author_id) values ($1,'x','website','fr',$2)`, [b, u]);
await q(`insert into auth._uid values ($1)`, [u]);
await expectFail("re-link by a signed-in user", `update submissions set master_id = null where id = $1`, [t]);
await q(`insert into live_pages(slug,brand_id,title,body) values ('s',$1,'T','B')`, [b]);
await q(`update live_pages set body='B2' where slug='s'`);
console.log("live_pages ok:", (await q(`select body, updated_at is not null as touched from live_pages`)).rows[0]);
