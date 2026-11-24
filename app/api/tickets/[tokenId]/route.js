import { getAdmin, requireUser, json } from "@/lib/server";
import { hasTicketsPhase2Cols } from "@/lib/db-compat";

// Mengembalikan secret TOTP hanya kepada pemilik tiket selama tiket belum digunakan (checked_in_at == null).
export async function GET(req, { params }) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  const { tokenId } = await params;
  const db = getAdmin();
  const hasTicketP2 = await hasTicketsPhase2Cols(db);
  const cols = hasTicketP2
    ? "token_id,tx_hash,totp_secret,user_id,checked_in_at,events(name,event_date,venue)"
    : "token_id,tx_hash,totp_secret,user_id,events(name,event_date,venue)";

  const { data: t } = await db
    .from("tickets")
    .select(cols)
    .eq("token_id", Number(tokenId))
    .maybeSingle();
  if (!t || t.user_id !== user.id) return json({ error: "Tiket tidak ditemukan." }, 404);

  const used = Boolean(t.checked_in_at);
  return json({
    tokenId: t.token_id,
    secret: used ? null : t.totp_secret,
    used,
    checkedInAt: t.checked_in_at || null,
    txHash: t.tx_hash,
    event: t.events,
  });
}
