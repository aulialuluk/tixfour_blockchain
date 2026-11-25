import { getAdmin, requireAdmin, json } from "@/lib/server";
import { parseEventInput, UUID_RE } from "@/lib/events";

async function findEvent(db, id) {
  if (!UUID_RE.test(id)) return { error: json({ error: "Acara tidak ditemukan." }, 404) };
  const { data, error } = await db.from("events").select("*").eq("id", id).maybeSingle();
  if (error) return { error: json({ error: error.message }, 500) };
  if (!data) return { error: json({ error: "Acara tidak ditemukan." }, 404) };
  return { event: data };
}

export async function GET(req, { params }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const { event, error } = await findEvent(getAdmin(), id);
  return error || json(event);
}

export async function PATCH(req, { params }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const db = getAdmin();
  const { event: existing, error: findErr } = await findEvent(db, id);
  if (findErr) return findErr;

  const body = await req.json().catch(() => ({}));
  if (body.max_supply !== undefined && Number(body.max_supply) !== existing.max_supply) {
    return json(
      { error: "Kuota total (maxSupply) tidak dapat diubah karena sudah tercatat di smart contract." },
      400
    );
  }

  const parsed = parseEventInput(body, { requireSupply: false });
  if (parsed.error) return json({ error: parsed.error }, 400);

  const { data: updated, error } = await db
    .from("events")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);
  return json(updated);
}

export async function DELETE(req, { params }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const db = getAdmin();
  const { error: findErr } = await findEvent(db, id);
  if (findErr) return findErr;

  const [ordersRes, ticketsRes] = await Promise.all([
    db.from("orders").select("*", { count: "exact", head: true }).eq("event_id", id),
    db.from("tickets").select("*", { count: "exact", head: true }).eq("event_id", id),
  ]);
  if (ordersRes.error) return json({ error: ordersRes.error.message }, 500);
  if (ticketsRes.error) return json({ error: ticketsRes.error.message }, 500);

  if ((ordersRes.count ?? 0) > 0 || (ticketsRes.count ?? 0) > 0) {
    return json(
      { error: "Acara yang sudah memiliki pesanan atau tiket tidak dapat dihapus." },
      409
    );
  }

  const { error } = await db.from("events").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, id });
}
