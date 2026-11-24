-- ================================================================
-- TIXFOUR: MIGRATION PHASE 2
-- Penambahan Role-Based Access Control (RBAC), Relasi EO, 
-- Kolom Tiket Check-in TOTP, dan Optimasi Status Pesanan
-- ================================================================

-- 1. Tabel Profil Pengguna untuk RBAC
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('admin', 'eo', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);

-- RLS Profil Pengguna
alter table public.profiles enable row level security;

drop policy if exists "profiles_read_policy" on public.profiles;
create policy "profiles_read_policy" on public.profiles
  for select using (
    auth.uid() = id or 
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists "profiles_update_policy" on public.profiles;
create policy "profiles_update_policy" on public.profiles
  for update using (
    auth.uid() = id or 
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Trigger Otomatis Pembuatan Profil saat User Mendaftar di Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
declare
  user_role text;
begin
  user_role := coalesce(new.raw_user_meta_data->>'role', 'user');
  if user_role not in ('admin', 'eo', 'user') then
    user_role := 'user';
  end if;

  insert into public.profiles (id, email, role, created_at, updated_at)
  values (new.id, new.email, user_role, now(), now())
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Migrasikan data auth.users yang sudah ada ke public.profiles
insert into public.profiles (id, email, role, created_at, updated_at)
select 
  id, 
  email, 
  case 
    when email = 'admin@email.com' then 'admin'
    when lower(email) like '%eo%' then 'eo'
    else coalesce(raw_user_meta_data->>'role', 'user')
  end as role, 
  now(), 
  now()
from auth.users
on conflict (id) do update
set email = excluded.email;

-- 2. Penambahan Kolom eo_id pada Tabel Events
alter table public.events add column if not exists eo_id uuid references auth.users(id);
create index if not exists events_eo_idx on public.events(eo_id);

-- 3. Penambahan Kolom snap_redirect_url, mint_error, & minting_in_progress pada Tabel Orders
alter table public.orders add column if not exists snap_redirect_url text;
alter table public.orders add column if not exists mint_error text;
alter table public.orders add column if not exists minting_in_progress boolean not null default false;
create index if not exists orders_status_created_idx on public.orders(status, created_at desc);

-- 4. Penambahan Kolom checked_in_at, checked_in_by, & sync_status pada Tabel Tickets
alter table public.tickets add column if not exists checked_in_at timestamptz;
alter table public.tickets add column if not exists checked_in_by uuid references auth.users(id);
alter table public.tickets add column if not exists sync_status text not null default 'synced' check (sync_status in ('synced', 'offline_pending'));
create index if not exists tickets_checked_in_idx on public.tickets(checked_in_at);
create index if not exists tickets_event_idx on public.tickets(event_id);
create index if not exists tickets_token_id_idx on public.tickets(token_id);
