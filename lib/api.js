import { supabase } from "./supabase-browser";

// Fetch ke API internal dengan token sesi Supabase.
export async function api(path, opts = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || "Permintaan gagal");
    err.status = res.status;
    throw err;
  }
  return body;
}
