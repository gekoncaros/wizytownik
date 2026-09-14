# Wizytownik

Mobilna aplikacja PWA do szybkiego zbierania kontaktów z wizytówek podczas wydarzeń.

## Co potrafi

- zdjęcie przodu i tyłu wizytówki aparatem telefonu;
- OCR po polsku i angielsku, wykonywany w przeglądarce;
- automatyczne wykrycie e-maili, telefonów i stron WWW;
- prosta korekta danych przed zapisem;
- lista ostatnich skanów, wyszukiwanie, tagi, notatki i edycja;
- eksport danych do CSV lub JSON;
- dane i zdjęcia przechowywane lokalnie na urządzeniu (IndexedDB);
- możliwość instalacji na ekranie telefonu jako aplikacji.

## Uruchomienie lokalne

Otwórz projekt przez dowolny serwer HTTP, np. rozszerzenie Live Server w VS Code. Kamera działa na HTTPS lub localhost.

## Publikacja przez GitHub Pages

1. Wejdź w **Settings → Pages** w tym repozytorium.
2. W sekcji **Build and deployment** wybierz **Deploy from a branch**.
3. Wybierz gałąź `main` oraz folder `/(root)`, a następnie **Save**.

Po chwili aplikacja będzie pod adresem `https://gekoncaros.github.io/wizytownik/`.

## Prywatność

W wersji startowej dane nie trafiają na serwer aplikacji. Silnik OCR jest pobierany z CDN przy pierwszym użyciu, natomiast rozpoznawanie i magazynowanie rekordów odbywa się na urządzeniu. Przed użyciem zespołowym należy wdrożyć logowanie, centralną bazę danych, retencję danych i politykę RODO.

## Następny etap

Wersja zespołowa może zawierać konta użytkowników, wspólną bazę, przypisanie kontaktu do eventu/opiekuna, zgodę marketingową, synchronizację z CRM oraz eksport do Excel/HubSpot/Bitrix.