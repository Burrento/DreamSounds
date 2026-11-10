# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — needs Node >= 20.
- A MySQL/MariaDB server must be running (XAMPP is installed at `C:\xampp`); connection comes from `DB_*` in `.env`, defaulting to `root` with no password on `localhost:3306`.
- `npm run dev` — `node --watch server.js` (restarts on server changes; `public/` is static, just refresh the browser).
- `npm start` — plain `node server.js`.
- Configuration lives in `.env` (there is no `.env.example`; the README lists the keys). The server exits immediately if `JWT_SECRET` is unset.

There is no build step, linter, or test suite. Verify changes by running the server and hitting `http://localhost:3000` (`GET /api/health` for a quick liveness check).

## Architecture

Two files hold nearly everything:

- `server.js` — the whole backend: Express app, MySQL schema, seeding, auth, and every route.
- `public/app.js` — the whole frontend: vanilla JS, no framework or bundler. `public/index.html` is a single page; the admin login and admin dashboard are modals in that page, not separate routes.

### Data

- MySQL via a `mysql2/promise` pool; uploaded images in `uploads/` (gitignored, created on startup). `initDb()` creates the database and tables, seeds, and only then does the server listen.
- Query through `q(sql, params)`: rows for a `SELECT`, `{ insertId, affectedRows }` for writes. Multi-row inserts use `pool.query("... VALUES ?", [rows])` because `execute` does not expand nested arrays.
- Every async route is wrapped in `h(...)`; Express 4 does not forward rejected promises to the error middleware on its own.
- Schema is inline `CREATE TABLE IF NOT EXISTS` in `initDb()`. There are no migrations: editing a `CREATE TABLE` does nothing to an existing database. Add an `ALTER TABLE`, or drop the database in dev.
- Columns added after the first schema (`bookings.quoted_amount`, `bookings.admin_notes`) are applied by an `ALTER TABLE` loop in `initDb()` that ignores `ER_DUP_FIELDNAME`; add new columns there, not in the `CREATE TABLE`.
- `quoted_amount` and `admin_notes` are staff-only; no public route returns them.
- `event_date` / `event_time` are stored as the strings the form sends, not `DATE`/`TIME`; `created_at` comes back as an ISO timestamp.
- Startup seeding is one-shot: the admin user is created only if `ADMIN_EMAIL` has no row, and starter equipment only if the table is empty. Changing `ADMIN_PASSWORD` in `.env` afterwards does not change the existing admin's password.
- `bookings.items_json` is a JSON string of `{id, name}` snapshots, parsed only in the admin listing.
- Equipment `DELETE` is a soft delete (`active=0`); the public `/api/equipment` filters on `active=1`. Portfolio `DELETE` is a hard delete and also unlinks the file.

### Auth

- Staff only. There are no customer accounts and no registration route: customers just submit the public quote form. Accounts come from the startup seed, and `POST /api/auth/login` only accepts `role='admin'` rows.
- JWT (7 days) returned by login, stored client-side in `localStorage` (`ds_token`, `ds_user`) and sent as `Authorization: Bearer`. No cookies or sessions.
- `requireAuth` then `requireAdmin` guard everything under `/api/admin/*`. Role comes from the token payload.
- `POST /api/bookings` is public and unauthenticated. `bookings.user_id` is a leftover column and is always NULL.

### Frontend conventions

- `api()` in `app.js` is the single fetch wrapper (adds the token, sets JSON content type unless the body is `FormData`, throws `Error(data.error)` on non-2xx). The server always reports failures as `{ error: "..." }`.
- All rendering is template strings assigned to `innerHTML`. Every server- or user-supplied value must go through `esc()`.
- Admin panels are re-rendered wholesale and re-bind their own listeners after each mutation, then call the public loaders (`loadEquipment`, `loadPortfolio`) to keep the page behind the modal in sync.

### Things that are duplicated and must be changed together

- Booking statuses (`New, Reviewing, Quoted, Confirmed, Completed, Cancelled`): the allow-list in `PATCH /api/admin/bookings/:id` and the `<select>` in `loadAdminBookings`.
- The `DS-00001` reference format: `reference()` in `server.js` and the inline format in `loadAdminBookings`.
- Portfolio categories: the upload form `<select>` in `loadAdminPortfolio` and the filter buttons in `index.html`. Filtering is an exact string match on `category`.
- Upload limits (12 files, 8MB, JPG/PNG/WEBP/GIF): the `multer` config and the help text / `accept` attribute in the upload form.

### Route ordering in `server.js`

The error-handling middleware (which returns 400 for any thrown error, including multer rejections) and the `app.get("*")` fallback to `index.html` are at the bottom; new routes go above them.

## Known gaps (from README)

Bookings are inquiries, not reservations — nothing blocks overlapping dates against equipment quantity. Each quote sends two emails through `sendMail` (fire-and-forget, disabled unless `SMTP_HOST` and `BUSINESS_EMAIL` are set): full details to the team, and a confirmation to the customer. The customer email must contain no visitor-typed text (only the reference), because the address is unverified and the form would otherwise let anyone send a third party a message of their choosing from DreamSounds. `POST /api/bookings` is rate-limited for the same reason. No payments, password reset, or email verification. Helmet's CSP is disabled. The contact section's email link is a placeholder.
