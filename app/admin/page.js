"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { rupiah } from "@/lib/pricing";
import { supabase } from "@/lib/supabase-browser";

const empty = {
  name: "",
  description: "",
  venue: "",
  event_date: "",
  price: 50000,
  max_supply: 100,
  max_per_account: 4,
};

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function Admin() {
  const [events, setEvents] = useState([]);
  const [authState, setAuthState] = useState("loading");
  const [sessionEmail, setSessionEmail] = useState("");
  const [err, setErr] = useState("");
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef(null);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setEvents([]);
      setSessionEmail("");
      setErr("");
      setAuthState("unauth");
      return;
    }

    setSessionEmail(session.user?.email || "");
    try {
      const eventsData = await api("/api/admin/events");
      setEvents(eventsData.events || []);
      setErr("");
      setAuthState("ready");
    } catch (e) {
      setErr(e.message);
      if (e.status === 401) setAuthState("unauth");
      else if (e.status === 403) setAuthState("forbidden");
      else setAuthState("error");
    }
  }, []);

  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { load(); });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function startCreate() {
    setEditing(null);
    setConfirmDeleteId(null);
    setForm(empty);
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function startEdit(ev) {
    setEditing(ev);
    setConfirmDeleteId(null);
    setForm({
      name: ev.name || "",
      description: ev.description || "",
      venue: ev.venue || "",
      event_date: toLocalInputValue(ev.event_date),
      price: ev.price,
      max_supply: ev.max_supply,
      max_per_account: ev.max_per_account,
    });
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function saveEvent(e) {
    e.preventDefault();
    setBusy(true);
    const payload = {
      name: form.name,
      description: form.description,
      venue: form.venue,
      event_date: new Date(form.event_date).toISOString(),
      price: Number(form.price),
      max_per_account: Number(form.max_per_account),
      ...(editing ? {} : { max_supply: Number(form.max_supply) }),
    };

    try {
      if (editing) {
        setMsg(`Menyimpan perubahan "${editing.name}"…`);
        await api(`/api/admin/events/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setMsg("Acara diperbarui.");
      } else {
        setMsg("Membuat acara dan mencatatnya di smart contract… (±15 detik)");
        await api("/api/admin/events", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMsg("Acara dibuat.");
      }
      setEditing(null);
      setForm(empty);
      await load();
    } catch (e2) {
      setMsg(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent(ev) {
    setBusy(true);
    setMsg(`Menghapus "${ev.name}"…`);
    try {
      await api(`/api/admin/events/${ev.id}`, { method: "DELETE" });
      if (editing?.id === ev.id) {
        setEditing(null);
        setForm(empty);
      }
      setConfirmDeleteId(null);
      setMsg(`Acara "${ev.name}" dihapus.`);
      await load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (authState === "loading") return <div className="wrap muted">Memuat…</div>;
  if (authState === "unauth") {
    return (
      <div className="wrap stack">
        <h1>Admin</h1>
        <div className="notice warn">
          Silakan masuk dengan akun admin terlebih dahulu. <Link href="/login?next=/admin">Masuk</Link>
        </div>
      </div>
    );
  }
  if (authState === "forbidden") {
    return (
      <div className="wrap stack">
        <h1>Admin</h1>
        <div className="notice bad">
          {err} {sessionEmail && <>Akun saat ini: <strong>{sessionEmail}</strong>.</>}{" "}
          Pastikan email akun terdaftar di <code>ADMIN_EMAILS</code> atau memiliki role admin.
        </div>
        <div className="row">
          <Link href="/login?next=/admin" className="btn sm">Masuk dengan akun lain</Link>
          <Link href="/" className="btn ghost sm">Kembali ke beranda</Link>
        </div>
      </div>
    );
  }
  if (authState === "error") return <div className="wrap"><div className="notice bad">{err}</div></div>;

  return (
    <div className="wrap stack">
      <div className="row between">
        <h1 style={{ marginBottom: 0 }}>Dashboard Admin</h1>
        <button className="btn ghost sm" onClick={load} disabled={busy}>
          Segarkan Data
        </button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* 1. KELOLA ACARA (TOMBOL 'LIHAT' TELAH DIHAPUS) */}
      <h2>Kelola acara</h2>
      {events.length === 0 ? (
        <div className="notice">Belum ada acara. Buat acara pertama lewat formulir di bawah.</div>
      ) : (
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Acara</th>
                <th>Jadwal &amp; Lokasi</th>
                <th>Harga</th>
                <th>Kuota</th>
                <th>Transaksi</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const locked = ev.orders_count > 0 || ev.tickets_count > 0;
                const confirming = confirmDeleteId === ev.id;
                return (
                  <tr key={ev.id}>
                    <td>
                      <strong>{ev.name}</strong>
                      <div className="muted" style={{ fontSize: "0.82rem" }}>
                        Chain ID #{ev.chain_event_id}
                        {ev.description ? ` · ${ev.description.slice(0, 60)}${ev.description.length > 60 ? "…" : ""}` : ""}
                      </div>
                    </td>
                    <td>
                      <div>{new Date(ev.event_date).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>{ev.venue || "—"}</div>
                    </td>
                    <td>{rupiah(ev.price)}</td>
                    <td>
                      <div>{ev.max_supply} total</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>maks. {ev.max_per_account}/akun</div>
                    </td>
                    <td>
                      <div>{ev.tickets_count} tiket</div>
                      <div className="muted" style={{ fontSize: "0.85rem" }}>{ev.orders_count} pesanan</div>
                    </td>
                    <td>
                      {/* REQUIREMENT A.5: Tombol 'Lihat' dihapus, menyisakan Edit dan Hapus */}
                      <div className="row" style={{ gap: "0.4rem" }}>
                        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => startEdit(ev)}>
                          Edit
                        </button>
                        {confirming ? (
                          <>
                            <button type="button" className="btn danger sm" disabled={busy} onClick={() => deleteEvent(ev)}>
                              Yakin hapus
                            </button>
                            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setConfirmDeleteId(null)}>
                              Batal
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={busy || locked}
                            title={locked ? "Acara yang sudah memiliki pesanan atau tiket tidak dapat dihapus." : "Hapus acara"}
                            onClick={() => setConfirmDeleteId(ev.id)}
                          >
                            Hapus
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

      {/* 2. FORMULIR BUAT / EDIT ACARA */}
      <div ref={formRef} className="row between" style={{ scrollMarginTop: "1rem" }}>
        <h2 style={{ marginBottom: 0 }}>
          {editing ? `Edit acara: ${editing.name}` : "Acara baru"}
        </h2>
        {editing && (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={startCreate}>
            Batal edit
          </button>
        )}
      </div>

      <form onSubmit={saveEvent} className="card">
        <div className="field">
          <label htmlFor="ev-name">Nama acara</label>
          <input id="ev-name" required value={form.name} onChange={set("name")} />
        </div>
        <div className="field">
          <label htmlFor="ev-desc">Deskripsi</label>
          <textarea id="ev-desc" rows={2} value={form.description} onChange={set("description")} />
        </div>
        <div className="field">
          <label htmlFor="ev-venue">Lokasi</label>
          <input id="ev-venue" value={form.venue} onChange={set("venue")} />
        </div>
        <div className="field">
          <label htmlFor="ev-date">Tanggal dan jam</label>
          <input id="ev-date" type="datetime-local" required value={form.event_date} onChange={set("event_date")} />
        </div>
        <div className="field">
          <label htmlFor="ev-price">Harga tiket (Rp)</label>
          <input id="ev-price" type="number" min={0} required value={form.price} onChange={set("price")} />
        </div>
        <div className="field">
          <label htmlFor="ev-supply">Kuota total (maxSupply)</label>
          <input
            id="ev-supply"
            type="number"
            min={1}
            required
            disabled={!!editing}
            value={form.max_supply}
            onChange={set("max_supply")}
          />
          {editing && (
            <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
              Kuota total tidak dapat diubah karena sudah tercatat di smart contract.
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="ev-max-acc">Maks. tiket per akun</label>
          <input
            id="ev-max-acc"
            type="number"
            min={1}
            required
            value={form.max_per_account}
            onChange={set("max_per_account")}
          />
        </div>
        <p className="row">
          <button className="btn" disabled={busy}>
            {editing ? "Simpan perubahan" : "Buat acara"}
          </button>
          {editing && (
            <button type="button" className="btn ghost" disabled={busy} onClick={startCreate}>
              Batal
            </button>
          )}
        </p>
      </form>
    </div>
  );
}
