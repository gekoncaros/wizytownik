# Security policy

Wizytownik stores contacts and card images locally in IndexedDB. Do not put SMTP/API credentials, Microsoft tokens or secrets in browser code.

For team production use add authentication, authorization, server-side storage, retention controls and audit logging. Treat scanned OCR/QR content as untrusted input.
