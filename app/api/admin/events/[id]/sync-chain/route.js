import { getAdmin, requireAdmin, json } from "@/lib/server";
import { ensureChainEvent, getIssuer, withIssuerLock } from "@/lib/chain";
import { UUID_RE } from "@/lib/events";

export const maxDuration = 60;

export async function POST(req, { params }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return json({ error: "Acara tidak ditemukan." }, 404);

  const db = getAdmin();
  const { data: ev, error } = await db
    .from("events")
    .select("id,name,chain_event_id,max_supply")
    .eq("id", id)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!ev) return json({ error: "Acara tidak ditemukan." }, 404);

  try {
    const res = await withIssuerLock(async () => {
      const { contract, provider } = getIssuer();
      try {
        return await ensureChainEvent(contract, ev.chain_event_id, ev.max_supply);
      } finally {
        provider?.destroy?.();
      }
    });
    return json({ ok: true, ...res, chain_event_id: ev.chain_event_id });
  } catch (e) {
    return json(
      { error: "Gagal mendaftarkan acara ke smart contract: " + (e.shortMessage || e.message) },
      502
    );
  }
}
