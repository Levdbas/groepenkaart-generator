# Project Guide

## Project Outline

Groepenkaart Generator is a browser-only app for creating electrical panel schedules and downloading them as PDFs. It stores data in the browser, supports JSON import/export, and can encode a shareable card in a URL fragment and PDF QR code. There is no application server or account system.

| Path                 | Responsibility                                           |
| -------------------- | -------------------------------------------------------- |
| `src/index.html`     | App structure, controls, and build placeholders          |
| `src/css/style.css`  | Screen, responsive, and print styling                    |
| `src/js/app.js`      | UI behavior, editing, browser storage, and import/export |
| `src/js/schema.js`   | Data validation, schema versions, and migrations         |
| `src/js/layout.js`   | Box layout: fitting, free slots, and moving modules      |
| `src/js/rcd.js`      | Shared RCD helpers and labels                            |
| `src/js/warnings.js` | Installation warning definitions and icons               |
| `src/js/share.js`    | Share URL and QR encoding/decoding                       |
| `src/js/pdf.js`      | PDF generation                                           |
| `schemas/`           | Published JSON schemas, one file per data version        |
| `scripts/build.mjs`  | Production build and local development server            |
| `tests/`             | Node.js regression tests                                 |
| `dist/`              | Generated build output                                   |

## Project Rules

- Make application changes in `src/`, schemas, tests, or documentation as appropriate. Do not edit generated files in `dist/`; rebuild them with the project scripts.
- Keep user-facing interface text and documentation in Dutch, following the existing terminology and style.
- Preserve the browser-only data flow. Card data is stored locally; share URLs and QR codes carry data in the URL fragment, not to a server.
- The current data format is schema version 4. Treat the data schema version as independent from the app version. Keep published older schema files unchanged.
- When changing the persisted or imported data shape, update the current schema, validation, and a sequential migration from the preceding version. Preserve existing data through migrations and add regression coverage for the migration chain. Reject unsupported newer versions and leave current data intact when an import fails. A feature that does not change the data format does not need a schema version bump.
- Current groups use `description` rather than a separate `name`. Use RCD terminology in current code and UI; retain legacy RCBO field names only where needed to read and migrate older formats.
- Preserve documented PDF behavior unless the request changes it: a group stays together on one page, filling tables to 15 rows is opt-in, and an enabled QR code is placed on the final page. Check rendered PDF output for PDF layout changes.
- For responsive UI changes, check the affected interactions at mobile widths as well as desktop, especially row controls and touch targets.
- Update relevant tests and README documentation when behavior or data format changes.

## Development and Verification

- Requires Node.js 20.11 or newer.
- Install dependencies with `npm install`.
- Run regression tests with `npm test` (Node's built-in test runner).
- Build with `npm run build`; output is generated in `dist/`.
- Run `npm run dev` to build and serve the app at `http://localhost:8000`. Set `PORT` to choose another port.
- After source changes, run the relevant tests and build. For PDF or responsive layout changes, also inspect the rendered app/output when browser verification is available.
