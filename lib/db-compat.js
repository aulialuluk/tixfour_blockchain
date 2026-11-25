// Utilitas kompatibilitas skema Supabase (Fase 1 schema.sql vs Fase 2 migration_phase2.sql).
// Memastikan fitur transaksi, sinkronisasi Midtrans, dan minting ERC-721 tetap berjalan
// mulus walaupun migration_phase2.sql belum dijalankan di Supabase SQL Editor.

const schemaCache = {
  ordersPhase2: { value: null, checkedAt: 0 },
  ticketsPhase2: { value: null, checkedAt: 0 },
  eventsPhase2: { value: null, checkedAt: 0 },
  profilesTable: { value: null, checkedAt: 0 },
};

const CACHE_TTL_MS = 30_000;

export function isMissingSchemaError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || "").toLowerCase();
  return (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function probeSchema(key, fn) {
  const entry = schemaCache[key];
  const now = Date.now();
  if (entry.value !== null && now - entry.checkedAt < CACHE_TTL_MS) {
    return entry.value;
  }
  try {
    const { error } = await fn();
    if (!error) {
      schemaCache[key] = { value: true, checkedAt: now };
      return true;
    }
    if (isMissingSchemaError(error)) {
      schemaCache[key] = { value: false, checkedAt: now };
      return false;
    }
    // Error jaringan/sementara: jangan cache sebagai false
    return entry.value ?? false;
  } catch {
    return entry.value ?? false;
  }
}

export function resetSchemaCache(key) {
  if (key && schemaCache[key]) {
    schemaCache[key] = { value: null, checkedAt: 0 };
  }
}

export function hasOrdersPhase2Cols(db) {
  return probeSchema("ordersPhase2", () =>
    db.from("orders").select("snap_redirect_url,mint_error,minting_in_progress").limit(0)
  );
}

export function hasTicketsPhase2Cols(db) {
  return probeSchema("ticketsPhase2", () =>
    db.from("tickets").select("checked_in_at,checked_in_by,sync_status").limit(0)
  );
}

export function hasEventsPhase2Cols(db) {
  return probeSchema("eventsPhase2", () =>
    db.from("events").select("eo_id").limit(0)
  );
}

export function hasProfilesTable(db) {
  return probeSchema("profilesTable", () =>
    db.from("profiles").select("id").limit(0)
  );
}

const ORDERS_PHASE2_KEYS = ["snap_redirect_url", "mint_error", "minting_in_progress"];
const TICKETS_PHASE2_KEYS = ["checked_in_at", "checked_in_by", "sync_status"];

export function pickOrderFields(hasPhase2, fields) {
  if (hasPhase2) return { ...fields };
  const copy = { ...fields };
  for (const k of ORDERS_PHASE2_KEYS) delete copy[k];
  return copy;
}

export function pickTicketFields(hasPhase2, fields) {
  if (hasPhase2) return { ...fields };
  const copy = { ...fields };
  for (const k of TICKETS_PHASE2_KEYS) delete copy[k];
  return copy;
}
