"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { api } from "@/lib/api";

export default function NavBar() {
  const pathname = usePathname();
  const [user, setUser] = useState(null); // { email, role, id }
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function checkUser(session) {
    if (!session?.user) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const res = await api("/api/auth/me");
      if (res?.user) {
        setUser(res.user);
      } else {
        const metaRole = session.user.user_metadata?.role || "user";
        setUser({ email: session.user.email, role: metaRole });
      }
    } catch {
      const metaRole = session.user.user_metadata?.role || "user";
      setUser({ email: session.user.email, role: metaRole });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => checkUser(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      checkUser(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Tutup menu mobile ketika navigasi berpindah
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function logout() {
    await supabase.auth.signOut();
    // Hapus secret tiket & cache lokal
    Object.keys(localStorage)
      .filter((k) => k.startsWith("tixfour:"))
      .forEach((k) => localStorage.removeItem(k));
    window.location.href = "/";
  }

  const role = user?.role || "user";
  const email = user?.email || "";
  const username = email ? email.split("@")[0] : "";

  // Helper active state
  const isHomeActive = pathname === "/" || pathname === "/#discover";
  const isTicketsActive = pathname.startsWith("/tickets") || pathname.startsWith("/ticket/");
  const isAdminActive = pathname === "/admin";
  const isAdminMonitoringActive = pathname.startsWith("/admin/monitoring");
  const isEoDashboardActive = pathname === "/eo/dashboard";
  const isEoScannerActive = pathname.startsWith("/eo/scanner");

  return (
    <nav className="nav">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="TixFour beranda">
          Tix<b>Four</b>
        </Link>

        {/* MENU NAVIGASI (DESKTOP & MOBILE DROPDOWN) */}
        <div className={`nav-links${mobileOpen ? " open" : ""}`}>
          {/* Menu Jelajahi selalu tampil untuk semua role & guest */}
          <Link
            href="/"
            className={`link${isHomeActive ? " active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            Jelajahi
          </Link>

          {/* Role user: Pembeli Tiket */}
          {user && role === "user" && (
            <Link
              href="/tickets"
              className={`link${isTicketsActive ? " active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              Tiket Saya
            </Link>
          )}

          {/* Role admin: Dashboard Admin & Monitoring Pesanan */}
          {user && role === "admin" && (
            <>
              <Link
                href="/admin"
                className={`link${isAdminActive ? " active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                Dashboard Admin
              </Link>
              <Link
                href="/admin/monitoring"
                className={`link${isAdminMonitoringActive ? " active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                Monitoring Pesanan
              </Link>
            </>
          )}

          {/* Role eo: Dashboard EO & Scanner Tiket */}
          {user && role === "eo" && (
            <>
              <Link
                href="/eo/dashboard"
                className={`link${isEoDashboardActive ? " active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                Dashboard EO
              </Link>
              <Link
                href="/eo/scanner"
                className={`link${isEoScannerActive ? " active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                Scanner Tiket
              </Link>
            </>
          )}
        </div>

        {/* AREA KANAN: IDENTITAS & TOMBOL AKSI */}
        <div className="nav-right">
          {loading ? (
            <span className="muted" style={{ fontSize: "0.85rem" }}>Memuat…</span>
          ) : user ? (
            <>
              {/* Badge Identitas berdasarkan Role */}
              {role === "admin" && (
                <span className="badge-role admin">Admin</span>
              )}
              {role === "eo" && (
                <span className="badge-role eo">EO</span>
              )}
              {role === "user" && (
                <span className="nav-user-label" title={email}>
                  {username}
                </span>
              )}

              {/* Tombol Ringkas Keluar */}
              <button
                className="btn ghost sm"
                onClick={logout}
                title={`Keluar (${email})`}
                type="button"
              >
                Keluar
              </button>
            </>
          ) : (
            /* Kondisi Belum Login (Guest): Tombol Masuk Solid Accent */
            <Link href="/login" className="btn sm">
              Masuk
            </Link>
          )}

          {/* Tombol Hamburger Mobile */}
          <button
            type="button"
            className="nav-toggle"
            aria-label="Toggle navigasi"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>
    </nav>
  );
}
