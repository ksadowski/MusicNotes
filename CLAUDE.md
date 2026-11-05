# Notatnik form (MusicNotes)

Aplikacja na tablet z Androidem (później też telefon) do szybkiego zapisywania formy piosenek. Interfejs po polsku. Rozmowa z użytkownikiem po polsku.

## Stan (2026-11-05)

- **Decyzja: aplikacja webowa (PWA) zamiast Kotlina.** Działa offline, instaluje się z Chrome na ekran główny Androida. Kotlin tylko, gdyby kiedyś potrzebne było coś naprawdę natywnego.
- Właściwa aplikacja: folder `app/` (bez kroku budowania, czysty HTML/CSS/JS w modułach ES):
  - `index.html`, `css/app.css`, `js/app.js` (widoki i zdarzenia), `js/storage.js` (IndexedDB, zapis odkładany 250 ms, migracja z localStorage prototypu, `navigator.storage.persist()`), `js/backup.js` (eksport/import kopii JSON: „Dodaj do obecnych” łączy po `id`, „Zastąp wszystkie”).
  - `sw.js` — service worker. `VERSION='__BUILD__'` podmienia workflow na skrót commita. Lokalnie (`__BUILD__`) pliki idą najpierw z sieci, po wdrożeniu najpierw z pamięci; nowa wersja pokazuje w stopce „Odśwież”. Nowy plik aplikacji trzeba dopisać do `APP_FILES`.
  - `manifest.webmanifest`, `icons/` (PNG generuje `tools/make-icons.ps1`).
  - Przycisk „wstecz” Androida: każda otwarta warstwa (edytor na wąskim ekranie, tryb sceniczny, klawiatura, tekst) to wpis w historii (`syncNav` w `app.js`).
- Publikacja: `.github/workflows/pages.yml` wrzuca `app/` na GitHub Pages przy pushu na `main` (Settings → Pages → Source: GitHub Actions). Lokalne repo gita istnieje (gałąź `main`); użytkownik publikuje/pushuje przez GitHub Desktop. Git CLI: `C:\Program Files\Git\cmd\git.exe` (może nie być w PATH starych powłok).
- Lokalnie: `tools/serve.ps1` (serwer w PowerShellu — na komputerze nie ma Pythona ani Node), konfiguracja `app` w `.claude/launch.json`. Pliki `.ps1` muszą być zapisane jako UTF-8 z BOM (PowerShell 5.1).
- Stary prototyp: `prototyp/index.html`, opublikowany jako https://claude.ai/artifact/U7giiyXSQ8Lt7CNfuYD5u5 — już nierozwijany, zmiany robimy w `app/`.

## Model danych (z prototypu)

- Piosenka: `title`, `bpm`, `notes`, `sections[]`, `arrangement[]`
- Sekcja (definiowana raz, używana wielokrotnie w formie): `name`, `short` (≤3 znaki), `color` 0–7, `bars`, `chords[]` (jeden string na takt), `lyrics`, `texts{}`
- Takt: jeden akord, albo 2–4 części rozdzielone spacją (`-` = pusta część), albo `%` (powtórz takt). Zapis `#`/`b`, wyświetlanie ♯/♭.
- `texts`: `{numerTaktuStartowego: {t, span}}` — dowolny tekst zamiast akordów na kilka taktów (np. „sam klawisz” na 4 takty).
- Element formy: `{sid, rep}`, `rep` ∈ ×1, 2, 3, 4, 6, 8.

## Funkcje prototypu

Lista piosenek z wyszukiwaniem; forma jako kolorowe bloki (stuknięcie zaznacza, przytrzymanie i przeciągnięcie zmienia kolejność, wcześniej/później, powtórz ×N, duplikuj, „Zmień tylko tutaj” = to wystąpienie dostaje własną kopię sekcji, usuń z formy); szablony sekcji (Intro, Zwrotka, Przedrefren, Refren, Bridge, Solo, Przejście, Outro) i własne; kopiowanie sekcji; oś czasu proporcjonalna do taktów; klawiatura akordów z podziałem taktu 1/2/3/4, „Dalej ›”, „/ bas”, „%”; tryb tekstu z zakresem taktów i podpowiedziami; tryb sceniczny (duże akordy, ekran nie gaśnie); kopiowanie jako tekst; usuwanie piosenki/sekcji ikoną kosza w nagłówku z potwierdzeniem w ramce.

## Ustalenia z użytkownikiem — nie przywracać bez pytania

- Bez tonacji, metrum i transpozycji. Zostaje tylko BPM i liczba taktów.
- Tylko międzynarodowe nazwy dźwięków (C D E F G A B), bez polskiego H.
- Bez przykładowych piosenek — aplikacja startuje pusta.
- Usuwanie zawsze przy tym, co usuwa (nagłówek), nigdy w głównym rzędzie akcji.
- Funkcje mają być widoczne (np. wybór ×1…×8), a nie ukryte za przełącznikami cyklicznymi.
