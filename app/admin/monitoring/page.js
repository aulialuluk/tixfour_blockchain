"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { rupiah } from "@/lib/pricing";
import { supabase } from "@/lib/supabase-browser";

export default function AdminMonitoring() {
  const [report, setReport] = useState(null);
  const [authState, setAuthState] = useState("loading");
  const [sessionEmail, setSessionEmail] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setReport(null);
      setSessionEmail("");
      setErr("");
      setAuthState("unauth");
      return;
    }

    setSessionEmail(session.user?.email || "");
    setBusy(true);
    try {
      const reportData = await api("/api/admin/reconcile");
      setReport(reportData);
      setErr("");
      setAuthState("ready");
    } catch (e) {
      setErr(e.message);
      if (e.status === 401) setAuthState("unauth");
      else if (e.status === 403) setAuthState("forbidden");
      else setAuthState("error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load();
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  async function checkMidtransStatus(orderId) {
    setActionLoadingId(orderId);
    setMsg(`Mengecek status transaksi ${orderId} ke Midtrans Sandbox…`);
    try {
      const res = await api(`/api/orders/${orderId}/sync-status`, { method: "POST" });
      setMsg(
        `Order ${orderId}: Status terverifikasi -> ${res.status}${
          res.midtransStatus ? ` (Midtrans: ${res.midtransStatus})` : ""
        }`
      );
      await load();
    } catch (e) {
      setMsg(`Gagal cek status ${orderId}: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function retryMint(orderId) {
    setActionLoadingId(orderId);
    setMsg(`Menerbitkan ulang tiket NFT untuk pesanan ${orderId} ke Sepolia…`);
    try {
      const r = await api(`/api/orders/${orderId}/mint`, { method: "POST" });
      setMsg(
        `${orderId}: Status -> ${r.status}${
          r.last_error ? ` (${r.last_error})` : " (Berhasil terbit)"
        }`
      );
      await load();
    } catch (e) {
      setMsg(`Gagal minting ${orderId}: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function cancelOrder(orderId) {
    if (!confirm(`Batalkan pesanan ${orderId}?`)) return;
    setActionLoadingId(orderId);
    try {
      await api(`/api/orders/${orderId}`, { method: "DELETE" });
      setMsg(`Pesanan ${orderId} berhasil dibatalkan.`);
      await load();
    } catch (e) {
      setMsg(`Gagal membatalkan: ${e.message}`);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function syncEventToChain(row) {
    setActionLoadingId(row.id);
    setMsg(`Mendaftarkan acara "${row.name}" (#${row.chain_event_id}) ke smart contract Sepolia…`);
    try {
      const res = await api(`/api/admin/events/${row.id}/sync-chain`, { method: "POST" });
      setMsg(
        res.created
          ? `Acara "${row.name}" berhasil didaftarkan ke smart contract.`
          : `Acara "${row.name}" sudah terdaftar di smart contract.`
      );
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setActionLoadingId(null);
    }
  }

  if (authState === "loading") return <div className="wrap muted">Memuat…</div>;
  if (authState === "unauth") {
    return (
      <div className="wrap stack">
        <h1>Monitoring Pesanan</h1>
        <div className="notice warn">
          Silakan masuk dengan akun admin terlebih dahulu.{" "}
          <Link href="/login?next=/admin/monitoring">Masuk</Link>
        </div>
      </div>
    );
  }
  if (authState === "forbidden") {
    return (
      <div className="wrap stack">
        <h1>Monitoring Pesanan</h1>
        <div className="notice bad">
          {err} {sessionEmail && <>Akun saat ini: <strong>{sessionEmail}</strong>.</>}{" "}
          Pastikan email akun terdaftar di <code>ADMIN_EMAILS</code> atau memiliki role admin.
        </div>
        <div className="row">
          <Link href="/login?next=/admin/monitoring" className="btn sm">
            Masuk dengan akun lain
          </Link>
          <Link href="/" className="btn ghost sm">
            Kembali ke beranda
          </Link>
        </div>
      </div>
    );
  }
  if (authState === "error") {
    return (
      <div className="wrap">
        <div className="notice bad">{err}</div>
      </div>
    );
  }

  return (
    <div className="wrap stack">
      <div className="row between">
        <h1 style={{ marginBottom: 0 }}>Monitoring Pesanan</h1>
        <button className="btn ghost sm" type="button" onClick={load} disabled={busy}>
          Segarkan Data
        </button>
      </div>

      {msg && <div className="notice">{msg}</div>}
      {report?.chainWarning && <div className="notice warn">{report.chainWarning}</div>}

      {/* 1. LAPORAN PENCOCOKAN DATA */}
      <section className="card stack">
        <h2 style={{ marginBottom: 0 }}>Laporan Pencocokan Data</h2>
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Acara</th>
                <th>Kuota</th>
                <th>Smart Contract</th>
                <th>Tiket Terbit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {report?.rows?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.error && !report?.chainWarning && (
                      <div className="muted" style={{ fontSize: "0.85rem" }}>
                        {r.error}
                      </div>
                    )}
                  </td>
                  <td>{r.max_supply}</td>
                  <td>{r.chain ?? "—"}</td>
                  <td>{r.db}</td>
                  <td>
                    <div className="row" style={{ gap: "0.4rem" }}>
                      {r.chain === null ? (
                        <span className="badge warn" title={r.error || ""}>
                          Gagal baca
                        </span>
                      ) : r.on_chain === false ? (
                        <>
                          <span className="badge warn" title={r.error || ""}>
                            Belum di Chain
                          </span>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={actionLoadingId === r.id || busy}
                            onClick={() => syncEventToChain(r)}
                          >
                            {actionLoadingId === r.id ? "Mendaftarkan…" : "Daftarkan ke Chain"}
                          </button>
                        </>
                      ) : (
                        <span className={`badge ${r.match ? "ok" : "bad"}`}>
                          {r.match ? "Cocok" : "Berbeda"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. PESANAN TERTUNDA */}
      <section className="card stack">
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>Pesanan Tertunda</h2>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            Total: {report?.stuck?.length || 0} pesanan
          </span>
        </div>

      {!report?.stuck || report.stuck.length === 0 ? (
        <div className="notice">Tidak ada pesanan tertunda saat ini.</div>
      ) : (
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Nama Acara</th>
                <th>Email Pembeli</th>
                <th>Jumlah Tiket</th>
                <th>Total Nominal</th>
                <th>Waktu Transaksi</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {report.stuck.map((o) => {
                const isPending = o.status === "pending";
                const isPaid = o.status === "paid";
                const isMinting = o.status === "minting";
                const isActionLoading = actionLoadingId === o.order_id;

                return (
                  <tr key={o.order_id}>
                    <td>
                      <code>{o.order_id}</code>
                      {o.last_error && (
                        <div className="muted" style={{ fontSize: "0.8rem", color: "var(--warn)" }}>
                          {o.last_error}
                        </div>
                      )}
                    </td>
                    <td>{o.event_name}</td>
                    <td>{o.buyer_email}</td>
                    <td>{o.qty} tiket</td>
                    <td>
                      <strong>{rupiah(o.total)}</strong>
                    </td>
                    <td>
                      <div style={{ fontSize: "0.85rem" }}>
                        {new Date(o.created_at).toLocaleString("id-ID", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </div>
                    </td>
                    <td>
                      {isPending && (
                        <span
                          className="badge warn"
                          title="Pengguna belum menyelesaikan pembayaran di Midtrans Sandbox"
                        >
                          Menunggu Pembayaran (pending)
                        </span>
                      )}
                      {isPaid && (
                        <span
                          className="badge"
                          style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
                          title="Pembayaran telah terverifikasi, tiket siap diterbitkan ke Sepolia"
                        >
                          Menunggu Minting NFT (paid)
                        </span>
                      )}
                      {isMinting && (
                        <span className="badge ok">Sedang Minting (minting)</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: "0.4rem" }}>
                        {isPending && (
                          <>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={isActionLoading || busy}
                              onClick={() => checkMidtransStatus(o.order_id)}
                              title="Cek status transaksi ke Midtrans Core API Sandbox"
                            >
                              {isActionLoading ? "Mengecek…" : "Cek Status Midtrans"}
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={isActionLoading || busy}
                              onClick={() => cancelOrder(o.order_id)}
                              title="Batalkan pesanan kedaluwarsa"
                            >
                              Batalkan
                            </button>
                          </>
                        )}

                        {isPaid && (
                          <button
                            type="button"
                            className="btn sm"
                            disabled={isActionLoading || busy}
                            onClick={() => retryMint(o.order_id)}
                            title="Terbitkan ulang tiket NFT ke smart contract Sepolia"
                          >
                            {isActionLoading ? "Memproses…" : "Terbitkan Ulang NFT"}
                          </button>
                        )}

                        {isMinting && (
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={isActionLoading || busy}
                            onClick={() => retryMint(o.order_id)}
                          >
                            Picu Ulang
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
}
