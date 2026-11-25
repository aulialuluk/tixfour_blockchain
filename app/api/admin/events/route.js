import { getAdmin, requireAdmin, json } from "@/lib/server";
import { getIssuer, withIssuerLock } from "@/lib/chain";
import { parseEventInput } from "@/lib/events";

export const maxDuration = 60;

export async function GET(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const db = getAdmin();
  const [eventsRes, ordersRes, ticketsRes] = await Promise.all([
    db.from("events").select("*").order("event_date", { ascending: true }),
    db.from("orders").select("event_id"),
    db.from("tickets").select("event_id"),
  ]);

  if (eventsRes.error) return json({ error: eventsRes.error.message }, 500);
  if (ordersRes.error) return json({ error: ordersRes.error.message }, 500);
  if (ticketsRes.error) return json({ error: ticketsRes.error.message }, 500);

  const orderCounts = new Map();
  for (const row of ordersRes.data || []) {
    orderCounts.set(row.event_id, (orderCounts.get(row.event_id) || 0) + 1);
  }
  const ticketCounts = new Map();
  for (const row of ticketsRes.data || []) {
    ticketCounts.set(row.event_id, (ticketCounts.get(row.event_id) || 0) + 1);
  }

  const events = (eventsRes.data || []).map((ev) => ({
    ...ev,
    orders_count: orderCounts.get(ev.id) || 0,
    tickets_count: ticketCounts.get(ev.id) || 0,
  }));
  return json({ events });
}

export async function POST(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));

  const parsed = parseEventInput(body, { requireSupply: true });
  if (parsed.error) return json({ error: parsed.error }, 400);

  const db = getAdmin();
  const { data: ev, error } = await db
    .from("events")
    .insert(parsed.data)
    .select()
    .single();
  if (error) return json({ error: error.message }, 500);

  try {
    await withIssuerLock(async () => {
      const { contract, provider } = getIssuer();
      try {
        const tx = await contract.createEvent(ev.chain_event_id, ev.max_supply);
        await tx.wait(1, 45_000);
      } finally {
        provider?.destroy?.();
      }
    });
  } catch (e) {
    await db.from("events").delete().eq("id", ev.id);
    return json({ error: "Gagal membuat acara di smart contract: " + (e.shortMessage || e.message) }, 502);
  }
  return json(ev, 201);
}
