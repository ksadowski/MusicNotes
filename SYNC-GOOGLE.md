# Synchronizacja z Dyskiem Google — konfiguracja (jednorazowo)

Aplikacja zapisuje na Twoim Dysku jeden plik `notatnik-form-synchronizacja.json`. Dostaje uprawnienie
`drive.file`, czyli widzi **tylko pliki, które sama utworzyła** — reszty Dysku nie widzi.
Żeby to działało, Google musi „znać” aplikację. Służy do tego identyfikator klienta (Client ID), który
wyrabia się raz, za darmo, w Google Cloud.

## Kroki

1. Wejdź na https://console.cloud.google.com i zaloguj się swoim kontem Google.
2. U góry wybierz projekt → **Nowy projekt** → nazwa np. `Notatnik form` → Utwórz.
3. **Włącz Google Drive API**: menu → *Interfejsy API i usługi* → *Biblioteka* → wyszukaj „Google Drive API” → **Włącz**.
4. **Ekran zgody**: menu → *Google Auth Platform* (albo *Ekran zgody OAuth*) → **Rozpocznij**:
   - nazwa aplikacji: `Notatnik form`, e-mail pomocy: Twój,
   - odbiorcy: **Zewnętrzni**,
   - e-mail kontaktowy: Twój → zaakceptuj zasady → Utwórz.
5. *Odbiorcy* (Audience) → **Użytkownicy testowi** → dodaj swój adres Gmail
   (i każde inne konto, z którego będziesz używać aplikacji).
6. *Dostęp do danych* (Data access) → **Dodaj zakresy** → zaznacz `.../auth/drive.file` → Zapisz.
7. *Klienty* (Clients) → **Utwórz klienta**:
   - typ: **Aplikacja internetowa**, nazwa dowolna,
   - **Autoryzowane źródła JavaScriptu** — dodaj dwa adresy (bez ukośnika na końcu):
     - `https://<twój-login>.github.io`
     - `http://localhost:8080`
   - Identyfikatory URI przekierowania — zostaw puste → Utwórz.
8. Skopiuj **Identyfikator klienta** (kończy się na `.apps.googleusercontent.com`) i wpisz go w
   `app/js/config.js` w miejsce `''` — albo po prostu wklej go Claude'owi.
9. Zrób commit i push (GitHub Desktop) — po publikacji w stopce aplikacji pojawi się **Połącz z Dyskiem Google**.

## Dobrze wiedzieć

- Przy pierwszym logowaniu Google pokaże ostrzeżenie „Google nie zweryfikował tej aplikacji” — to normalne
  dla prywatnej aplikacji w trybie testowym. Kliknij *Kontynuuj*.
- Sesja Google w aplikacji trwa ok. godziny. Potem synchronizacja czeka, aż stukniesz
  **Zaloguj i synchronizuj** (okienko Google zwykle tylko mignie).
- Synchronizacja działa automatycznie: przy starcie, po każdej zmianie (po kilku sekundach), po powrocie do aplikacji
  i po odzyskaniu internetu. Bez internetu wszystko działa normalnie, zmiany wyślą się później.
- Gdy ta sama piosenka zmieni się na dwóch urządzeniach, wygrywa nowsza zmiana (cała piosenka).
- Usunięcie pliku na Dysku niczego nie kasuje w aplikacji — przy następnej synchronizacji plik powstanie od nowa.
