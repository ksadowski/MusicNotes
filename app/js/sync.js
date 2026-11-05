/* Łączenie danych z kilku urządzeń.
   Każda piosenka ma `updated` (ms) – czas ostatniej zmiany treści.
   Usunięte piosenki zostawiają „nagrobek” w `deleted` {id: czas usunięcia}, żeby usunięcie też się zsynchronizowało. */

const TOMBSTONE_TTL = 180 * 24 * 3600 * 1000; // po pół roku nagrobek znika

const content = s => { const { updated, ...rest } = s; return JSON.stringify(rest); };

/** Pilnuje, które piosenki naprawdę zmieniły treść (samo otwarcie piosenki nic nie zmienia). */
export function createTracker(state) {
  let snap = new Map();
  const reset = () => { snap = new Map(state.songs.map(s => [s.id, content(s)])); };
  reset();
  return {
    reset,
    /** Ustawia `updated` zmienionym/nowym piosenkom i nagrobki usuniętym. Zwraca true, gdy coś się zmieniło. */
    mark() {
      const now = Date.now(), seen = new Set();
      let changed = false;
      if (!state.deleted) state.deleted = {};
      for (const s of state.songs) {
        seen.add(s.id);
        const c = content(s);
        if (snap.get(s.id) !== c) { s.updated = now; snap.set(s.id, c); changed = true; delete state.deleted[s.id]; }
      }
      for (const id of [...snap.keys()]) if (!seen.has(id)) { state.deleted[id] = now; snap.delete(id); changed = true; }
      return changed;
    }
  };
}

/** Łączy listy piosenek: wygrywa nowsza wersja każdej piosenki, usunięcie wygrywa z wcześniejszą edycją. */
export function mergeData(local, remote) {
  const now = Date.now();
  const deleted = {};
  for (const src of [local.deleted || {}, remote.deleted || {}])
    for (const id in src) if (now - src[id] < TOMBSTONE_TTL) deleted[id] = Math.max(deleted[id] || 0, src[id]);

  const best = new Map();
  for (const s of remote.songs || []) best.set(s.id, s);
  for (const s of local.songs || []) {
    const r = best.get(s.id);
    if (!r || (s.updated || 0) >= (r.updated || 0)) best.set(s.id, s);
  }
  const alive = s => !(deleted[s.id] >= (s.updated || 0));
  for (const [id, s] of best) if (alive(s)) delete deleted[id];

  // kolejność: najpierw nowe piosenki z drugiego urządzenia, potem kolejność lokalna
  const localIds = new Set((local.songs || []).map(s => s.id));
  const order = [...(remote.songs || []).filter(s => !localIds.has(s.id)).map(s => s.id), ...(local.songs || []).map(s => s.id)];
  const songs = [...new Set(order)].map(id => best.get(id)).filter(s => s && alive(s));
  return { songs, deleted };
}

export const payloadOf = st => ({ app: 'notatnik-form', version: 2, songs: st.songs, deleted: st.deleted || {} });
export const samePayload = (a, b) => JSON.stringify(a.songs) === JSON.stringify(b.songs) && JSON.stringify(a.deleted || {}) === JSON.stringify(b.deleted || {});
