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
    .select("id, name, eo_id")
    .eq("id", eventId)
    .single();

  if (evErr || !ev) return json({ error: "Acara tidak ditemukan." }, 404);

  // Jika acara belum memiliki eo_id, tautkan ke EO yang sedang login
  if (!ev.eo_id) {
    await db.from("events").update({ eo_id: user.id }).eq("id", eventId);
    ev.eo_id = user.id;
  }

  if (ev.eo_id !== user.id) {
    return json({ error: "Anda bukan penyelenggara resmi acara ini." }, 403);
  }

  // Ambil seluruh tiket berstatus terbit untuk acara ini
  const { data: tickets, error: tErr } = await db
    .from("tickets")
    .select("id, token_id, event_id, order_id, user_id, totp_secret, checked_in_at, checked_in_by, created_at")
    .eq("event_id", eventId)
    .order("token_id", { ascending: true });

  if (tErr) return json({ error: tErr.message }, 500);

  // Ambil nama/email pembeli
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

  const manifest = (tickets || []).map((t) => ({
    ticket_id: t.id,
    token_id: t.token_id,
    event_id: t.event_id,
    event_name: ev.name,
    order_id: t.order_id,
    buyer_email: buyerMap[t.user_id] || "Pembeli (anonim)",
    buyer_name: buyerMap[t.user_id]?.split("@")[0] || `Pengguna #${t.token_id}`,
    totp_secret: t.totp_secret,
    checked_in_at: t.checked_in_at,
    checked_in_by: t.checked_in_by,
  }));

  return json({
    eventId: ev.id,
    eventName: ev.name,
    totalTickets: manifest.length,
    manifest,
  });
}
