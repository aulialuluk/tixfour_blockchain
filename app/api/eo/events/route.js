import { getAdmin, requireUser, isEO, json } from "@/lib/server";

export async function GET(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  if (!isEO(user)) return json({ error: "Akses khusus Event Organizer (EO)." }, 403);

  const db = getAdmin();

  // Ambil semua acara milik EO ini
  const { data: events, error } = await db
    .from("events")
    .select("id, name, venue, event_date, price, max_supply, chain_event_id, eo_id")
    .eq("eo_id", user.id)
    .order("event_date", { ascending: true });

  if (error) return json({ error: error.message }, 500);

  // Jika belum ada acara dengan eo_id ini, cek apakah ada acara tanpa eo_id yang bisa diklaim/ditampilkan
  let finalEvents = events || [];
  if (finalEvents.length === 0) {
    const { data: unassigned } = await db
      .from("events")
      .select("id, name, venue, event_date, price, max_supply, chain_event_id, eo_id")
      .is("eo_id", null)
      .order("event_date", { ascending: true });

    // Jika ada acara tanpa EO, tautkan ke EO ini untuk memudahkan pengujian
    if (unassigned && unassigned.length > 0) {
      for (const ev of unassigned) {
        await db.from("events").update({ eo_id: user.id }).eq("id", ev.id);
      }
      finalEvents = unassigned.map((e) => ({ ...e, eo_id: user.id }));
    }
  }

  return json({ events: finalEvents });
}
