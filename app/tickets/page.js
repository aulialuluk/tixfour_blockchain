"use client";
import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { rupiah } from "@/lib/pricing";

const LABEL = {
  pending: ["Menunggu pembayaran", "warn"],
  paid: ["Pembayaran berhasil · Menunggu minting", "warn"],
  minting: ["Pembayaran berhasil · Menerbitkan tiket NFT…", "ok"],
};

export default function Tickets() {
  const [data, setData] = useState(null);
  const [offline, setOffline] = useState(false);
  const [err, setErr] = useState("");
  const [actionMsg, setActionMsg] = useState({});
  const [syncingId, setSyncingId] = useState(null);
  const [retryingId, setRetryingId] = useState(null);
  const retried = useRef(new Set());
  const inFlight = useRef(false);
  const queuedLoad = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) {
      queuedLoad.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const d = await api("/api/tickets");
      localStorage.setItem("tixfour:list", JSON.stringify(d));
      setData(d);
      setOffline(false);
      setErr("");

      // Requirement B.2: Penerbitan yang tertahan di status paid dicoba ulang otomatis saat halaman dibuka
      const toRetry = (d.orders || []).filter(
        (o) => o.status === "paid" && !retried.current.has(o.order_id)
      );
      if (toRetry.length > 0) {
        for (const o of toRetry) retried.current.add(o.order_id);
        (async () => {
          for (const o of toRetry) {
            await api(`/api/orders/${o.order_id}/mint`, { method: "POST" }).catch(() => {});
            await load();
          }
        })();
      }
    } catch (e) {
      const cached = localStorage.getItem("tixfour:list");
      if (cached) {
        setData(JSON.parse(cached));
        setOffline(true);
      } else {
        setErr(e.message);
      }
    } finally {
      inFlight.current = false;
      if (queuedLoad.current) {
        queuedLoad.current = false;
        load();
      }
    }
  }, []);

  const syncStatus = useCallback(async (orderId) => {
    setSyncingId(orderId);
    setActionMsg((prev) => ({ ...prev, [orderId]: "Mengecek status ke Midtrans Sandbox…" }));
    try {
      const res = await api(`/api/orders/${orderId}/sync-status`, { method: "POST" });
      if (res.status === "paid" || res.status === "minted") {
        setActionMsg((prev) => ({ ...prev, [orderId]: "Pembayaran terverifikasi! Memproses tiket…" }));
      } else if (res.status === "expired") {
        setActionMsg((prev) => ({ ...prev, [orderId]: "Pesanan telah kedaluwarsa." }));
      } else {
        setActionMsg((prev) => ({ ...prev, [orderId]: `Status saat ini: ${res.status}` }));
      }
      await load();
    } catch (e) {
      setActionMsg((prev) => ({ ...prev, [orderId]: `Gagal cek status: ${e.message}` }));
    } finally {
      setSyncingId(null);
    }
  }, [load]);

  const payNow = useCallback((o) => {
    if (!o.snap_token) {
      // Jika snap token belum ada, cek status dulu
      syncStatus(o.order_id);
      return;
    }

    if (!window.snap) {
      if (o.snap_redirect_url) {
        window.open(o.snap_redirect_url, "_blank");
        return;
      }
      setActionMsg((prev) => ({
        ...prev,
        [o.order_id]: "Memuat komponen pembayaran Midtrans Snap… Silakan coba 2 detik lagi.",
      }));
      return;
    }

    window.snap.pay(o.snap_token, {
      onSuccess: async () => {
        setActionMsg((prev) => ({ ...prev, [o.order_id]: "Pembayaran berhasil! Memverifikasi…" }));
        await api(`/api/orders/${o.order_id}/sync-status`, { method: "POST" }).catch(() => {});
        load();
      },
      onPending: async () => {
        setActionMsg((prev) => ({ ...prev, [o.order_id]: "Pembayaran diproses (pending)…" }));
        await api(`/api/orders/${o.order_id}/sync-status`, { method: "POST" }).catch(() => {});
        load();
      },
      onError: () => {
        setActionMsg((prev) => ({ ...prev, [o.order_id]: "Pembayaran ditolak atau terjadi error." }));
        load();
      },
      onClose: async () => {
        setActionMsg((prev) => ({ ...prev, [o.order_id]: "Jendela pembayaran ditutup. Menyelaraskan status…" }));
        await api(`/api/orders/${o.order_id}/sync-status`, { method: "POST" }).catch(() => {});
        load();
      },
    });
  }, [load, syncStatus]);

  const retryMint = useCallback(async (orderId) => {
    setRetryingId(orderId);
    setActionMsg((prev) => ({ ...prev, [orderId]: "Menerbitkan tiket ke Sepolia…" }));
    try {
      const res = await api(`/api/orders/${orderId}/mint`, { method: "POST" });
      if (res?.ok) {
        setActionMsg((prev) => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      } else if (res?.skipped) {
        setActionMsg((prev) => ({
          ...prev,
          [orderId]: "Penerbitan sedang diproses di latar belakang…",
        }));
      } else if (res?.error) {
        setActionMsg((prev) => ({ ...prev, [orderId]: `Mint gagal: ${res.error}` }));
      }
      await load();
    } catch (e) {
      setActionMsg((prev) => ({ ...prev, [orderId]: `Mint gagal: ${e.message}` }));
    } finally {
      setRetryingId(null);
    }
  }, [load]);

  const hasProcessing = Boolean(
    data?.orders?.some((o) => o.status === "paid" || o.status === "minting")
  );
  const activeTickets = (data?.tickets || []).filter((t) => !t.checked_in_at);
  const historyTickets = (data?.tickets || []).filter((t) => Boolean(t.checked_in_at));

  useEffect(() => {
    load();
    const onFocus = () => !document.hidden && load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, hasProcessing ? 3000 : 6000);
    return () => clearInterval(t);
  }, [load, hasProcessing]);

  return (
    <div className="wrap stack">
      <Script
        src="https://app.sandbox.midtrans.com/snap/snap.js"
        data-client-key={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY}
        strategy="afterInteractive"
      />

      <div className="row between">
        <h1 style={{ marginBottom: 0 }}>Tiket saya</h1>
        <button className="btn ghost sm" onClick={load} type="button">
          Segarkan
        </button>
      </div>

      {offline && <div className="notice warn">Tidak ada koneksi internet. Menampilkan data tersimpan.</div>}
      {err && <div className="notice bad">{err} <Link href="/login">Masuk</Link></div>}
      {!data && !err && <p className="muted">Memuat tiket…</p>}

      {/* DAFTAR PESANAN PENDING & PAID */}
      {data?.orders?.map((o) => (
        <div key={o.order_id} className="notice stack">
          <div className="row between">
            <strong>{o.events?.name || "Acara"}</strong>
            <span className={`badge ${LABEL[o.status]?.[1] || "warn"}`}>
              {LABEL[o.status]?.[0] || o.status}
            </span>
          </div>

          <div className="muted" style={{ fontSize: "0.9rem" }}>
            {o.qty} tiket · {rupiah(o.total)} · Order ID: <code>{o.order_id}</code>
          </div>

          {actionMsg[o.order_id] && (
            <div className="notice" style={{ fontSize: "0.85rem", padding: "0.4rem 0.6rem" }}>
              {actionMsg[o.order_id]}
            </div>
          )}

          {/* STATUS PENDING: TOMBOL BAYAR SEKARANG & PERBARUI STATUS */}
          {o.status === "pending" && (
            <div className="row between" style={{ marginTop: "0.5rem" }}>
              <div className="row" style={{ gap: "0.5rem" }}>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => payNow(o)}
                  title="Buka pop-up pembayaran Midtrans Snap"
                >
                  Bayar sekarang
                </button>
                <button
                  className="btn ghost sm"
                  type="button"
                  disabled={syncingId === o.order_id}
                  onClick={() => syncStatus(o.order_id)}
                  title="Cek status pembayaran langsung ke Midtrans Sandbox"
                >
                  {syncingId === o.order_id ? "Mengecek…" : "Perbarui Status"}
                </button>
              </div>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                Selesaikan pembayaran dalam 30 menit
              </span>
            </div>
          )}

          {/* STATUS PAID: INDIKATOR MINTING & COBA TERBITKAN ULANG */}
          {o.status === "paid" && (
            <div className="row between" style={{ marginTop: "0.5rem" }}>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {o.last_error || o.mint_error
                  ? `Penerbitan ke blockchain tertunda: ${o.last_error || o.mint_error}`
                  : "Pembayaran terkonfirmasi. Tiket sedang diterbitkan ke Ethereum Sepolia…"}
              </span>
              <button
                className="btn ghost sm"
                type="button"
                disabled={retryingId === o.order_id}
                onClick={() => retryMint(o.order_id)}
                title="Picu ulang penerbitan NFT ke smart contract Sepolia"
              >
                {retryingId === o.order_id ? "Menerbitkan…" : "Coba terbitkan ulang"}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* DAFTAR TIKET AKTIF & RIWAYAT TIKET */}
      {data && (
        <>
          <section className="card stack">
            <div className="row between">
              <h2 style={{ marginBottom: 0 }}>Tiket Aktif</h2>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {activeTickets.length} tiket
              </span>
            </div>

            {activeTickets.length === 0 ? (
              <div className="notice">
                Tidak ada tiket aktif saat ini. <Link href="/#discover">Jelajahi acara</Link>
              </div>
            ) : (
              <div className="grid">
                {activeTickets.map((t) => (
                  <Link key={t.token_id} href={`/ticket/${t.token_id}`} className="card stack">
                    <h3 style={{ marginBottom: 0 }}>{t.events?.name}</h3>
                    <div className="muted">
                      {t.events?.event_date &&
                        new Date(t.events.event_date).toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      <br />
                      {t.events?.venue}
                    </div>
                    <div className="row between" style={{ marginTop: "0.5rem" }}>
                      <span className="badge ok">Token #{t.token_id}</span>
                      <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--accent)" }}>
                        Buka QR Tiket →
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="card stack">
            <div className="row between">
              <h2 style={{ marginBottom: 0 }}>Riwayat Tiket</h2>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {historyTickets.length} tiket
              </span>
            </div>

            {historyTickets.length === 0 ? (
              <div className="notice">Belum ada riwayat tiket yang sudah digunakan.</div>
            ) : (
              <div className="grid">
                {historyTickets.map((t) => (
                  <div
                    key={t.token_id}
                    className="card stack"
                    style={{ opacity: 0.85, borderStyle: "dashed" }}
                  >
                    <h3 style={{ marginBottom: 0 }}>{t.events?.name}</h3>
                    <div className="muted">
                      {t.events?.event_date &&
                        new Date(t.events.event_date).toLocaleString("id-ID", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      <br />
                      {t.events?.venue}
                    </div>
                    <div className="row between" style={{ marginTop: "0.3rem" }}>
                      <span className="badge">Token #{t.token_id}</span>
                      <span className="badge warn">Sudah Digunakan</span>
                    </div>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      Dipindai pada:{" "}
                      {new Date(t.checked_in_at).toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
