"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { rupiah } from "@/lib/pricing";

const filters = [
  { id: "all", label: "Semua acara" },
  { id: "upcoming", label: "Akan datang" },
  { id: "month", label: "Bulan ini" },
];

const posterStyles = ["poster-blue", "poster-pink", "poster-lilac", "poster-orange"];

function eventDate(date) {
  return new Date(date).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function Home() {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    supabase.from("events").select("*").order("event_date").then(({ data, error }) => {
      if (error) setErr(error.message);
      else setEvents(data);
    });
  }, []);

  const visibleEvents = useMemo(() => {
    if (!events) return [];
    const now = new Date();
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");

    return events.filter((event) => {
      const date = new Date(event.event_date);
      const matchesQuery = !normalizedQuery
        || [event.name, event.venue, event.description]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase("id-ID").includes(normalizedQuery));
      const matchesDate = filter === "all"
        || (filter === "upcoming" && date >= now)
        || (filter === "month" && date >= now
          && date.getMonth() === now.getMonth()
          && date.getFullYear() === now.getFullYear());

      return matchesQuery && matchesDate;
    });
  }, [events, filter, query]);

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow"><i /> TEMUKAN MOMEN BERIKUTNYA</span>
            <h1>Rayakan Hari Ini,<br /><span>Abadi Selamanya.</span></h1>
            <p>
              Cari konser dan acara favoritmu. Tiket digital aman, praktis, dan selalu siap
              di genggaman.
            </p>
            <a className="hero-cta" href="#discover">Jelajahi acara <span aria-hidden="true">↓</span></a>
            <div className="hero-proof">
              <span className="proof-mark" aria-hidden="true">✓</span>
              <span>Tiket terverifikasi di blockchain</span>
            </div>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="art-glow" />
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-star star-one">✳</div>
            <div className="art-star star-two">✦</div>
            <div className="art-ticket">
              <div className="art-ticket-top">
                <span>TIXFOUR PRESENTS</span>
                <strong>MAKE<br />TONIGHT<br />MATTER.</strong>
                <i className="art-ticket-spark">✳</i>
              </div>
              <div className="art-ticket-bottom">
                <span>LIVE • TOGETHER • ALWAYS</span>
                <span className="art-barcode" />
              </div>
            </div>
            <span className="art-caption">YOUR NEXT<br />GREAT NIGHT</span>
          </div>
        </div>

        <form className="search-panel" onSubmit={(event) => {
          event.preventDefault();
          document.getElementById("discover")?.scrollIntoView({ behavior: "smooth" });
        }}>
          <label className="search-label" htmlFor="event-search">
            <span className="search-icon" aria-hidden="true" />
            <span className="search-field">
              <strong>Cari pengalaman</strong>
              <input
                id="event-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nama acara, artis, atau lokasi"
              />
            </span>
          </label>
          <button type="submit" className="search-button">Cari acara</button>
        </form>
      </section>

      <section className="discover-section" id="discover">
        <div className="discover-heading">
          <div>
            <span className="section-kicker">PILIH ACARAMU</span>
            <h2>Hal seru dimulai di sini.</h2>
            <p>Temukan acara untuk mengisi kalender dan bikin cerita baru.</p>
          </div>
        </div>

        <div className="category-row" role="group" aria-label="Filter acara">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`category-chip${filter === item.id ? " active" : ""}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {err && <div className="notice bad">{err}</div>}
        {events === null && !err && <p className="muted">Memuat acara…</p>}
        {events?.length === 0 && (
          <div className="empty-events">
            <span aria-hidden="true">✳</span>
            <strong>Acara seru segera hadir.</strong>
            <p>Admin bisa menambahkan acara baru dari halaman Admin.</p>
          </div>
        )}
        {events?.length > 0 && visibleEvents.length === 0 && (
          <div className="empty-events">
            <span aria-hidden="true">⌕</span>
            <strong>Belum ada acara yang cocok.</strong>
            <p>Coba kata kunci atau filter tanggal yang berbeda.</p>
          </div>
        )}

        <div className="event-grid" id="event-list">
          {visibleEvents.map((event, index) => (
            <Link key={event.id} href={`/events/${event.id}`} className="event-card">
              <div className={`event-poster ${posterStyles[index % posterStyles.length]}`}>
                <span className="poster-label">TIXFOUR LIVE</span>
                <span className="poster-shape" aria-hidden="true" />
                <span className="poster-date">{eventDate(event.event_date)}</span>
                <span className="poster-arrow" aria-hidden="true">↗</span>
              </div>
              <div className="event-card-info">
                <span className="event-location">{event.venue || "Indonesia"} <i>·</i> LIVE EVENT</span>
                <h3>{event.name}</h3>
                {event.description && <p>{event.description}</p>}
                <div className="event-card-footer">
                  <span>Mulai dari <strong>{rupiah(event.price)}</strong></span>
                  <span className="event-card-link">Lihat acara <b aria-hidden="true">→</b></span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="ticket-promise">
        <div className="promise-icon" aria-hidden="true">✳</div>
        <div>
          <span className="section-kicker">TENANG, TIKETMU AMAN</span>
          <h2>Lebih banyak momen.<br />Lebih sedikit khawatir.</h2>
          <p>
            Tiket tercatat di blockchain dan QR berubah setiap 30 detik untuk melindungi
            pengalamanmu. Tiketmu tetap bisa diakses saat offline.
          </p>
        </div>
        <Link href="/tickets" className="promise-link">Lihat tiket saya <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  );
}
