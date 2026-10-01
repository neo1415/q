# Capital Q email design (2026-10)

Founder directive (2026-10-01): "brand all the email templates and make
sure the emails look nice and professional for Capital Q."

## Inventory: every email Capital Q sends

| #   | Email                                                                                                                                                                                                    | Sender (source)                                | Template now                                            | Links / attachments                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Call booked / call changed                                                                                                                                                                               | workers.meetings (`createMeetingMailer`)       | `meetingEmail` (communication/schedule/meeting-mail.ts) | Meet button, Meet URL written out, Prepare with Q link, `invite.ics`           |
| 2   | Call agreed (invite before a Meet link exists)                                                                                                                                                           | q-api `sendInvites`                            | `callInviteEmail` (q-api/composition/emails.ts)         | `invite.ics`                                                                   |
| 3   | Reminder due                                                                                                                                                                                             | workers.reminders (`deliverDue`)               | `reminderEmail` (communication/email-templates.ts)      | Open Capital Q (`/home`)                                                       |
| 4   | Notice left unread ("Needs you": interest and connection notices, Q work and errand updates, meeting notes ready, verification and human-review outcomes, KYB decisions, account paused, scout findings) | workers.notices (`createNotificationDelivery`) | `noticeEmail` (communication/email-templates.ts)        | the notice's own page                                                          |
| 5   | The Q Daily (weekly or daily edition)                                                                                                                                                                    | workers daily (`createDailyEditionService`)    | `editionEmail` (q-daily/email.ts) inside the layout     | Read the full edition, Change how often it comes, story sources, Pexels credit |
| 6   | Q paused an account (to platform operators)                                                                                                                                                              | q-api `reportPausedAccount`                    | `accountPausedEmail` (q-api/composition/emails.ts)      | admin console (`/admin`, now absolute)                                         |
| 7   | Any text-only message (fallback)                                                                                                                                                                         | integrations SMTP / Brevo senders              | `brandedEmailHtml` → `renderPlainTextEmail`             | https URLs as links                                                            |
| 8   | Confirm sign-up, magic link, password reset, email change, invite                                                                                                                                        | Supabase Auth (Brevo SMTP)                     | `authEmailTemplates()` → `supabase/templates/*.html`    | `{{ .ConfirmationURL }}`                                                       |

Not Capital Q's emails, so not branded: emails a person sends from their
own Gmail through an approved `email.send` (BIZ-007). They go out as the
person, in their words.

Digests: none exist as a separate email today; Q work, admin, KYB and
human-review outcomes reach people as in-app notices and, when unread and
the person allows email, as #4.

## The layout (`packages/email`)

One renderer, `renderEmail`, with no dependencies:

- Wordmark: a text "Q" tile and "Capital Q" in the system font. No image,
  so it reads with images blocked and in dark mode.
- Colours: the `--cq-*` tokens converted once from OKLCH to hex
  (`EMAIL_COLOURS`, light and dark). Dark mode uses `prefers-color-scheme`
  plus `color-scheme` meta; inline colours are light-first.
- System font stack, a 600px single column, 40px inner padding (20px on
  phones), 16px/26px body text.
- One primary action as a bulletproof table button; links written out where
  a client may hide buttons (the Meet URL).
- Footer: why you got this, Manage notifications (`/settings`), and the
  company line "Capital Q · Investment intelligence for founders and
  investors".
- A hidden preheader, and a plain-text alternative built from the same
  blocks.
- WCAG AA: text, secondary, tertiary and link colours ≥ 4.5:1 on the card
  in light and dark; button text ≥ 4.5:1 on the button (tested).
- Everything a template passes is escaped; links must be absolute https
  (local origins in development), otherwise they are left out.
- No AI-slop visuals: no gradients, glows, badges or uppercase eyebrows.

## Operator notes

- Supabase Auth templates: the files in `supabase/templates/` are used by
  the local stack (`supabase/config.toml`); paste the same HTML into the
  hosted project's Auth > Email Templates, with the subjects listed there.
- Links in reminder, invite and operator emails need `CQ_WEB_ORIGIN` on
  workers and q-api (already used for meeting and notice links).
