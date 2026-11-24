export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Memvalidasi dan menormalkan payload acara dari request admin.
 * Mengembalikan `{ data }` atau `{ error }`.
 */
export function parseEventInput(body, { requireSupply = false } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim()
      : null;
  const venue =
    typeof b.venue === "string" && b.venue.trim() ? b.venue.trim() : null;

  const parsedDate = b.event_date ? new Date(b.event_date) : null;
  const validDate = parsedDate && !Number.isNaN(parsedDate.getTime());

  const price = Number(b.price);
  const max_per_account = Number(b.max_per_account ?? 4);

  if (
    !name ||
    !validDate ||
    !Number.isInteger(price) ||
    price < 0 ||
    !Number.isInteger(max_per_account) ||
    max_per_account < 1
  ) {
    return { error: "Data acara tidak valid." };
  }

  const data = {
    name,
    description,
    venue,
    event_date: parsedDate.toISOString(),
    price,
    max_per_account,
  };

  if (requireSupply) {
    const max_supply = Number(b.max_supply);
    if (!Number.isInteger(max_supply) || max_supply < 1) {
      return { error: "Kuota total (maxSupply) harus bilangan bulat minimal 1." };
    }
    data.max_supply = max_supply;
  }

  return { data };
}
