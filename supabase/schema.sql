-- Jalankan di Supabase: SQL Editor > New query

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  chain_event_id bigint generated always as identity unique,
  name text not null,
  description text,
  venue text,
  event_date timestamptz not null,
  price integer not null check (price >= 0),
  max_supply integer not null check (max_supply > 0),
  max_per_account integer not null default 4 check (max_per_account > 0),
  created_at timestamptz not null default now()
);

create table if not exists orders (
  order_id text primary key,
  user_id uuid not null references auth.users(id),
  event_id uuid not null references events(id),
  qty integer not null check (qty > 0),
  payment_method text not null check (payment_method in ('qris','va')),
  ticket_subtotal integer not null,
  service_fee integer not null,
  admin_fee integer not null,
  tax integer not null,
  gateway_fee integer not null,
  total integer not null,
  status text not null default 'pending'
    check (status in ('pending','paid','minting','minted','failed','expired')),
  snap_token text,
  midtrans_status text,
  last_error text,
  minting_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists orders_user_idx on orders(user_id);
create index if not exists orders_event_idx on orders(event_id);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references orders(order_id),
  idx integer not null,
  token_id bigint not null unique,
  tx_hash text,
  totp_secret text not null,
  user_id uuid not null references auth.users(id),
  event_id uuid not null references events(id),
  created_at timestamptz not null default now(),
  unique (order_id, idx)
);

-- RLS: semua tabel dikunci. Acara boleh dibaca publik; order & tiket
-- hanya diakses lewat API server (service role) supaya totp_secret tidak bocor.
alter table events enable row level security;
alter table orders enable row level security;
alter table tickets enable row level security;

drop policy if exists "events are public" on events;
create policy "events are public" on events for select using (true);
