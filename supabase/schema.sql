create table if not exists public.user_profile (
  user_id uuid primary key,
  timezone text,
  day_boundary_minute integer,
  constraints_json jsonb,
  consent_accepted_at timestamptz,
  consent_version integer,
  onboarding_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.checkin (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  stress integer,
  sleep_quality integer,
  energy integer,
  time_available_min integer,
  raw jsonb,
  created_at timestamptz default now(),
  primary key (user_id, date_key)
);

create table if not exists public.event (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  type text not null,
  idempotency_key text,
  payload jsonb,
  created_at timestamptz default now()
);

create unique index if not exists event_user_idempotency_key_uniq
  on public.event (user_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists event_user_type_date_uniq
  on public.event (user_id, type, date_key)
  where type in ('rail_opened', 'reset_completed', 'checkin_submitted');

create table if not exists public.derived_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_key text,
  input_hash text,
  today_contract jsonb,
  updated_at timestamptz default now()
);

alter table public.user_profile enable row level security;
alter table public.checkin enable row level security;
alter table public.event enable row level security;
alter table public.derived_state enable row level security;

create policy "user_profile_select" on public.user_profile
  for select using (auth.uid() = user_id);
create policy "user_profile_insert" on public.user_profile
  for insert with check (auth.uid() = user_id);
create policy "user_profile_update" on public.user_profile
  for update using (auth.uid() = user_id);

create policy "checkin_select" on public.checkin
  for select using (auth.uid() = user_id);
create policy "checkin_insert" on public.checkin
  for insert with check (auth.uid() = user_id);
create policy "checkin_update" on public.checkin
  for update using (auth.uid() = user_id);

create policy "event_select" on public.event
  for select using (auth.uid() = user_id);
create policy "event_insert" on public.event
  for insert with check (auth.uid() = user_id);

create policy "derived_state_select" on public.derived_state
  for select using (auth.uid() = user_id);
create policy "derived_state_insert" on public.derived_state
  for insert with check (auth.uid() = user_id);
create policy "derived_state_update" on public.derived_state
  for update using (auth.uid() = user_id);
