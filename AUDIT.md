# Reliability audit — 2026-09-18

## Fixed in this branch

- **Cross-contact image contamination:** starting a new scan now resets the draft and file input, so a previous card image cannot silently become the front/back of the next contact.
- **IndexedDB failure cascade:** UI rendering no longer calls CRM database operations after IndexedDB failed to open.
- **CRM search performance:** search excludes base64 card images and timestamps instead of concatenating every property.
- **QR/vCard compatibility:** CRLF and folded vCard lines are normalized before parsing.
- **iOS/Safari downloads:** object URLs are revoked after a delay and the temporary anchor is attached before click.
- **PWA installability:** manifest is linked, service worker is registered, and the previous self-unregistering worker is replaced with an app-shell cache.
- **Release gate:** pull requests now run JavaScript syntax and PWA wiring checks.
- **OCR wizytówek:** zdjęcia są ograniczane do bezpiecznego rozmiaru, a przy niepełnym wyniku aplikacja powtarza odczyt w trybie wysokiego kontrastu i innym układzie strony.
- **QR:** skaner działa bezpośrednio z podglądu aparatu, a analiza zdjęcia próbuje pełny kadr, wersję kontrastową i przybliżone obszary. Obsługiwane są vCard, MeCard, BizCard, URL oraz `mailto:`.
- **Regresje skanowania:** zmiana aparatu nie usuwa już zdjęcia pierwszej strony, a jednoczesne przetwarzanie dwóch zdjęć jest blokowane.

## Remaining production risks

1. Contacts and card images are local to one browser/device. Clearing site data loses them unless JSON backup was exported.
2. There is no authentication, authorization, central database, audit trail, retention policy, consent model or multi-user synchronization.
3. OCR and QR libraries are loaded from third-party CDN endpoints; offline first-run OCR is therefore not guaranteed.
4. OCR parsing is heuristic and should always be user-verified before save, szczególnie dla dekoracyjnych fontów, bardzo małego tekstu oraz zdjęć z odblaskiem.
5. Large volumes of full-resolution card images can exhaust browser storage. Add image resizing/storage quota handling before large event deployments.
6. replyTo is configuration-only because mailto cannot reliably set a Reply-To header. Real managed sending requires a server-side mail provider/API.
7. Testy parserów QR/OCR i walidacja składni działają automatycznie. Nadal potrzebne są testy na fizycznych urządzeniach: zgoda na aparat w iOS Safari, przechwytywanie w Android Chrome, trwałość IndexedDB i aktualizacja instalowanej PWA.

## Release rule

Do not merge a change that breaks: Start → Scan/Photo → QR/OCR → Verify → Save → CRM → Search → Edit → Export/Backup.
