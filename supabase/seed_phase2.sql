-- ================================================================
-- TIXFOUR: SEED DATA PHASE 2 (IDEMPOTENT)
-- Akun Testing, Event EO, Pesanan (Pending, Paid, Minted), dan Tiket
-- ================================================================

-- Catatan akun testing:
-- 1. admin@email.com   (Role: admin)
-- 2. eo@tixfour.test   (Role: eo)
-- 3. hana@gmail.com    (Role: user)
-- 4. budi@tixfour.test (Role: user)
-- Password default yang disarankan: Password123!
-- (Akun dapat didaftarkan melalui /login atau Supabase Auth Studio)

DO $$
DECLARE
  v_admin_id uuid;
  v_eo_id uuid;
  v_user1_id uuid;
  v_user2_id uuid;
  v_event1_id uuid;
  v_event2_id uuid;
  v_order_pending text := 'TIX4-SEED-PENDING-01';
  v_order_paid text := 'TIX4-SEED-PAID-01';
  v_order_minted text := 'TIX4-SEED-MINTED-01';
  v_order_minted2 text := 'TIX4-SEED-MINTED-02';
BEGIN
  -- 1. Dapatkan atau siapkan ID untuk user testing
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@email.com' LIMIT 1;
  SELECT id INTO v_eo_id FROM auth.users WHERE email = 'eo@tixfour.test' LIMIT 1;
  SELECT id INTO v_user1_id FROM auth.users WHERE email = 'hana@gmail.com' LIMIT 1;
  SELECT id INTO v_user2_id FROM auth.users WHERE email = 'budi@tixfour.test' LIMIT 1;

  -- Pastikan profil & raw_user_meta_data terisi jika user sudah ada di auth.users
  IF v_admin_id IS NOT NULL THEN
    UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb WHERE id = v_admin_id;
    INSERT INTO public.profiles (id, email, role) VALUES (v_admin_id, 'admin@email.com', 'admin')
    ON CONFLICT (id) DO UPDATE SET role = 'admin';
  END IF;

  IF v_eo_id IS NOT NULL THEN
    UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"role":"eo"}'::jsonb WHERE id = v_eo_id;
    INSERT INTO public.profiles (id, email, role) VALUES (v_eo_id, 'eo@tixfour.test', 'eo')
    ON CONFLICT (id) DO UPDATE SET role = 'eo';
  END IF;

  IF v_user1_id IS NOT NULL THEN
    UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"role":"user"}'::jsonb WHERE id = v_user1_id;
    INSERT INTO public.profiles (id, email, role) VALUES (v_user1_id, 'hana@gmail.com', 'user')
    ON CONFLICT (id) DO UPDATE SET role = 'user';
  END IF;

  IF v_user2_id IS NOT NULL THEN
    UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"role":"user"}'::jsonb WHERE id = v_user2_id;
    INSERT INTO public.profiles (id, email, role) VALUES (v_user2_id, 'budi@tixfour.test', 'user')
    ON CONFLICT (id) DO UPDATE SET role = 'user';
  END IF;

  -- 2. Buat atau perbarui minimal 2 Acara milik EO
  SELECT id INTO v_event1_id FROM public.events WHERE name = 'Soundfest Music Festival 2026' LIMIT 1;
  IF v_event1_id IS NULL THEN
    INSERT INTO public.events (name, description, venue, event_date, price, max_supply, max_per_account, eo_id)
    VALUES (
      'Soundfest Music Festival 2026',
      'Festival musik akbar dengan penampilan musisi papan atas nasional dan internasional.',
      'Stadion Madya GBK, Senayan, Jakarta',
      NOW() + interval '14 days',
      150000,
      500,
      4,
      v_eo_id
    ) RETURNING id INTO v_event1_id;
  ELSE
    UPDATE public.events SET eo_id = v_eo_id WHERE id = v_event1_id;
  END IF;

  SELECT id INTO v_event2_id FROM public.events WHERE name = 'Tech & Blockchain Summit 2026' LIMIT 1;
  IF v_event2_id IS NULL THEN
    INSERT INTO public.events (name, description, venue, event_date, price, max_supply, max_per_account, eo_id)
    VALUES (
      'Tech & Blockchain Summit 2026',
      'Konferensi teknologi Web3, smart contracts, dan inovasi digital terbesar di Asia Tenggara.',
      'Grand Ballroom JIExpo Kemayoran, Jakarta',
      NOW() + interval '30 days',
      250000,
      300,
      2,
      v_eo_id
    ) RETURNING id INTO v_event2_id;
  ELSE
    UPDATE public.events SET eo_id = v_eo_id WHERE id = v_event2_id;
  END IF;

  -- 3. Buat pesanan testing jika user pembeli ada
  IF v_user1_id IS NOT NULL THEN
    -- Pesanan 1: Status PENDING (Menunggu Pembayaran)
    INSERT INTO public.orders (
      order_id, user_id, event_id, qty, payment_method,
      ticket_subtotal, service_fee, admin_fee, tax, gateway_fee, total,
      status, snap_token, snap_redirect_url, created_at
    ) VALUES (
      v_order_pending, v_user1_id, v_event1_id, 1, 'qris',
      150000, 3750, 4000, 853, 1109, 159712,
      'pending', 'mock-snap-token-pending-123', 'https://app.sandbox.midtrans.com/snap/v2/vtweb/mock-snap-token-pending-123',
      NOW() - interval '20 minutes'
    ) ON CONFLICT (order_id) DO NOTHING;

    -- Pesanan 2: Status PAID (Menunggu Minting / Tertahan)
    INSERT INTO public.orders (
      order_id, user_id, event_id, qty, payment_method,
      ticket_subtotal, service_fee, admin_fee, tax, gateway_fee, total,
      status, snap_token, midtrans_status, last_error, mint_error, paid_at, created_at
    ) VALUES (
      v_order_paid, v_user1_id, v_event1_id, 1, 'va',
      150000, 3750, 4000, 853, 4000, 162603,
      'paid', 'mock-snap-token-paid-456', 'settlement',
      'Timeout menghubungi RPC Sepolia (Gas estimation timeout).',
      'Timeout menghubungi RPC Sepolia (Gas estimation timeout).',
      NOW() - interval '1 hour', NOW() - interval '1 hour'
    ) ON CONFLICT (order_id) DO NOTHING;

    -- Pesanan 3: Status MINTED (Tiket Sudah Terbit)
    INSERT INTO public.orders (
      order_id, user_id, event_id, qty, payment_method,
      ticket_subtotal, service_fee, admin_fee, tax, gateway_fee, total,
      status, snap_token, midtrans_status, paid_at, created_at
    ) VALUES (
      v_order_minted, v_user1_id, v_event1_id, 2, 'qris',
      300000, 7500, 4000, 1265, 2190, 314955,
      'minted', 'mock-snap-token-minted-789', 'settlement',
      NOW() - interval '2 hours', NOW() - interval '2 hours'
    ) ON CONFLICT (order_id) DO NOTHING;

    -- Tiket untuk Pesanan 3:
    -- Tiket 1 (Token ID 9001): Belum check-in
    INSERT INTO public.tickets (
      order_id, idx, token_id, tx_hash, totp_secret, user_id, event_id, created_at
    ) VALUES (
      v_order_minted, 0, 9001,
      '0x3a7e589f8931215bb41f2398418920cb95c8812c3f87b32a394a5c92841f3e21',
      'JBSWY3DPEHPK3PXP', v_user1_id, v_event1_id, NOW() - interval '2 hours'
    ) ON CONFLICT (order_id, idx) DO NOTHING;

    -- Tiket 2 (Token ID 9002): Sudah check-in
    INSERT INTO public.tickets (
      order_id, idx, token_id, tx_hash, totp_secret, user_id, event_id,
      checked_in_at, checked_in_by, sync_status, created_at
    ) VALUES (
      v_order_minted, 1, 9002,
      '0x5f9a231b671c890123ef61a29487c50a149b5c2a10486c91d830b81e4918f0a2',
      'KRSXG5CTMVRXEZLU', v_user1_id, v_event1_id,
      NOW() - interval '30 minutes', v_eo_id, 'synced', NOW() - interval '2 hours'
    ) ON CONFLICT (order_id, idx) DO NOTHING;
  END IF;

  -- Tiket tambahan untuk Event 2 (Budi)
  IF v_user2_id IS NOT NULL THEN
    INSERT INTO public.orders (
      order_id, user_id, event_id, qty, payment_method,
      ticket_subtotal, service_fee, admin_fee, tax, gateway_fee, total,
      status, snap_token, midtrans_status, paid_at, created_at
    ) VALUES (
      v_order_minted2, v_user2_id, v_event2_id, 1, 'qris',
      250000, 6250, 4000, 1128, 1830, 263208,
      'minted', 'mock-snap-token-minted-999', 'settlement',
      NOW() - interval '5 hours', NOW() - interval '5 hours'
    ) ON CONFLICT (order_id) DO NOTHING;

    INSERT INTO public.tickets (
      order_id, idx, token_id, tx_hash, totp_secret, user_id, event_id, created_at
    ) VALUES (
      v_order_minted2, 0, 9003,
      '0x7b1c4e928f61a0934d8123fa7591e0bc6241a87c530182bc9401826f18392019',
      'MZXW6YTBOI======', v_user2_id, v_event2_id, NOW() - interval '5 hours'
    ) ON CONFLICT (order_id, idx) DO NOTHING;
  END IF;

END $$;
