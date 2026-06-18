-- ChainSight Phase 0 Week 1 — initial schema.
--
-- This migration creates the foundational tables with RLS policies for
-- multi-tenancy. Per-case row-level encryption is layered on top via
-- application-layer libsodium (not in SQL). Supabase sees only ciphertext
-- for sensitive columns.
--
-- See: chainsight_v1_0_data_engineering.md §4-5, security_sovereignty.md §2.

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector" with schema extensions;

-- =============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER to avoid recursive RLS)
-- =============================================================================

-- Returns the current user's agency_id from JWT app_metadata.
create or replace function public.current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce(
    auth.jwt() -> 'app_metadata' ->> 'agency_id',
    auth.jwt() ->> 'agency_id'
  ))::uuid;
$$;

-- Returns the current user's role.
create or replace function public.current_role_value()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() ->> 'role',
    'investigator'
  );
$$;

-- =============================================================================
-- AGENCIES (tenant root)
-- =============================================================================
create table public.agencies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  kms_key_ref text,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agencies enable row level security;

create policy "agency members can read their agency"
  on public.agencies for select
  using (id = current_agency_id());

-- =============================================================================
-- USERS (Supabase Auth users mirrored with agency metadata)
-- =============================================================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete restrict,
  email text not null,
  display_name text,
  role text not null default 'investigator' check (role in ('investigator', 'supervisor', 'admin', 'service')),
  mfa_enrolled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_agency_id_idx on public.users(agency_id);

alter table public.users enable row level security;

create policy "agency members can see other members of their agency"
  on public.users for select
  using (agency_id = current_agency_id());

-- =============================================================================
-- CASES
-- =============================================================================
create table public.cases (
  id uuid primary key default uuid_generate_v4(),
  agency_id uuid not null references public.agencies(id) on delete restrict,
  codename text not null,
  status text not null default 'intake'
    check (status in ('intake', 'active', 'paused', 'prepared_for_court', 'closed', 'archived')),
  classification text not null default 'unclassified'
    check (classification in ('unclassified', 'LES', 'confidential', 'classified')),

  -- Sensitive payload encrypted at app layer (libsodium); Supabase sees ciphertext.
  -- nonce + key_version stored alongside per security_sovereignty.md §2.
  summary_md_enc bytea,
  summary_md_nonce bytea,
  summary_md_key_version int,

  case_dek_ref text,  -- pointer to the per-case DEK in our key management

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cases_agency_id_idx on public.cases(agency_id);
create index cases_status_idx on public.cases(status) where status not in ('closed', 'archived');

alter table public.cases enable row level security;

create policy "agency members can read their agency's cases"
  on public.cases for select
  using (agency_id = current_agency_id());

create policy "agency members can create cases in their agency"
  on public.cases for insert
  with check (
    agency_id = current_agency_id()
    and created_by = auth.uid()
  );

create policy "agency members can update their agency's cases"
  on public.cases for update
  using (agency_id = current_agency_id());

-- =============================================================================
-- IOCs (Indicators of Compromise — addresses, tx hashes, etc.)
-- =============================================================================
create table public.iocs (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete cascade,
  value text not null,
  chain text,
  ioc_type text not null check (ioc_type in ('address', 'tx_hash', 'exchange', 'domain', 'email', 'phone', 'handle', 'other')),
  notes text,
  created_at timestamptz not null default now()
);

create index iocs_case_id_idx on public.iocs(case_id);

alter table public.iocs enable row level security;

create policy "agency members can read their agency's IOCs"
  on public.iocs for select
  using (
    exists (
      select 1 from public.cases
      where cases.id = iocs.case_id and cases.agency_id = current_agency_id()
    )
  );

create policy "agency members can write IOCs to their agency's cases"
  on public.iocs for insert
  with check (
    exists (
      select 1 from public.cases
      where cases.id = iocs.case_id and cases.agency_id = current_agency_id()
    )
  );

-- =============================================================================
-- BELIEF ATOMS (event-sourced, hash-chained, append-only)
-- =============================================================================
create table public.belief_atoms (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id) on delete restrict,

  subject_type text not null,
  subject_ref text not null,
  predicate text not null,
  object_json jsonb,

  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  tier text not null check (tier in ('T0', 'T1', 'T2', 'T3')),

  provenance_json jsonb default '{}'::jsonb,
  derivation_json jsonb default '{}'::jsonb,

  status text not null default 'asserted'
    check (status in ('asserted', 'challenged', 'retracted', 'court_grade')),
  signoff_id uuid references public.users(id),  -- mandatory for court_grade attributions (G1)

  superseded_by uuid,  -- references belief_atoms(id); set non-FK to avoid cycle
  retracted_by uuid,   -- same

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),

  -- hash chain for tamper detection (security_sovereignty §7)
  prior_event_hash bytea,
  content_hash bytea not null
);

create index belief_atoms_case_id_idx on public.belief_atoms(case_id);
create index belief_atoms_subject_idx on public.belief_atoms(subject_type, subject_ref);
create index belief_atoms_status_idx on public.belief_atoms(status);

alter table public.belief_atoms enable row level security;

-- RESTRICTIVE policy: append-only enforcement. No updates or deletes.
create policy "belief_atoms are append-only"
  on public.belief_atoms as restrictive
  for all
  using (true)
  with check (true);

-- Read policy: agency members can read their agency's atoms.
create policy "agency members can read their agency's belief atoms"
  on public.belief_atoms for select
  using (
    exists (
      select 1 from public.cases
      where cases.id = belief_atoms.case_id and cases.agency_id = current_agency_id()
    )
  );

create policy "agency members can insert belief atoms in their agency"
  on public.belief_atoms for insert
  with check (
    exists (
      select 1 from public.cases
      where cases.id = belief_atoms.case_id and cases.agency_id = current_agency_id()
    )
    and created_by = auth.uid()
  );

-- Court-grade attributions require explicit signoff_id (G1).
create policy "court_grade attributions require signoff"
  on public.belief_atoms as restrictive
  for insert
  with check (
    status <> 'court_grade'
    or signoff_id is not null
  );

-- =============================================================================
-- AUDIT LOG (hash-chained, append-only, tamper-evident)
-- =============================================================================
create table public.audit_log_entries (
  id uuid primary key default uuid_generate_v4(),
  agency_id uuid references public.agencies(id),
  actor uuid references public.users(id),
  action text not null,
  target_type text,
  target_ref text,
  metadata jsonb default '{}'::jsonb,
  ts timestamptz not null default now(),

  -- HMAC-SHA256 hash chain (security_sovereignty §7)
  prior_hash bytea,
  this_hash bytea not null
);

create index audit_log_entries_agency_idx on public.audit_log_entries(agency_id, ts desc);
create index audit_log_entries_actor_idx on public.audit_log_entries(actor, ts desc);

alter table public.audit_log_entries enable row level security;

create policy "audit_log_entries are append-only"
  on public.audit_log_entries as restrictive
  for all
  using (true)
  with check (true);

create policy "agency admins can read their agency's audit log"
  on public.audit_log_entries for select
  using (
    agency_id = current_agency_id()
    and current_role_value() in ('supervisor', 'admin')
  );

create policy "any authenticated user can append audit entries for their agency"
  on public.audit_log_entries for insert
  with check (agency_id = current_agency_id());

-- =============================================================================
-- COMMENT: row-level encryption columns
-- =============================================================================
-- Sensitive columns suffixed _enc / _nonce / _key_version are encrypted at
-- the application layer with libsodium XSalsa20-Poly1305 (per
-- security_sovereignty.md §3) before being written to Supabase. Supabase
-- sees only ciphertext for these columns.

-- =============================================================================
-- INITIAL SEED COMMENT
-- =============================================================================
-- No seed data in this migration. Bootstrap user + agency happens via a
-- separate script in /tools/bootstrap when first deploying.
