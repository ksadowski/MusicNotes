/* Dysk Google: logowanie (Google Identity Services, token na ~1 h) i jeden plik z danymi.
   Uprawnienie drive.file – aplikacja widzi tylko pliki, które sama utworzyła. Plik jest widoczny na Dysku. */
import { GOOGLE_CLIENT_ID } from './config.js';

export const SYNC_FILE = 'notatnik-form-synchronizacja.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_LS = 'notatnik-form.gtoken';
const CONSENT_LS = 'notatnik-form.gconsent';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export const enabled = () => !!GOOGLE_CLIENT_ID;

let token = null;
try {
  const t = JSON.parse(localStorage.getItem(TOKEN_LS));
  if (t && t.exp > Date.now() + 60000) token = t;
} catch (e) {}

export const hasToken = () => !!token && token.exp > Date.now() + 30000;
export function forgetToken() { token = null; try { localStorage.removeItem(TOKEN_LS); } catch (e) {} }

let gisP = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gisP) return gisP;
  gisP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisP = null; reject(new Error('Nie udało się połączyć z Google. Sprawdź internet.')); };
    document.head.appendChild(s);
  });
  return gisP;
}

/** Wczytuje bibliotekę logowania wcześniej, żeby okno logowania otworzyło się od razu po stuknięciu. */
export function preload() { if (enabled() && navigator.onLine) loadGis().catch(() => {}); }

/** Prosi o token. Musi być wywołane bezpośrednio po stuknięciu (otwiera okno Google). */
export async function signIn() {
  await loadGis();
  const consented = localStorage.getItem(CONSENT_LS) === '1';
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: r => {
        if (r.error) return reject(new Error('Google odmówił dostępu: ' + r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(new Error('Bez zgody na dostęp do Dysku synchronizacja nie zadziała.'));
        token = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        try { localStorage.setItem(TOKEN_LS, JSON.stringify(token)); localStorage.setItem(CONSENT_LS, '1'); } catch (e) {}
        resolve();
      },
      error_callback: e => reject(new Error(e && e.type === 'popup_closed' ? 'Zamknięto okno logowania.' : 'Logowanie nie powiodło się.'))
    });
    client.requestAccessToken({ prompt: consented ? '' : 'consent' });
  });
}

export async function signOut() {
  const t = token; forgetToken();
  try { localStorage.removeItem(CONSENT_LS); } catch (e) {}
  if (t) try { await loadGis(); google.accounts.oauth2.revoke(t.value, () => {}); } catch (e) {}
}

export class AuthError extends Error {}

async function call(url, opts = {}) {
  if (!hasToken()) throw new AuthError('Trzeba ponownie zalogować się do Google.');
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token.value } });
  if (res.status === 401) { forgetToken(); throw new AuthError('Sesja Google wygasła. Zaloguj się ponownie.'); }
  if (!res.ok) throw new Error(`Dysk Google: błąd ${res.status}`);
  return res;
}

/** Szuka pliku synchronizacji (utworzonego przez tę aplikację). Zwraca id albo null. */
export async function findFile() {
  const q = encodeURIComponent(`name='${SYNC_FILE}' and trashed=false`);
  const r = await call(`${API}?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id)`);
  const { files } = await r.json();
  return files && files[0] ? files[0].id : null;
}

/** Czyta plik. Zwraca null, gdy pliku już nie ma (np. usunięty na Dysku). */
export async function readFile(id) {
  try {
    const r = await call(`${API}/${id}?alt=media`, { cache: 'no-store' });
    return await r.json();
  } catch (e) {
    if (/błąd 404/.test(e.message)) return null;
    throw e;
  }
}

export async function createFile(data) {
  const boundary = 'nf' + Math.random().toString(36).slice(2);
  const meta = { name: SYNC_FILE, mimeType: 'application/json', description: 'Dane aplikacji Notatnik form. Nie edytuj ręcznie.' };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const r = await call(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
  return (await r.json()).id;
}

export async function updateFile(id, data) {
  await call(`${UPLOAD}/${id}?uploadType=media`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
}
