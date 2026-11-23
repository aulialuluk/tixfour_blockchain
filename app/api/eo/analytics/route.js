import { getAdmin, requireUser, isEO, json } from "@/lib/server";

export async function GET(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  if (!isEO(user)) return json({ error: "Akses khusus Event Organizer (EO)." }, 403);

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("eventId");
  if (!eventId) return json({ error: "Parameter eventId wajib diisi." }, 400);

  const db = getAdmin();

  // Verifikasi kepemilikan acara oleh EO
  const { data: ev, error: evErr } = await db
    .from("events")
    .select("id, name, venue, event_date, max_supply, eo_id")
    .eq("id", eventId)
    .single();

  if (evErr || !ev) return json({ error: "Acara tidak ditemukan." }, 404);

  if (ev.eo_id && ev.eo_id !== user.id) {
    return json({ error: "Anda bukan penyelenggara resmi acara ini." }, 403);
  }

  // Ambil semua tiket acara
  const { data: tickets, error: tErr } = await db
    .from("tickets")
    .select("id, token_id, order_id, user_id, checked_in_at, created_at")
    .eq("event_id", eventId)
    .order("token_id", { ascending: true });

  if (tErr) return json({ error: tErr.message }, 500);

  // Ambil profil pembeli
  const userIds = [...new Set((tickets || []).map((t) => t.user_id).filter(Boolean))];
  const buyerMap = {};

  if (userIds.length > 0) {
    try {
      const { data: profiles } = await db
        .from("profiles")
        .select("id, email")
        .in("id", userIds);
      if (profiles) {
        for (const p of profiles) {
          if (p.email) buyerMap[p.id] = p.email;
        }
      }
    } catch {}

    const missingIds = userIds.filter((id) => !buyerMap[id]);
    if (missingIds.length > 0) {
      try {
        const { data: listData } = await db.auth.admin.listUsers();
        if (listData?.users) {
          for (const u of listData.users) {
            buyerMap[u.id] = u.email;
          }
        }
      } catch {}
    }
  }

  const maxSupply = ev.max_supply || 0;
  const totalMinted = (tickets || []).length;
  const availableTickets = Math.max(0, maxSupply - totalMinted);
  const checkedInTickets = (tickets || []).filter((t) => Boolean(t.checked_in_at));
  const totalCheckedIn = checkedInTickets.length;
  const totalNotCheckedIn = totalMinted - totalCheckedIn;

  const occupancyRate = maxSupply > 0
    ? Math.round((totalMinted / maxSupply) * 100)
    : 0;

  const availableRate = maxSupply > 0
    ? Number(((availableTickets / maxSupply) * 100).toFixed(1))
    : 0;

  const checkInRate = totalMinted > 0
    ? Math.round((totalCheckedIn / totalMinted) * 100)
    : 0;

  // Hitung distribusi kedatangan per jam
  const hoursMap = {};
  for (const t of checkedInTickets) {
    const d = new Date(t.checked_in_at);
    if (!Number.isNaN(d.getTime())) {
      const hourStr = `${String(d.getHours()).padStart(2, "0")}:00`;
      hoursMap[hourStr] = (hoursMap[hourStr] || 0) + 1;
    }
  }

  // Buat array berurutan
  const sortedHours = Object.keys(hoursMap).sort();
  const hourlyDistribution = sortedHours.map((h) => ({
    hour: h,
    count: hoursMap[h],
  }));

  const ticketRows = (tickets || []).map((t) => ({
    ticket_id: t.id,
    token_id: t.token_id,
    order_id: t.order_id,
    buyer_email: buyerMap[t.user_id] || "Pembeli (anonim)",
    buyer_name: buyerMap[t.user_id]?.split("@")[0] || `Pengguna #${t.token_id}`,
    is_checked_in: Boolean(t.checked_in_at),
    checked_in_at: t.checked_in_at,
    created_at: t.created_at,
  }));

  return json({
    event: {
      id: ev.id,
      name: ev.name,
      venue: ev.venue,
      event_date: ev.event_date,
      max_supply: ev.max_supply,
    },
    metrics: {
      maxSupply,
      totalMinted,
      availableTickets,
      availableRate,
      occupancyRate,
      totalCheckedIn,
      checkInRate,
      totalNotCheckedIn,
    },
    hourlyDistribution,
    tickets: ticketRows,
  });
}
