-- BDCap portal: roles, invites, change-request workflow, audit log.
-- Run once in Supabase: Dashboard -> SQL Editor -> paste -> Run. Safe to re-run.
-- Only the backend (service key) touches these tables; RLS is on with no policies,
-- so the publishable (browser) key can read and write nothing here.

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique,
  role           text not null default 'client' check (role in ('admin', 'client')),
  ghl_contact_id text,
  created_at     timestamptz not null default now()
);

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

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  client_id  uuid references public.profiles(id) on delete set null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_client_idx on public.audit_log (client_id, created_at desc);

alter table public.profiles        enable row level security;
alter table public.invites         enable row level security;
alter table public.change_requests enable row level security;
alter table public.audit_log       enable row level security;
 