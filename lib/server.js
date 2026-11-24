import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { hasProfilesTable } from "./db-compat";

let _admin;
export function getAdmin() {
  if (!_admin) {
    _admin = createClient(
      (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
      (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _admin;
}

export function isAdminEmail(email) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Mendapatkan role pengguna secara andal:
 * 1. Jika email ada di ADMIN_EMAILS -> 'admin'
 * 2. Cek tabel profiles di Supabase (jika tersedia)
 * 3. Cek user_metadata / app_metadata
 * 4. Default -> 'user'
 */
export async function getUserRole(user) {
  if (!user) return null;
  if (isAdminEmail(user.email)) return "admin";

  const db = getAdmin();
  if (await hasProfilesTable(db)) {
    try {
      const { data: profile } = await db
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.role) return profile.role;
    } catch {
      // fallback
    }
  }

  const metaRole = user.user_metadata?.role || user.app_metadata?.role;
  if (metaRole && ["admin", "eo", "user"].includes(metaRole)) {
    return metaRole;
  }

  return "user";
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx < 0) return null;
      const name = part.slice(0, idx).trim();
      const rawVal = part.slice(idx + 1).trim();
      try {
        return { name, value: decodeURIComponent(rawVal) };
      } catch {
        return { name, value: rawVal };
      }
    })
    .filter(Boolean);
}

export async function requireUser(req) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (token) {
    try {
      const { data, error } = await getAdmin().auth.getUser(token);
      if (!error && data?.user) {
        const user = data.user;
        user.role = await getUserRole(user);
        return user;
      }
    } catch {}
  }

  // Fallback: baca sesi dari HTTP cookies @supabase/ssr
  const cookieHeader = req.headers.get("cookie") || "";
  if (cookieHeader) {
    try {
      const parsedCookies = parseCookieHeader(cookieHeader);
      const ssrClient = createServerClient(
        (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
        (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim(),
        {
          cookies: {
            getAll: () => parsedCookies,
            setAll: () => {},
          },
        }
      );
      const { data, error } = await ssrClient.auth.getUser();
      if (!error && data?.user) {
        const user = data.user;
        user.role = await getUserRole(user);
        return user;
      }
    } catch {}
  }

  return null;
}

export function isAdmin(user) {
  return user?.role === "admin" || isAdminEmail(user?.email);
}

export function isEO(user) {
  return user?.role === "eo";
}

export function isBuyer(user) {
  return user?.role === "user";
}

/**
 * Memastikan request berasal dari user dengan role tertentu.
 * Mengembalikan null jika lolos, atau NextResponse 401/403 jika gagal.
 */
export async function requireRole(req, allowedRoles = []) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  if (!allowedRoles.includes(user.role)) {
    return json({ error: `Akses ditolak untuk role ${user.role}.` }, 403);
  }
  return null;
}

/**
 * Memastikan request berasal dari pengguna terautentikasi dengan role admin.
 */
export async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  if (!isAdmin(user)) return json({ error: "Khusus admin." }, 403);
  return null;
}

/**
 * Memastikan request berasal dari pengguna terautentikasi dengan role eo.
 */
export async function requireEO(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  if (!isEO(user)) return json({ error: "Khusus Event Organizer (EO)." }, 403);
  return null;
}

/**
 * Memastikan request berasal dari pengguna pembeli tiket (role user).
 */
export async function requireBuyer(req) {
  const user = await requireUser(req);
  if (!user) return json({ error: "Silakan login dulu." }, 401);
  if (!isBuyer(user)) return json({ error: "Akun pengelola tidak diizinkan membeli tiket." }, 403);
  return null;
}

export const json = (data, status = 200) => NextResponse.json(data, { status });
