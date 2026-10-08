# Licence Expiry Email Reminders

Automatic daily email to pilots whose licences/documents are nearing expiry,
plus a digest for operations. Free at our scale (Gmail SMTP + Firebase free tiers).

## How it works

- `functions/index.js` exports two Cloud Functions:
  - `sendExpiryReminders` — runs **daily 06:00 IST**, scans every company.
  - `sendExpiryRemindersNow` — callable manual trigger from **Settings → Run now**
    (signed-in owner/admin/operations only, restricted to their own company).
- `functions/lib/engine.js` — scans `user_documents` where `expiryDate` falls in
  the window, groups by `operatorId` (== companyId), resolves pilot emails, sends.
- `functions/lib/tiers.js` — escalation math.
- `functions/lib/email.js` — Nodemailer transport + mail templates.

## Escalation tiers

Each document carries `reminderLeadTimeDays` (default 30, set per document in the
crew module). Tiers are `[lead, ceil(lead/2), 7, 1]` clamped to the lead — e.g.
lead 30 → 30/15/7/1, lead 7 → 7/4/1. A document fires exactly one tier per day
it is in range, and `expired` fires once after expiry. All pending tiers for one
pilot are bundled into a single mail.

Dedupe key: `companies/{companyId}/reminder_logs/{docId|expiryMs|tier}` with
`status: 'sent'`. Because the expiry timestamp is part of the key, a renewed
document (new expiry) starts a fresh reminder cycle automatically.

## Cost

- **Email: free.** Gmail SMTP (app password): 500 mails/day. Nothing is billed
  by us; Firebase free tier covers the function invocations.
- Firebase **Blaze (pay-as-you-go) plan is required** to deploy Cloud Functions
  with outbound networking (SMTP) and scheduled triggers. At our volume the
  actual bill is ~₹0/month — Blaze is a billing *requirement*, not a cost.

## One-time setup

1. Upgrade the Firebase project to **Blaze** (Firebase console → Upgrade).
   Set a budget alert (e.g. ₹500) for peace of mind.
2. Create a Gmail **App Password** (Google Account → Security → 2-Step
   Verification → App passwords). Use a dedicated ops mailbox if possible.
3. Install the Firebase CLI and log in (one-time, on any machine):
   `npm i -g firebase-tools` then `firebase login`.
4. From the repo root, set the SMTP secrets (values never committed):
   ```
   firebase functions:secrets:set SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS SMTP_FROM
   ```
   Suggested values: `smtp.gmail.com`, `587`, `false`, `<mailbox>`,
   `<16-char app password>`, `VyomSena Ops <mailbox>`.
5. Deploy functions only (hosting stays on GitHub Pages):
   `firebase deploy --only functions`
6. Verify: Firebase console → Functions → `sendExpiryReminders` shows
   "next run 06:00 Asia/Kolkata". Or open the web app → Settings →
   Licence Expiry Reminders → **Run now**, then check the "Last run" card.
7. Publish the rules change in `docs/firestorerules.md` (reminder_logs block)
   to the Firebase console rules editor so clients cannot forge sent-logs.

Local secret overrides (optional dev): copy `functions/.env.example` to
`functions/.env` (gitignored) and run `firebase emulators:start --only functions`.

## Operating notes

- Settings live at `companies/{companyId}/reminder_settings/current`, editable in
  the web Settings module: enabled flag, default lead days (used when a document
  has no `reminderLeadTimeDays`), extra ops CC emails, digest toggle, expired toggle.
- Last-run summaries at `companies/{companyId}/reminder_runs/{runId}` power the
  Settings "Last run" card: mails sent, pilots skipped (no email on file),
  already-sent skips, failures.
- Pilots with **no email on file** are listed in the run `details[]` and counted
  in `skippedNoEmail` — fill the email in the crew profile to include them.
- Failed sends are retried the next day (no log entry is written on failure).
- The web app never sends mail itself — if `functions/` is not deployed,
  "Run now" reports that the function is missing.
