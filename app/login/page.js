"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Guard: jika pengguna sudah login, langsung redirect ke halaman tujuan atau beranda
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const next = new URLSearchParams(window.location.search).get("next");
        const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
        window.location.href = target;
      } else {
        setCheckingAuth(false);
      }
    });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const fn = mode === "login" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
    const { data, error } = await fn.call(supabase.auth, { email, password });
    setBusy(false);
    if (error) return setMsg(error.message);

    if (data.session) {
      const next = new URLSearchParams(window.location.search).get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      // Gunakan navigasi penuh agar browser langsung mengirimkan cookie sesi terbaru ke middleware
      window.location.href = target;
    } else {
      setMsg("Akun dibuat. Cek email untuk konfirmasi, lalu masuk.");
    }
  }

  if (checkingAuth) {
    return <div className="wrap muted">Memeriksa sesi login…</div>;
  }

  return (
    <div className="wrap narrow">
      <h1>{mode === "login" ? "Masuk" : "Buat akun"}</h1>
      <form onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Kata sandi (min. 6 karakter)</label>
          <input
            id="pw"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {msg && <div className="notice warn">{msg}</div>}
        <button className="btn" disabled={busy}>
          {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
        </button>
      </form>
      <p>
        <button
          className="btn ghost sm"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </p>
    </div>
  );
}
