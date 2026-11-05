/* Kopia zapasowa: eksport wszystkich piosenek do pliku JSON i import z pliku. */

export const BACKUP_APP = 'musicnotes';

export function exportFile(songs) {
  const data = { app: BACKUP_APP, version: 1, exported: new Date().toISOString(), songs };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const name = `musicnotes-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => typeof v === 'string' ? v : d;
const REPS = [1, 2, 3, 4, 6, 8];

function normSection(s) {
  if (!isObj(s) || typeof s.id !== 'string') return null;
  const chords = Array.isArray(s.chords) ? s.chords.map(c => str(c)) : [];
  const bars = Math.max(1, Math.min(64, chords.length || parseInt(s.bars, 10) || 4));
  while (chords.length < bars) chords.push('');
  chords.length = bars;
  const texts = {};
  if (isObj(s.texts)) for (const k in s.texts) {
    const i = parseInt(k, 10), t = s.texts[k];
    if (i >= 0 && i < bars && isObj(t) && str(t.t)) texts[i] = { t: t.t, span: Math.max(1, Math.min(bars - i, parseInt(t.span, 10) || 1)) };
  }
  const color = parseInt(s.color, 10);
  return {
    id: s.id, name: str(s.name, 'Sekcja'), short: str(s.short, '?').slice(0, 3) || '?',
    color: color >= 0 && color < 8 ? color : 0, bars, chords, lyrics: str(s.lyrics), texts
  };
}

function normSong(so) {
  if (!isObj(so) || typeof so.id !== 'string' || !Array.isArray(so.sections)) return null;
  const sections = so.sections.map(normSection).filter(Boolean);
  const ids = new Set(sections.map(s => s.id));
  const arrangement = (Array.isArray(so.arrangement) ? so.arrangement : [])
    .filter(a => isObj(a) && ids.has(a.sid))
    .map(a => ({ sid: a.sid, rep: REPS.includes(+a.rep) ? +a.rep : 1 }));
  const bpm = parseInt(so.bpm, 10);
  return { id: so.id, title: str(so.title, 'Bez tytułu'), bpm: bpm > 0 && bpm <= 400 ? bpm : 100, notes: str(so.notes), sections, arrangement, updated: +so.updated || 0 };
}

/** Czyta plik kopii. Przyjmuje też surowy stan z prototypu ({songs:[...]}) albo samą tablicę piosenek. */
export async function readBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('To nie jest plik JSON.'); }
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.songs) ? data.songs : null;
  if (!list) throw new Error('W pliku nie ma listy piosenek.');
  const songs = list.map(normSong).filter(Boolean);
  if (!songs.length) throw new Error('W pliku nie ma żadnej poprawnej piosenki.');
  return songs;
}

/** Łączy piosenki: te o tym samym id są zastępowane wersją z pliku, nowe trafiają na początek listy. */
export function mergeSongs(current, incoming) {
  const byId = new Map(incoming.map(s => [s.id, s]));
  const kept = current.map(s => byId.get(s.id) || s);
  const existing = new Set(current.map(s => s.id));
  return [...incoming.filter(s => !existing.has(s.id)), ...kept];
}
