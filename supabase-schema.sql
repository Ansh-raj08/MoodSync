-- ============================================================
--  MoodSync — Supabase Database Schema
--  Run this SQL in Supabase SQL Editor (Dashboard → SQL)
--
--  Tables:
--    profiles          – user display info + pair code
--    couples           – linked partner pairs
--    pairing_requests  – pending / accepted / rejected requests
--    mood_logs         – daily mood entries
--
--  All tables have Row Level Security (RLS) enabled.
-- ============================================================


-- ============================================================
--  1. PROFILES
-- ============================================================
create table if not exists profiles (
    id         uuid primary key references auth.users on delete cascade,
    name       text not null,
    email      text not null,
    pair_code  text unique not null default left(gen_random_uuid()::text, 8),
    created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Anyone authenticated can look up profiles (needed for pairing by code)
create policy "Authenticated users can view profiles"
    on profiles for select
    using (auth.role() = 'authenticated');

-- Users can insert their own profile row on sign-up
create policy "Users can insert own profile"
    on profiles for insert
    with check (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
    on profiles for update
    using (auth.uid() = id);


-- ============================================================
--  TRIGGER: auto-create profile on sign-up
--  Run this in Supabase SQL Editor to create/replace the trigger.
--  It reads the name passed via auth.signUp options.data.name
--  so the profile row is fully populated from the start.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email, name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
    )
    on conflict (id) do update
        set name  = excluded.name,
            email = excluded.email;
    return new;
end;
$$;

-- Attach trigger if it doesn't already exist
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();


-- ============================================================
--  2. COUPLES
-- ============================================================
create table if not exists couples (
    id         uuid primary key default gen_random_uuid(),
    user1_id   uuid not null references profiles(id) on delete cascade,
    user2_id   uuid not null references profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique(user1_id, user2_id)
);

alter table couples enable row level security;

-- Each partner can see their couple row
create policy "Users can view their own couple"
    on couples for select
    using (auth.uid() = user1_id or auth.uid() = user2_id);

-- A couple row is created when a pairing request is accepted
create policy "Users can create couple"
    on couples for insert
    with check (auth.uid() = user1_id or auth.uid() = user2_id);


-- ============================================================
--  3. PAIRING REQUESTS
-- ============================================================
create table if not exists pairing_requests (
    id          uuid primary key default gen_random_uuid(),
    sender_id   uuid not null references profiles(id) on delete cascade,
    receiver_id uuid not null references profiles(id) on delete cascade,
    status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'rejected')),
    created_at  timestamptz not null default now()
);

alter table pairing_requests enable row level security;

-- Both sender and receiver can view the request
create policy "Users can view their pairing requests"
    on pairing_requests for select
    using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Authenticated users can send requests
create policy "Users can send pairing requests"
    on pairing_requests for insert
    with check (auth.uid() = sender_id);

-- Only the receiver can accept / reject
create policy "Receiver can update request status"
    on pairing_requests for update
    using (auth.uid() = receiver_id);


-- ============================================================
--  4. MOOD LOGS
-- ============================================================
create table if not exists mood_logs (
    id        uuid primary key default gen_random_uuid(),
    user_id   uuid not null references profiles(id) on delete cascade,
    score     integer not null check (score >= 1 and score <= 9),
    note      text,
    logged_at timestamptz not null default now()
);

alter table mood_logs enable row level security;

-- Users can view their own logs
create policy "Users can view own mood logs"
    on mood_logs for select
    using (auth.uid() = user_id);

-- Partners can view each other's logs (via couples table)
create policy "Partners can view each other mood logs"
    on mood_logs for select
    using (
        exists (
            select 1 from couples
            where (user1_id = auth.uid() and user2_id = mood_logs.user_id)
               or (user2_id = auth.uid() and user1_id = mood_logs.user_id)
        )
    );

-- Users can insert their own logs
create policy "Users can insert own mood logs"
    on mood_logs for insert
    with check (auth.uid() = user_id);


-- ============================================================
--  5. REALTIME — enable for mood_logs and pairing_requests
-- ============================================================
-- Run these in the Supabase Dashboard → Database → Replication
-- or via SQL:
alter publication supabase_realtime add table mood_logs;
alter publication supabase_realtime add table pairing_requests;
