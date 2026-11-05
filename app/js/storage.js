/* Zapis danych: IndexedDB (jeden rekord ze stanem), awaryjnie localStorage.
   Zapis jest odkładany o chwilę, żeby nie pisać na każdy wciśnięty klawisz. */

const DB_NAME = 'musicnotes';
const STORE = 'kv';
const KEY = 'state';
const LEGACY_LS = 'notatnik-form.v1'; // localStorage z prototypu
const FALLBACK_LS = 'musicnotes.state';

let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Brak IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB zablokowana'));
  });
  return dbp;
}

function idbGet() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
function idbPut(value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

let useIDB = true;

/** Wczytuje stan. Przy pierwszym uruchomieniu przenosi dane z prototypu (localStorage). */
export async function loadState() {
  let st = null;
  try { st = await idbGet(); } catch (e) { useIDB = false; }
  if (!useIDB) st = lsGet(FALLBACK_LS);
  if (!st) {
    const legacy = lsGet(LEGACY_LS);
    if (legacy && Array.isArray(legacy.songs)) {
      st = { songs: legacy.songs, currentId: legacy.currentId || null };
      // usuwa przykładowe piosenki z pierwszych wersji prototypu
      if (!legacy.demoRemoved) {
        const demo = ['Nocny pociąg', 'Ballada w D', 'Riff na próbę'];
        st.songs = st.songs.filter(s => !demo.includes(s.title));
      }
      await writeNow(st);
    }
  }
  return st;
}

async function writeNow(st) {
  const snapshot = JSON.parse(JSON.stringify(st));
  if (useIDB) {
    try { await idbPut(snapshot); return; } catch (e) { useIDB = false; }
  }
  try { localStorage.setItem(FALLBACK_LS, JSON.stringify(snapshot)); } catch (e) {}
}

let timer = null, pending = null;
/** Odkłada zapis o 250 ms; kolejne wywołania w tym czasie łączą się w jeden zapis. */
export function scheduleSave(st) {
  pending = st;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
export function flush() {
  clearTimeout(timer); timer = null;
  if (!pending) return Promise.resolve();
  const st = pending; pending = null;
  return writeNow(st);
}
// zapis przed schowaniem/zamknięciem aplikacji
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

/** Prosi przeglądarkę, żeby nie usuwała danych. Zwraca true/false albo null, gdy nieobsługiwane. */
export async function requestPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return null; }
}
