# DreamSounds Official Website

A responsive red, black and white website with a Node.js/MySQL backend, quotation requests, an admin dashboard and portfolio image uploads.

## Included

- Public company website and service pages
- Responsive desktop and mobile layout
- Public quotation request form (no account needed)
- Email to the team, and a confirmation email to the customer, for each new request
- Admin-only login
- Admin overview dashboard
- Inquiry management: status, quoted amount and internal notes
- Public equipment and service catalogue (seeded on first start; there is no admin screen for it)
- Multi-image portfolio uploads and deletion
- MySQL database (created automatically on first start)
- Image files stored in `uploads/`

## Requirements

- Node.js 20 or newer
- npm
- A running MySQL or MariaDB server (for example the MySQL module in XAMPP)

## Run locally

1. Extract the ZIP.
2. Open a terminal in the extracted `dreamsounds-website` folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Set a strong unique `JWT_SECRET` and change `ADMIN_PASSWORD`.
6. Start MySQL and set the `DB_*` values in `.env` to match it. The defaults (`root`, no password, port 3306) match a stock XAMPP install. The database and tables are created on first start.
7. Run `npm start`.
8. Open `http://localhost:3000`.

The first startup creates the administrator account using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. Sign in using the Admin Login button to open the dashboard. There are no customer accounts: customers only submit the quotation form.

## Email notifications

When a customer submits a request, the team is emailed the full details and the customer is emailed a confirmation with their reference number. This is off until these are set in `.env`:

- `BUSINESS_EMAIL` — the inbox that receives the notifications
- `SMTP_HOST`, `SMTP_PORT` (587, or 465 for SSL), `SMTP_USER`, `SMTP_PASS` — from your email provider
- `SMTP_FROM` — optional sender address; defaults to `SMTP_USER`

Replies to the confirmation go to `BUSINESS_EMAIL`. A failed email is logged and never blocks the request. The quotation form accepts at most 10 submissions per 15 minutes from one device.

## Before public launch

This project is a working starter application, not yet a hosted live website. Before launch:

- Register `dreamsounds.ph` through an accredited registrar and configure DNS.
- Deploy to a Node.js host with a MySQL database and persistent disk storage. Local uploads require persistent storage; do not use ephemeral serverless hosting without migrating them.
- Set production environment variables and a strong random `JWT_SECRET`.
- Change the initial admin password before exposing the site publicly.
- Configure HTTPS and backups for the database and uploads.
- Add the official business email, telephone number, address and other verified company details.
- Review privacy notice, consent language, retention policy and applicable Philippine Data Privacy Act obligations.
- Set the SMTP values so the team is emailed about new inquiries (see Email notifications above).
- Confirm actual inventory counts, rates, equipment specifications and service availability with DreamSounds before publishing them as definitive.

## Important limitations / next production steps

- Booking requests are inquiries, not confirmed reservations. An administrator must review availability and approve the request.
- Equipment availability is not yet automatically blocked against overlapping bookings.
- Payments, invoices, SMS, emailing the quote itself, password reset and email verification are not yet integrated.
- Customers have no accounts and cannot track a request online; the team contacts them directly. There is one administrator account, created from `.env` on first start.
- Image upload is restricted by MIME type and file size, but production deployment should add malware scanning and image processing.
- Uploaded images are stored on local disk. For multiple server instances or managed production hosting, migrate them to object storage.
- Add formal role-based staff accounts and audit logs before broad internal use.

## Brand assets

The provided DreamSounds logo is copied to `public/logo.jpeg`. The website uses the official red, black and white palette and the tagline:

**The Sound of Quality. The Light of Excellence.**

No stock or generated event photography is included. Upload actual DreamSounds photos in Admin Dashboard → Portfolio Uploads.
