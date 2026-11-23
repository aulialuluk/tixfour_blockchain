"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import jsQR from "jsqr";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase-browser";
import { verifyTotp } from "@/lib/totp";
import {
  saveManifestToDb,
  getLocalTicket,
  recordLocalCheckIn,
  getLocalTicketsForEvent,
  getOfflineQueue,
  clearSyncedFromQueue,
} from "@/lib/scanner-db";

export default function EoScanner() {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [localTicketCount, setLocalTicketCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Role check
  const [userRole, setUserRole] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Manual input state
  const [manualTokenId, setManualTokenId] = useState("");
  const [manualOtp, setManualOtp] = useState("");

  // Scan Result State
  const [scanResult, setScanResult] = useState(null);

  // Camera scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [decoderMode, setDecoderMode] = useState("");
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanningRef = useRef(false);
  const loopTimerRef = useRef(null);
  const selectedEventIdRef = useRef("");
  const downloadedEventsRef = useRef(new Set());

  useEffect(() => {
    selectedEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  // 1. Cek Autentikasi & Role EO
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
  const loadEvents = useCallback(async () => {
    try {
      const res = await api("/api/eo/events");
      setEvents(res.events || []);
      if (res.events?.length > 0 && !selectedEventIdRef.current) {
        setSelectedEventId(res.events[0].id);
      }
    } catch {
      const cached = localStorage.getItem("tixfour:eo:events");
      if (cached) {
        const parsed = JSON.parse(cached);
        setEvents(parsed);
        if (parsed.length > 0 && !selectedEventIdRef.current) setSelectedEventId(parsed[0].id);
      }
    }
  }, []);

  useEffect(() => {
    if (userRole === "eo") {
      loadEvents();
    }
  }, [userRole, loadEvents]);

  useEffect(() => {
    if (events.length > 0) {
      localStorage.setItem("tixfour:eo:events", JSON.stringify(events));
    }
  }, [events]);

  // 3. Periksa Jumlah Tiket & Antrean di IndexedDB saat event berubah
  const refreshLocalStats = useCallback(async (eventId) => {
    if (!eventId) return;
    try {
      const tickets = await getLocalTicketsForEvent(eventId);
      setLocalTicketCount(tickets.length);
      const queue = await getOfflineQueue(eventId);
      setQueueCount(queue.length);
    } catch (e) {
      console.warn("Gagal membaca IndexedDB:", e);
    }
  }, []);

  useEffect(() => {
    if (selectedEventId) {
      refreshLocalStats(selectedEventId);
    }
  }, [selectedEventId, refreshLocalStats]);

  // 4. Unduh Manifest Tiket (Tahap 1)
  const downloadManifest = useCallback(async (eventId = selectedEventIdRef.current) => {
    if (!eventId) return;
    if (!navigator.onLine) {
      setStatusMsg("Tidak dapat mengunduh manifest saat offline. Menggunakan data yang sudah ada di IndexedDB.");
      return;
    }

    setLoadingManifest(true);
    setStatusMsg("Mengunduh manifest tiket acara dari server…");

    try {
      const res = await api(`/api/eo/manifest?eventId=${eventId}`);
      const count = await saveManifestToDb(eventId, res.manifest);
      downloadedEventsRef.current.add(eventId);
      setLocalTicketCount(count);
      setStatusMsg(`Berhasil mengunduh & menyimpan ${count} data tiket ke penyimpanan luring (IndexedDB).`);
      await refreshLocalStats(eventId);
    } catch (e) {
      setStatusMsg(`Gagal mengunduh manifest: ${e.message}`);
    } finally {
      setLoadingManifest(false);
    }
  }, [refreshLocalStats]);

  // Auto-download manifest jika belum diunduh saat online
  useEffect(() => {
    if (
      selectedEventId &&
      localTicketCount === 0 &&
      isOnline &&
      userRole === "eo" &&
      !downloadedEventsRef.current.has(selectedEventId)
    ) {
      downloadedEventsRef.current.add(selectedEventId);
      downloadManifest(selectedEventId);
    }
  }, [selectedEventId, localTicketCount, isOnline, userRole, downloadManifest]);

  // 5. Sinkronisasi Antrean Offline ke Server (Tahap 3)
  const syncPendingQueue = useCallback(async () => {
    if (!navigator.onLine) {
      setStatusMsg("Perangkat masih offline. Sinkronisasi akan otomatis berjalan saat online.");
      return;
    }
    try {
      const targetEventId = selectedEventIdRef.current || null;
      const queue = await getOfflineQueue(targetEventId);
      if (queue.length === 0) {
        return;
      }

      setStatusMsg(`Mengirim ${queue.length} data check-in ke server…`);
      // Kelompokkan per event_id agar sinkronisasi aman lintas acara
      const byEvent = new Map();
      for (const q of queue) {
        if (!byEvent.has(q.event_id)) byEvent.set(q.event_id, []);
        byEvent.get(q.event_id).push(q);
      }

      let totalSynced = 0;
      const syncedIds = [];
      for (const [evId, items] of byEvent.entries()) {
        const res = await api("/api/eo/check-in/sync", {
          method: "POST",
          body: JSON.stringify({
            eventId: evId,
            checkins: items.map((q) => ({
              tokenId: q.token_id,
              checkedInAt: q.checked_in_at,
            })),
          }),
        });
        if (res.success) {
          totalSynced += res.syncedCount || items.length;
          items.forEach((i) => syncedIds.push(i.id));
        }
      }

      if (syncedIds.length > 0) {
        await clearSyncedFromQueue(syncedIds);
        setStatusMsg(`Sinkronisasi sukses! ${totalSynced} tiket tersinkronkan ke Supabase.`);
        if (selectedEventIdRef.current) {
          await refreshLocalStats(selectedEventIdRef.current);
        }
      }
    } catch (e) {
      setStatusMsg(`Gagal sinkronisasi antrean: ${e.message}`);
    }
  }, [refreshLocalStats]);

  // 6. Deteksi Status Jaringan (Online / Offline)
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      setStatusMsg("Koneksi tersambung kembali. Memulai sinkronisasi otomatis…");
      syncPendingQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setStatusMsg("Perangkat beralih ke Mode Offline (Luring).");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncPendingQueue]);

  // 7. Validasi Kriptografis TOTP Offline (Tahap 2)
  const processTicketValidation = useCallback(async (tokenIdInput, otpInput) => {
    const rawTokenId = String(tokenIdInput || "").trim();
    const rawOtp = String(otpInput || "").trim();

    if (!rawTokenId || !rawOtp) {
      setScanResult({
        type: "error",
        title: "DATA PEMINDAIAN TIDAK LENGKAP",
        message: "Token ID atau Kode OTP tidak ditemukan pada payload QR.",
      });
      return;
    }

    try {
      // Langkah 1: Cari ticketId / tokenId pada IndexedDB lokal
      const ticket = await getLocalTicket(rawTokenId);
      if (!ticket) {
        setScanResult({
          type: "not_found",
          title: "TIKET TIDAK VALID / TIDAK DITEMUKAN",
          message: `Tiket dengan Token ID #${rawTokenId} tidak terdaftar pada acara ini.`,
          tokenId: rawTokenId,
        });
        return;
      }

      if (selectedEventIdRef.current && ticket.event_id !== selectedEventIdRef.current) {
        setScanResult({
          type: "not_found",
          title: "TIKET ACARA BERBEDA",
          message: `Tiket #${ticket.token_id} adalah milik acara "${ticket.event_name || "lain"}", bukan acara yang sedang dipilih.`,
          tokenId: ticket.token_id,
        });
        return;
      }

      // Langkah 2: Cek apakah sudah pernah check-in sebelumnya
      if (ticket.checked_in_at) {
        const usedTime = new Date(ticket.checked_in_at).toLocaleString("id-ID", {
          dateStyle: "medium",
          timeStyle: "medium",
        });
        setScanResult({
          type: "already_used",
          title: "TIKET SUDAH DIGUNAKAN",
          message: `Tiket ini telah dipindai sebelumnya pada: ${usedTime}. Akses masuk ditolak untuk mencegah duplikasi.`,
          tokenId: ticket.token_id,
          buyerName: ticket.buyer_name,
          usedTime,
        });
        return;
      }

      // Langkah 3: Validasi Kriptografis TOTP terhadap totp_secret tiket
      const isValidOtp = await verifyTotp(rawOtp, ticket.totp_secret, { window: 1 });
      if (!isValidOtp) {
        setScanResult({
          type: "invalid_code",
          title: "KODE QR KEDALUWARSA / TIDAK SAH",
          message: "Kode OTP 6-digit tidak valid atau telah berganti (kedaluwarsa). Pastikan pembeli menampilkan layar tiket aktif.",
          tokenId: ticket.token_id,
          buyerName: ticket.buyer_name,
        });
        return;
      }

      // Langkah 4: Valid! Tandai instan di IndexedDB lokal & masukkan ke antrean
      const checkInTime = new Date().toISOString();
      await recordLocalCheckIn(ticket.token_id, ticket.event_id, checkInTime);

      setScanResult({
        type: "success",
        title: "TIKET VALID — SILAKAN MASUK",
        message: "Verifikasi kriptografis TOTP berhasil. Peserta diizinkan masuk ke venue acara.",
        tokenId: ticket.token_id,
        buyerName: ticket.buyer_name,
        buyerEmail: ticket.buyer_email,
        checkInTime: new Date(checkInTime).toLocaleString("id-ID", {
          dateStyle: "medium",
          timeStyle: "medium",
        }),
      });

      await refreshLocalStats(ticket.event_id);

      if (navigator.onLine) {
        syncPendingQueue();
      }
    } catch (err) {
      setScanResult({
        type: "error",
        title: "KESALAHAN SISTEM VALIDASI",
        message: err.message || "Terjadi kesalahan saat membaca database lokal.",
      });
    }
  }, [refreshLocalStats, syncPendingQueue]);

  // Handler scan QR payload
  const handlePayloadScanned = useCallback((payloadStr) => {
    try {
      const data = JSON.parse(payloadStr);
      const tokenId = data.tokenId || data.t || data.ticketId;
      const otp = data.otp || data.c || data.code;
      if (tokenId && otp) {
        processTicketValidation(tokenId, otp);
        return;
      }
    } catch {}

    const parts = String(payloadStr || "").split(":");
    if (parts.length === 2) {
      processTicketValidation(parts[0].trim(), parts[1].trim());
    } else {
      setScanResult({
        type: "error",
        title: "FORMAT QR TIDAK DIKENALI",
        message: `Payload QR: ${String(payloadStr || "").slice(0, 80)}`,
      });
    }
  }, [processTicketValidation]);

  const handlePayloadRef = useRef(handlePayloadScanned);
  useEffect(() => {
    handlePayloadRef.current = handlePayloadScanned;
  }, [handlePayloadScanned]);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setDecoderMode("");
  }, []);

  // 8. Integrasi Kamera Scanner Web (jsQR lintas browser + BarcodeDetector fast-path)
  const startCamera = async () => {
    setCameraError("");
    setCameraActive(true);
    scanningRef.current = true;

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      if (!scanningRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Gunakan BarcodeDetector hanya jika benar-benar tersedia & mendukung qr_code;
      // jika tidak (seperti Edge/Chrome/Firefox desktop Windows), otomatis pakai jsQR.
      let nativeDetector = null;
      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        try {
          const formats = window.BarcodeDetector.getSupportedFormats
            ? await window.BarcodeDetector.getSupportedFormats()
            : ["qr_code"];
          if (formats.includes("qr_code")) {
            nativeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
          }
        } catch {
          nativeDetector = null;
        }
      }

      setDecoderMode(nativeDetector ? "Native BarcodeDetector" : "jsQR Offline Decoder");

      const scanFrame = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        let detected = null;

        try {
          const video = videoRef.current;
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            if (nativeDetector) {
              const barcodes = await nativeDetector.detect(video);
              if (barcodes.length > 0 && barcodes[0].rawValue) {
                detected = barcodes[0].rawValue;
              }
            }

            // Fallback / decoder universal berbasis Canvas + jsQR (berjalan penuh di semua browser & offline)
            if (!detected) {
              const canvas = canvasRef.current || document.createElement("canvas");
              canvasRef.current = canvas;
              const maxWidth = 640;
              const scale = Math.min(1, maxWidth / video.videoWidth);
              const w = Math.max(1, Math.floor(video.videoWidth * scale));
              const h = Math.max(1, Math.floor(video.videoHeight * scale));
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
              }
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const imageData = ctx.getImageData(0, 0, w, h);
                const qr = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
                if (qr?.data) {
                  detected = qr.data;
                }
              }
            }
          }
        } catch {}

        if (detected) {
          handlePayloadRef.current(detected);
          if (scanningRef.current) {
            loopTimerRef.current = setTimeout(scanFrame, 2000);
          }
          return;
        }

        if (scanningRef.current) {
          loopTimerRef.current = setTimeout(scanFrame, 150);
        }
      };

      loopTimerRef.current = setTimeout(scanFrame, 150);
    } catch (e) {
      setCameraError(`Gagal mengakses kamera: ${e.message}. Gunakan input manual kode tiket & OTP di bawah.`);
      stopCamera();
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualTokenId || !manualOtp) return;
    processTicketValidation(manualTokenId, manualOtp);
  };

  if (!authChecked) {
    return <div className="wrap muted">Memeriksa hak akses…</div>;
  }

  if (userRole !== "eo") {
    return (
      <div className="wrap stack">
        <h1>Scanner Tiket EO</h1>
        <div className="notice bad">
          Halaman ini khusus untuk akun dengan role <strong>Event Organizer (EO)</strong>.
          {userRole ? ` Role Anda saat ini: ${userRole}.` : " Anda belum masuk."}
        </div>
        <div className="row">
          <Link href="/login?next=/eo/scanner" className="btn sm">
            Masuk dengan Akun EO
          </Link>
          <Link href="/" className="btn ghost sm">
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    );
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="wrap stack">
      <div className="row between">
        <div>
          <span className="eyebrow"><i /> PETUGAS PINTU MASUK</span>
          <h1 style={{ marginBottom: "0.2rem" }}>Scanner Tiket Luring (Offline-First)</h1>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            Validasi kriptografis QR TOTP secara instan di pintu masuk tanpa ketergantungan internet.
          </p>
        </div>
        <Link href="/eo/dashboard" className="btn ghost sm">
          Lihat Laporan Kehadiran →
        </Link>
      </div>

      {/* INDIKATOR STATUS JARINGAN & SINKRONISASI */}
      <div className="card row between" style={{ background: isOnline ? "#32443a" : "#4a3c30" }}>
        <div className="row" style={{ gap: "0.8rem" }}>
          <span
            className="badge"
            style={{
              background: isOnline ? "var(--ok)" : "var(--warn)",
              color: "#18181b",
              border: 0,
              padding: "0.3rem 0.7rem",
            }}
          >
            {isOnline ? "● Status: Online" : "○ Status: Mode Offline (Luring)"}
          </span>
          <span style={{ fontSize: "0.9rem" }}>
            <strong>{localTicketCount}</strong> tiket tersimpan di IndexedDB
            {queueCount > 0 && (
              <span style={{ color: "var(--warn)", marginLeft: "0.5rem" }}>
                · <strong>{queueCount}</strong> check-in menunggu sinkronisasi
              </span>
            )}
          </span>
        </div>

        <div className="row" style={{ gap: "0.5rem" }}>
          <button
            type="button"
            className="btn ghost sm"
            disabled={!isOnline || loadingManifest}
            onClick={() => downloadManifest(selectedEventId)}
            title="Perbarui data tiket lokal dari server"
          >
            {loadingManifest ? "Mengunduh…" : "Unduh Manifest (Sync)"}
          </button>
          {queueCount > 0 && (
            <button
              type="button"
              className="btn sm"
              disabled={!isOnline}
              onClick={syncPendingQueue}
              title="Kirim data check-in lokal ke server"
            >
              Sinkronkan Sekarang ({queueCount})
            </button>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="notice" style={{ fontSize: "0.88rem", padding: "0.5rem 0.8rem" }}>
          {statusMsg}
        </div>
      )}

      {/* PEMILIH ACARA */}
      <div className="card stack">
        <div className="field">
          <label htmlFor="eo-event-select">Pilih Acara yang Dikelola</label>
          <select
            id="eo-event-select"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({new Date(ev.event_date).toLocaleDateString("id-ID")}) · Kuota: {ev.max_supply}
              </option>
            ))}
          </select>
        </div>

        {selectedEvent && (
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Lokasi: <strong>{selectedEvent.venue}</strong> · Tanggal:{" "}
            <strong>
              {new Date(selectedEvent.event_date).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </strong>
          </div>
        )}
      </div>

      {/* HASIL PEMINDAIAN */}
      {scanResult && (
        <div
          className="card stack"
          style={{
            borderWidth: "2.5px",
            borderColor:
              scanResult.type === "success"
                ? "var(--ok)"
                : scanResult.type === "already_used"
                ? "var(--warn)"
                : "var(--bad)",
            background:
              scanResult.type === "success"
                ? "rgba(169, 227, 194, 0.12)"
                : scanResult.type === "already_used"
                ? "rgba(255, 211, 138, 0.12)"
                : "rgba(255, 170, 167, 0.12)",
          }}
        >
          <div className="row between">
            <h2
              style={{
                margin: 0,
                color:
                  scanResult.type === "success"
                    ? "var(--ok)"
                    : scanResult.type === "already_used"
                    ? "var(--warn)"
                    : "var(--bad)",
              }}
            >
              {scanResult.title}
            </h2>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setScanResult(null)}
            >
              Tutup ✕
            </button>
          </div>

          <p style={{ margin: "0.3rem 0", fontSize: "1rem" }}>{scanResult.message}</p>

          {scanResult.tokenId && (
            <div className="row" style={{ gap: "1.2rem", fontSize: "0.9rem" }}>
              <div>Token ID NFT: <strong>#{scanResult.tokenId}</strong></div>
              {scanResult.buyerName && <div>Nama: <strong>{scanResult.buyerName}</strong></div>}
              {scanResult.buyerEmail && <div>Email: <strong>{scanResult.buyerEmail}</strong></div>}
              {scanResult.checkInTime && <div>Waktu Masuk: <strong>{scanResult.checkInTime}</strong></div>}
            </div>
          )}
        </div>
      )}

      {/* TAMPILAN PEMINDAI KAMERA */}
      <div className="card stack">
        <div className="row between">
          <div>
            <h2 style={{ marginBottom: "0.15rem" }}>Pemindai Kamera</h2>
            {decoderMode && (
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                Mode pemindai aktif: {decoderMode}
              </span>
            )}
          </div>
          <div className="row" style={{ gap: "0.5rem" }}>
            {!cameraActive ? (
              <button type="button" className="btn sm" onClick={startCamera}>
                Nyalakan Kamera
              </button>
            ) : (
              <button type="button" className="btn danger sm" onClick={stopCamera}>
                Matikan Kamera
              </button>
            )}
          </div>
        </div>

        {cameraError && <div className="notice bad">{cameraError}</div>}

        {cameraActive && (
          <div
            style={{
              position: "relative",
              maxWidth: 420,
              margin: "0 auto",
              borderRadius: 12,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <video
              ref={videoRef}
              style={{ width: "100%", height: 320, objectFit: "cover" }}
              playsInline
              muted
            />
            <div
              style={{
                position: "absolute",
                inset: "22%",
                border: "2px dashed var(--accent)",
                borderRadius: 8,
                pointerEvents: "none",
              }}
            />
          </div>
        )}
      </div>

      {/* INPUT MANUAL UNTUK PENGUJIAN DESKTOP & GUEST TANPA KAMERA */}
      <div className="card stack">
        <h2>Input Manual Kode Tiket &amp; OTP (Pengujian Tanpa Kamera)</h2>
        <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
          Gunakan formulir ini untuk menguji verifikasi offline di desktop atau jika kamera perangkat tidak tersedia.
        </p>

        <form onSubmit={handleManualSubmit} className="stack">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label htmlFor="m-token">Token ID NFT</label>
              <input
                id="m-token"
                type="number"
                placeholder="Contoh: 9001"
                required
                value={manualTokenId}
                onChange={(e) => setManualTokenId(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label htmlFor="m-otp">Kode OTP (6 digit)</label>
              <input
                id="m-otp"
                type="text"
                maxLength={6}
                placeholder="Contoh: 123456"
                required
                value={manualOtp}
                onChange={(e) => setManualOtp(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn sm">
              Validasi Tiket Secara Luring
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
