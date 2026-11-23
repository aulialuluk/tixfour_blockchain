"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase-browser";
import { getOfflineQueue } from "@/lib/scanner-db";

export default function EoDashboard() {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [data, setData] = useState(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Role check
  const [userRole, setUserRole] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'checked_in' | 'not_checked_in'

  // 1. Cek Role EO
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setUserRole("guest");
        setAuthChecked(true);
        return;
      }
      try {
        const res = await api("/api/auth/me");
        setUserRole(res?.user?.role || "user");
      } catch {
        setUserRole(session.user?.user_metadata?.role || "user");
      } finally {
        setAuthChecked(true);
      }
    }
    checkAuth();
  }, []);

  // 2. Muat Acara EO
  useEffect(() => {
    if (userRole !== "eo") return;
    api("/api/eo/events")
      .then((res) => {
        setEvents(res.events || []);
        if (res.events?.length > 0 && !selectedEventId) {
          setSelectedEventId(res.events[0].id);
        }
      })
      .catch((e) => setErr(e.message));
  }, [userRole, selectedEventId]);

  // 3. Muat Data Analitik Kehadiran
  const loadAnalytics = useCallback(async (eventId) => {
    if (!eventId) return;
    setLoading(true);
    setErr("");
    try {
      const [res, queue] = await Promise.all([
        api(`/api/eo/analytics?eventId=${eventId}`),
        getOfflineQueue(eventId).catch(() => []),
      ]);
      setData(res);
      setOfflineQueueCount(queue.length);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedEventId) {
      loadAnalytics(selectedEventId);
    }
  }, [selectedEventId, loadAnalytics]);

  // 4. Filter & Pencarian Tiket
  const filteredTickets = useMemo(() => {
    if (!data?.tickets) return [];
    const q = searchQuery.trim().toLowerCase();

    return data.tickets.filter((t) => {
      const matchesSearch =
        !q ||
        String(t.token_id).includes(q) ||
        t.order_id?.toLowerCase().includes(q) ||
        t.buyer_name?.toLowerCase().includes(q) ||
        t.buyer_email?.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "checked_in" && t.is_checked_in) ||
        (statusFilter === "not_checked_in" && !t.is_checked_in);

      return matchesSearch && matchesStatus;
    });
  }, [data, searchQuery, statusFilter]);

  // 5. Ekspor Laporan CSV
  const exportCsv = () => {
    if (!data?.tickets?.length) return;
    const headers = [
      "Token ID",
      "Order ID",
      "Nama Pembeli",
      "Email Pembeli",
      "Status Kehadiran",
      "Waktu Check-In",
      "Waktu Diterbitkan",
    ];

    const rows = data.tickets.map((t) => [
      t.token_id,
      t.order_id,
      `"${(t.buyer_name || "").replace(/"/g, '""')}"`,
      t.buyer_email || "",
      t.is_checked_in ? "Sudah Hadir" : "Belum Hadir",
      t.checked_in_at ? new Date(t.checked_in_at).toLocaleString("id-ID") : "-",
      t.created_at ? new Date(t.created_at).toLocaleString("id-ID") : "-",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const safeName = (data.event?.name || "acara").replace(/[^a-zA-Z0-9]/g, "_");
    link.setAttribute("download", `laporan_kehadiran_${safeName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!authChecked) {
    return <div className="wrap muted">Memeriksa hak akses…</div>;
  }

  if (userRole !== "eo") {
    return (
      <div className="wrap stack">
        <h1>Dashboard Analitik EO</h1>
        <div className="notice bad">
          Halaman ini khusus untuk akun dengan role <strong>Event Organizer (EO)</strong>.
        </div>
        <div className="row">
          <Link href="/login?next=/eo/dashboard" className="btn sm">
            Masuk dengan Akun EO
          </Link>
          <Link href="/" className="btn ghost sm">
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    );
  }

  const metrics = data?.metrics || {};
  const maxHourlyCount = Math.max(
    ...(data?.hourlyDistribution || []).map((h) => h.count),
    1
  );

  return (
    <div className="wrap stack">
      <div className="row between">
        <div>
          <span className="eyebrow"><i /> PANITIA PENYELENGGARA (EO)</span>
          <h1 style={{ marginBottom: "0.2rem" }}>Dashboard Analitik Kehadiran</h1>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            Laporan kehadiran peserta dan visualisasi statistik check-in real-time.
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          <Link href="/eo/scanner" className="btn sm">
            Buka Scanner Tiket →
          </Link>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => loadAnalytics(selectedEventId)}
          >
            Segarkan
          </button>
        </div>
      </div>

      {err && <div className="notice bad">{err}</div>}

      {/* EVENT SELECTOR */}
      <div className="card stack">
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="dashboard-event-select">Pilih Acara</label>
          <select
            id="dashboard-event-select"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({new Date(ev.event_date).toLocaleDateString("id-ID")})
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="muted">Memuat data analitik acara…</p>}

      {!loading && data && (
        <>
          {/* KPI CARDS METRIK UTAMA */}
          <div className="grid">
            <div className="card stack">
              <span className="muted" style={{ fontSize: "0.85rem" }}>Total Kapasitas Tiket</span>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--accent)" }}>
                {metrics.maxSupply || 0}
              </div>
              <div className="row" style={{ gap: "0.5rem" }}>
                <span className="badge ok">
                  {metrics.availableRate ?? 100}% Tiket Tersedia
                </span>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  ({metrics.availableTickets ?? Math.max(0, (metrics.maxSupply || 0) - (metrics.totalMinted || 0))} sisa · {metrics.totalMinted || 0} terbit)
                </span>
              </div>
            </div>

            <div className="card stack">
              <span className="muted" style={{ fontSize: "0.85rem" }}>Peserta Sudah Hadir</span>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--ok)" }}>
                {metrics.totalCheckedIn || 0}
              </div>
              <div className="row">
                <span className="badge ok">{metrics.checkInRate || 0}% Check-in Rate</span>
              </div>
            </div>

            <div className="card stack">
              <span className="muted" style={{ fontSize: "0.85rem" }}>Belum Hadir (Pending)</span>
              <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--warn)" }}>
                {metrics.totalNotCheckedIn || 0}
              </div>
              <span className="muted" style={{ fontSize: "0.8rem" }}>Sisa tiket belum masuk</span>
            </div>
          </div>

          {/* INDIKATOR ANTREAN LURING */}
          {offlineQueueCount > 0 && (
            <div className="notice warn row between">
              <span>
                Ada <strong>{offlineQueueCount} data check-in lokal</strong> di perangkat ini yang belum tersinkronkan ke server.
              </span>
              <Link href="/eo/scanner" className="btn sm">
                Buka Scanner untuk Sinkronisasi
              </Link>
            </div>
          )}

          {/* VISUALISASI DISTRIBUSI WAKTU KEDATANGAN */}
          <div className="card stack">
            <h2>Distribusi Waktu Kedatangan Peserta</h2>
            <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>
              Grafik intensitas kedatangan per rentang waktu masuk di pintu venue.
            </p>

            {(!data.hourlyDistribution || data.hourlyDistribution.length === 0) ? (
              <div className="notice" style={{ margin: "1rem 0" }}>
                Belum ada data kedatangan peserta untuk acara ini.
              </div>
            ) : (
              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                {data.hourlyDistribution.map((item) => {
                  const pct = Math.round((item.count / maxHourlyCount) * 100);
                  return (
                    <div key={item.hour} style={{ display: "grid", gridTemplateColumns: "60px 1fr 40px", alignItems: "center", gap: "0.8rem" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{item.hour}</span>
                      <div style={{ background: "var(--bg)", height: "20px", borderRadius: "6px", overflow: "hidden" }}>
                        <div
                          style={{
                            background: "var(--accent)",
                            height: "100%",
                            width: `${pct}%`,
                            borderRadius: "6px",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: "0.85rem", fontWeight: 700, textAlign: "right" }}>
                        {item.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* TABEL LOG KEHADIRAN & PENCARIAN */}
          <div className="card stack">
            <div className="row between">
              <h2 style={{ marginBottom: 0 }}>Tabel Log Kehadiran Peserta</h2>
              <button
                type="button"
                className="btn sm"
                onClick={exportCsv}
                title="Unduh seluruh data kehadiran dalam format spreadsheet CSV"
              >
                Ekspor Laporan (CSV) ⭳
              </button>
            </div>

            {/* BAR PENCARIAN & FILTER */}
            <div className="row" style={{ gap: "0.8rem", marginTop: "0.5rem" }}>
              <div style={{ flex: 2, minWidth: "220px" }}>
                <input
                  type="search"
                  placeholder="Cari berdasarkan Token ID, Order ID, atau Nama/Email pembeli…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: "150px" }}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">Semua Status ({data.tickets?.length || 0})</option>
                  <option value="checked_in">Sudah Hadir ({metrics.totalCheckedIn || 0})</option>
                  <option value="not_checked_in">Belum Hadir ({metrics.totalNotCheckedIn || 0})</option>
                </select>
              </div>
            </div>

            {/* TABEL */}
            <div className="scroll" style={{ marginTop: "0.8rem" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Token ID</th>
                    <th>Order ID</th>
                    <th>Nama Pembeli</th>
                    <th>Email</th>
                    <th>Status Kehadiran</th>
                    <th>Waktu Check-In</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "1.5rem" }} className="muted">
                        Tidak ada tiket yang sesuai dengan pencarian atau filter.
                      </td>
                    </tr>
                  ) : (
                    filteredTickets.map((t) => (
                      <tr key={t.token_id}>
                        <td>
                          <strong>#{t.token_id}</strong>
                        </td>
                        <td>
                          <code style={{ fontSize: "0.82rem" }}>{t.order_id}</code>
                        </td>
                        <td>{t.buyer_name}</td>
                        <td className="muted" style={{ fontSize: "0.85rem" }}>{t.buyer_email}</td>
                        <td>
                          {t.is_checked_in ? (
                            <span className="badge ok">Sudah Hadir</span>
                          ) : (
                            <span className="badge warn">Belum Hadir</span>
                          )}
                        </td>
                        <td style={{ fontSize: "0.85rem" }}>
                          {t.checked_in_at
                            ? new Date(t.checked_in_at).toLocaleString("id-ID", {
                                dateStyle: "short",
                                timeStyle: "medium",
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
