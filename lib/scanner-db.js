// IndexedDB Helper untuk Scanner Offline EO TixFour
// Mengelola penyimpanan manifest tiket & antrean check-in luring

const DB_NAME = "tixfour_scanner_db";
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB tidak didukung pada browser ini."));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store tiket terunduh
      if (!db.objectStoreNames.contains("tickets")) {
        const ticketStore = db.createObjectStore("tickets", { keyPath: "token_id" });
        ticketStore.createIndex("event_id", "event_id", { unique: false });
        ticketStore.createIndex("ticket_id", "ticket_id", { unique: false });
      }

      // Store antrean check-in luring
      if (!db.objectStoreNames.contains("offline_checkin_queue")) {
        const queueStore = db.createObjectStore("offline_checkin_queue", {
          keyPath: "id",
          autoIncrement: true,
        });
        queueStore.createIndex("event_id", "event_id", { unique: false });
        queueStore.createIndex("token_id", "token_id", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Menyimpan atau memperbarui manifest tiket acara ke IndexedDB
 */
export async function saveManifestToDb(eventId, manifest = []) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tickets"], "readwrite");
    const store = tx.objectStore("tickets");

    for (const item of manifest) {
      store.put({
        token_id: Number(item.token_id),
        ticket_id: item.ticket_id,
        event_id: eventId,
        event_name: item.event_name,
        order_id: item.order_id,
        buyer_email: item.buyer_email,
        buyer_name: item.buyer_name,
        totp_secret: item.totp_secret,
        checked_in_at: item.checked_in_at || null,
        checked_in_by: item.checked_in_by || null,
      });
    }

    tx.oncomplete = () => resolve(manifest.length);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Mengambil tiket dari IndexedDB berdasarkan tokenId (atau ticketId)
 */
export async function getLocalTicket(tokenOrId) {
  const db = await openDb();
  const numId = Number(tokenOrId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tickets"], "readonly");
    const store = tx.objectStore("tickets");

    if (!Number.isNaN(numId) && numId > 0) {
      const req = store.get(numId);
      req.onsuccess = () => {
        if (req.result) return resolve(req.result);
        // Coba cari via index ticket_id
        searchByTicketId();
      };
      req.onerror = () => searchByTicketId();
    } else {
      searchByTicketId();
    }

    function searchByTicketId() {
      const idx = store.index("ticket_id");
      const req2 = idx.get(String(tokenOrId));
      req2.onsuccess = () => resolve(req2.result || null);
      req2.onerror = () => reject(req2.error);
    }
  });
}

/**
 * Menandai tiket sudah check-in di IndexedDB lokal dan menambahkan ke antrean offline
 */
export async function recordLocalCheckIn(tokenId, eventId, checkedInAt = new Date().toISOString()) {
  const db = await openDb();
  const numTokenId = Number(tokenId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tickets", "offline_checkin_queue"], "readwrite");
    const ticketStore = tx.objectStore("tickets");
    const queueStore = tx.objectStore("offline_checkin_queue");

    const getReq = ticketStore.get(numTokenId);
    getReq.onsuccess = () => {
      const ticket = getReq.result;
      if (ticket) {
        ticket.checked_in_at = checkedInAt;
        ticketStore.put(ticket);
      }

      // Masukkan ke antrean sinkronisasi
      queueStore.add({
        token_id: numTokenId,
        event_id: eventId,
        checked_in_at: checkedInAt,
        created_at: new Date().toISOString(),
      });
    };

    tx.oncomplete = () => resolve({ ok: true, tokenId: numTokenId, checkedInAt });
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Mengambil seluruh tiket lokal untuk suatu acara
 */
export async function getLocalTicketsForEvent(eventId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tickets"], "readonly");
    const store = tx.objectStore("tickets");
    const idx = store.index("event_id");
    const req = idx.getAll(eventId);

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Mengambil antrean check-in yang belum tersinkronisasi ke server
 */
export async function getOfflineQueue(eventId = null) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["offline_checkin_queue"], "readonly");
    const store = tx.objectStore("offline_checkin_queue");
    const req = store.getAll();

    req.onsuccess = () => {
      let items = req.result || [];
      if (eventId) {
        items = items.filter((x) => x.event_id === eventId);
      }
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Menghapus antrean yang telah berhasil tersinkronisasi
 */
export async function clearSyncedFromQueue(queueIds = []) {
  if (!queueIds.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["offline_checkin_queue"], "readwrite");
    const store = tx.objectStore("offline_checkin_queue");

    for (const id of queueIds) {
      store.delete(id);
    }

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
