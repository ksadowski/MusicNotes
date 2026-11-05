/* Dysk Google: logowanie (przekierowanie OAuth, token na ~1 h) i jeden plik z danymi.
   Uprawnienie drive.file – aplikacja widzi tylko pliki, które sama utworzyła. Plik jest widoczny na Dysku. */
import { GOOGLE_CLIENT_ID } from './config.js';

export const SYNC_FILE = 'musicnotes-sync.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_LS = 'musicnotes.gtoken';
const CONSENT_LS = 'musicnotes.gconsent';
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

/* Logowanie przez przekierowanie (OAuth 2.0, przepływ „token”): strona przechodzi do Google i wraca
   z tokenem w adresie (#access_token=…). Bez okienek – okienka zawodzą w zainstalowanej PWA i potrafią
   fałszywie zgłaszać „zamknięto okno”. Adres powrotu musi być wpisany w Google Cloud jako
   „Autoryzowany identyfikator URI przekierowania”. */
const STATE_SS = 'musicnotes.oauthState';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Adres powrotu = adres aplikacji bez index.html, np. https://ksadowski.github.io/MusicNotes/ */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

/** Przechodzi do Google. Strona zostaje opuszczona – dane trzeba zapisać wcześniej. */
export function signIn() {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem(STATE_SS, state); } catch (e) {}
  const consented = localStorage.getItem(CONSENT_LS) === '1';
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state
  });
  if (!consented) p.set('prompt', 'consent');
  location.assign(`${AUTH_URL}?${p}`);
}

/** Wywołać na starcie, zanim ktokolwiek ruszy historię. Zwraca null (to nie powrót z Google),
    {ok:true} albo {ok:false, error}. Czyści token z paska adresu. */
export function handleRedirect() {
  const h = location.hash;
  if (!/[#&](access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let expected = null;
  try { expected = sessionStorage.getItem(STATE_SS); sessionStorage.removeItem(STATE_SS); } catch (e) {}
  if (!expected || p.get('state') !== expected) return { ok: false, error: 'Odpowiedź Google nie pasuje do logowania z tej karty. Spróbuj jeszcze raz.' };
  if (p.get('error')) return { ok: false, error: p.get('error') === 'access_denied' ? 'Nie zgodzono się na dostęp do Dysku.' : 'Google odmówił dostępu: ' + p.get('error') };
  const scopes = (p.get('scope') || '').split(' ');
  if (!scopes.includes(SCOPE)) {
    try { localStorage.removeItem(CONSENT_LS); } catch (e) {}
    return { ok: false, error: 'Nie zaznaczono zgody na dostęp do Dysku. Spróbuj jeszcze raz i w oknie Google zaznacz pole przy Dysku Google.' };
  }
  token = { value: p.get('access_token'), exp: Date.now() + (parseInt(p.get('expires_in'), 10) || 3600) * 1000 };
  try { localStorage.setItem(TOKEN_LS, JSON.stringify(token)); localStorage.setItem(CONSENT_LS, '1'); } catch (e) {}
  return { ok: true };
}

export function signOut() {
  const t = token; forgetToken();
  try { localStorage.removeItem(CONSENT_LS); } catch (e) {}
  if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.value), { method: 'POST', mode: 'no-cors' }).catch(() => {});
}

export class AuthError extends Error {}

async function call(url, opts = {}) {
  if (!hasToken()) throw new AuthError('Trzeba ponownie zalogować się do Google.');
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token.value } });
  if (res.status === 401) { forgetToken(); throw new AuthError('Sesja Google wygasła. Zaloguj się ponownie.'); }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) {}
    if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(detail))
      throw new Error('Google Drive API nie jest włączone w projekcie Google Cloud (Interfejsy API i usługi → Biblioteka → Google Drive API → Włącz). Po włączeniu odczekaj kilka minut.');
    throw new Error(`Dysk Google: błąd ${res.status}${detail ? ' – ' + detail : ''}`);
  }
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
  const meta = { name: SYNC_FILE, mimeType: 'application/json', description: 'Dane aplikacji MusicNotes. Nie edytuj ręcznie.' };
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
