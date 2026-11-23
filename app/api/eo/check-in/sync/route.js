import { getAdmin, requireUser, isEO, json } from "@/lib/server";

export async function POST(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  if (!isEO(user)) return json({ error: "Akses khusus Event Organizer (EO)." }, 403);

  const body = await req.json().catch(() => ({}));
  const { eventId, checkins } = body;

  if (!eventId || !Array.isArray(checkins)) {
    return json({ error: "Data sinkronisasi tidak valid (wajib eventId dan array checkins)." }, 400);
  }

  const db = getAdmin();

  // Verifikasi kepemilikan acara oleh EO
  const { data: ev, error: evErr } = await db
    .from("events")
    .select("id, eo_id")
    .eq("id", eventId)
    .single();

  if (evErr || !ev) return json({ error: "Acara tidak ditemukan." }, 404);
  if (ev.eo_id && ev.eo_id !== user.id) {
    return json({ error: "Anda tidak berhak memperbarui kehadiran acara ini." }, 403);
  }

  let syncedCount = 0;
  const results = [];

  for (const item of checkins) {
    const tokenId = Number(item.tokenId || item.token_id);
    const checkedInAt = item.checkedInAt || item.checked_in_at || new Date().toISOString();

    if (!tokenId) continue;

    // Ambil status tiket saat ini
    const { data: ticket } = await db
      .from("tickets")
      .select("id, token_id, checked_in_at")
      .eq("event_id", eventId)
      .eq("token_id", tokenId)
      .maybeSingle();

    if (!ticket) {
      results.push({ tokenId, success: false, reason: "Tiket tidak ditemukan" });
      continue;
    }

    // Idempotent: jika belum check-in, update
    if (!ticket.checked_in_at) {
      const { error: updErr } = await db
        .from("tickets")
        .update({
          checked_in_at: checkedInAt,
          checked_in_by: user.id,
          sync_status: "synced",
        })
        .eq("id", ticket.id)
        .is("checked_in_at", null);

      if (!updErr) {
        syncedCount++;
        results.push({ tokenId, success: true, status: "newly_checked_in" });
      } else {
        results.push({ tokenId, success: false, reason: updErr.message });
      }
    } else {
      // Sudah tercatat sebelumnya
      results.push({ tokenId, success: true, status: "already_checked_in", checked_in_at: ticket.checked_in_at });
    }
  }

  return json({
    success: true,
    eventId,
    totalReceived: checkins.length,
    syncedCount,
    results,
  });
}
