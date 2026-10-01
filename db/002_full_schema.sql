-- =============================================================================
-- BDCap Client Portal — full schema (run once in Supabase SQL Editor).
-- Safe to re-run: every statement is idempotent.
--
-- Includes:
--   * profiles, invites, change_requests, audit_log   (from 001_init.sql)
--   * signup_requests                                  (public "request access" flow)
--   * client_details                                   (cached portal payload + Site Config)
--
-- HOW TO USE:
--   1. Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--   2. Then create the admin login from your terminal (bcrypt via the Supabase
--      Admin API, which is the only path GoTrue reliably accepts):
--
--        cd portal-backend
--        node scripts/seed-admin.js admin@yourdomain.com 'YourStrongPass!2026'
--
--      Re-run that command any time to reset the password. The admin signs in
--      at /admin/login in the SPA.
-- =============================================================================

-- ---------- EDIT ME ---------------------------------------------------------
-- Admin seed credentials. Change both values before running in production.
-- The password is hashed by pgcrypto below; the plain value never persists.
--   admin email:     admin@bdcap.local
--   admin password:  ChangeMe!2026
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. profiles
-- =============================================================================
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique,
  full_name      text,
  role           text not null default 'client' check (role in ('admin', 'client')),
  ghl_contact_id text,
  created_at     timestamptz not null default now()
);
-- Add full_name if the table already existed from 001_init.sql.
alter table public.profiles add column if not exists full_name text;

-- =============================================================================
-- 2. invites  (admin-issued invitations)
-- =============================================================================
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  invited_by  uuid references public.profiles(id) on delete set null,
  status      text not null default 'sent' check (status in ('sent', 'accepted', 'revoked')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists invites_one_open_per_email
  on public.invites (lower(email)) where status = 'sent';
create index if not exists invites_email_idx on public.invites (lower(email));

-- =============================================================================
-- 3. signup_requests  (public "request access" submissions, admin approves)
-- =============================================================================
create table if not exists public.signup_requests (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  full_name   text,
  company     text,
  phone       text,
  message     text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note  text,
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists signup_requests_one_open_per_email
  on public.signup_requests (lower(email)) where status = 'pending';
create index if not exists signup_requests_status_idx
  on public.signup_requests (status, created_at desc);

-- =============================================================================
-- 4. change_requests  (client-submitted edits after lock, admin approves)
-- =============================================================================
create table if not exists public.change_requests (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.profiles(id) on delete cascade,
  ghl_contact_id text,
  part           text not null check (part in ('website', 'team', 'you', 'business')),
  text           text not null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note     text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references public.profiles(id) on delete set null
);
create index if not exists change_requests_status_idx on public.change_requests (status, created_at desc);
create index if not exists change_requests_client_idx on public.change_requests (client_id, created_at desc);

-- =============================================================================
-- 5. client_details  (cached portal payload: Info fields + Site Config)
--    One row per client. Backend upserts on every /api/portal/save.
--    Admin can read/edit this without hitting GHL.
-- =============================================================================
create table if not exists public.client_details (
  client_id        uuid primary key references public.profiles(id) on delete cascade,
  fields           jsonb not null default '{}'::jsonb,   -- Information fields (flat keys)
  site_config      jsonb not null default '{}'::jsonb,   -- `sel` object: template/palette/fonts/theme/hero
  locked_at        timestamptz,                           -- Locked On
  changes_allowed_until timestamptz,
  portal_completed_at   timestamptz,
  site_preview_url text,
  site_deployed_at timestamptz,
  site_url         text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id) on delete set null
);
create index if not exists client_details_locked_idx on public.client_details (locked_at);

-- auto-bump updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists client_details_touch on public.client_details;
create trigger client_details_touch
  before update on public.client_details
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- 6. audit_log  (every mutating admin/client action)
-- =============================================================================
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  client_id  uuid references public.profiles(id) on delete set null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_client_idx on public.audit_log (client_id, created_at desc);
create index if not exists audit_log_actor_idx  on public.audit_log (actor_id, created_at desc);

-- =============================================================================
-- 7. Row-level security — ON with no policies, so only the service-role key
--    (used by the backend) can read/write. Browser (anon) key sees nothing.
-- =============================================================================
alter table public.profiles        enable row level security;
alter table public.invites         enable row level security;
alter table public.signup_requests enable row level security;
alter table public.change_requests enable row level security;
alter table public.client_details  enable row level security;
alter table public.audit_log       enable row level security;

-- =============================================================================
-- Done.  Next step: create the admin login from your terminal (see header):
--   cd portal-backend
--   node scripts/seed-admin.js admin@yourdomain.com 'YourStrongPass!2026'
--
-- Verify afterwards with:
--   select id, email, role from public.profiles where role = 'admin';
-- =============================================================================
