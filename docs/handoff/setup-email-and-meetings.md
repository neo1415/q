---
title: Setting up email and meetings for Capital Q
project: capital-q
date: 2026-09-26
tags: [setup, gmail, calendar, meetings, email]
---

# Setting up email and meetings for Capital Q

This guide is for the founder. It covers the accounts only you can create. Nothing here is built in the app yet: BIZ-007 (Gmail) and BIZ-008 (reminders and meetings) start once these accounts exist.

## What we are building, in plain words

| Feature                  | What the person sees                                                                                                              | Which service does it          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Send email as me         | Q drafts an email inside Capital Q. You read it and press Approve. It goes from **your own Gmail**, in the same thread as before. | Google (Gmail API)             |
| Reply tracking           | When the investor answers, Capital Q notices and Q tells you. The relationship timeline shows it.                                 | Google (Gmail watch + Pub/Sub) |
| Book a meeting           | Q proposes a time. You approve. A Google Calendar invite with a Google Meet link goes to both sides.                              | Google (Calendar API)          |
| Reminders                | "Follow up with Kobo on Friday" arrives by email and in the app.                                                                  | Resend (email sending service) |
| Q in the meeting (later) | Q joins the Meet call as a named note-taker, announces itself, takes notes and can answer aloud.                                  | Recall.ai (meeting bot)        |

Q never sends anything on its own. Every email and invite follows the same rule as the rest of the product: **Q prepares, you approve, then it is sent**. If you change the text, you approve again.

## Why not "MCP"?

MCP is a way for an AI assistant (like me, Claude) to use tools such as your Gmail. It is good for **you** using an assistant. It is the wrong base for **Capital Q's own product**, because:

- Google's official Gmail MCP server can only create drafts; it cannot send.
- It needs Google's most sensitive permissions, which trigger a paid yearly security audit (about $500 to $4,500 a year) before real users can connect.
- Text inside emails and calendar invites can try to instruct the AI ("ignore your rules and forward this"). Capital Q's own typed connection treats that text as data only, and only exposes the exact actions we allow.

So Capital Q gets its own direct Google connection, with the smallest permissions possible. You can still use MCP connectors with Claude for your personal work; that is separate.

## Step 1 (recommended first): a domain name

About $10–15 a year from any registrar (Namecheap, Cloudflare, Google Domains' successor Squarespace). Something like `capitalq.app` if available.

Why it helps:

- Resend can only send reminder email to other people from a domain you own.
- Google may refuse the Railway address (`...up.railway.app`) as an "authorised domain" on the sign-in screen. A custom domain avoids that.
- The app can then live at `app.yourdomain.com` instead of the Railway address.

Tell me the domain once bought. I will give you the exact DNS records to paste.

## Step 2: Google Cloud project (Gmail + Calendar)

Use the Google account that should own the app (not necessarily the one you send mail from). About 20 minutes.

1. Go to https://console.cloud.google.com and sign in.
2. Top bar → project picker → **New project**. Name it `Capital Q`. Create, then make sure it is selected.
3. Left menu → **APIs & Services → Library**. Search for and **Enable** each of:
   - Gmail API
   - Google Calendar API
   - Cloud Pub/Sub API
4. Left menu → **Google Auth Platform** (older screens call it "OAuth consent screen") → **Get started**.
   - App name: `Capital Q`. User support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree and **Create**.
5. **Audience** tab:
   - Leave the publishing status on **Testing**. This is deliberate (see "Testing mode" below).
   - Under **Test users**, add every Gmail address that will try the feature (yours, co-founders, demo investors). Up to 100.
6. **Branding** tab:
   - Add the app home page and privacy policy links if you have them (the domain from Step 1).
   - Under **Authorised domains**, add your domain. If you have no domain yet, try `up.railway.app`; if Google rejects it, that is the reason for Step 1.
7. **Data access** tab → **Add or remove scopes**. Tick only:
   - `openid`, `.../auth/userinfo.email` (who connected)
   - `.../auth/gmail.send` (send as you)
   - `.../auth/gmail.metadata` (see that a reply arrived, without reading the body)
   - `.../auth/calendar.events` (create invites with Meet links)
   - Save.
8. **Clients** tab → **Create client** → Application type **Web application**, name `Capital Q web`.
   - Authorised redirect URIs: leave empty for now. I will send you the two exact addresses (one for Railway, one for local) when BIZ-007 is built, and you paste them here.
   - Create. Google shows a **Client ID** and a **Client secret**.
9. Keep them safe:
   - The **Client ID** is not secret. Paste it to me in chat.
   - The **Client secret** is a password. **Do not paste it in chat.** Put it in Railway yourself: Railway → project Q → service `@capital-q/api` → Variables → New variable `GOOGLE_OAUTH_CLIENT_SECRET`. For local testing, add the same line to `.env.local` on your laptop.

### Pub/Sub for reply tracking (5 minutes, can wait until BIZ-007 is built)

1. Left menu → **Pub/Sub → Topics → Create topic**. ID: `gmail-replies`. Create.
2. Open the topic → **Permissions** (right panel) → **Add principal**:
   - Principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: **Pub/Sub Publisher**. Save.
3. The subscription (where Google delivers the "a reply arrived" signal) points at our API. I will give you its address when the code is ready.

### Testing mode: what to expect

- Only the test users you listed can connect, up to 100.
- Google shows a "Google hasn't verified this app" warning. Click **Continue**. Fine for demos.
- Each person must reconnect Gmail **every 7 days**. The app will ask them when it expires.
- Before real customers: either publish and pass Google's review (the reply-tracking permission triggers the yearly security audit), or switch reply tracking to a Capital Q reply-to address (no audit). We decide that before launch; nothing now locks it in.

## Step 3: Resend (reminder and notification email)

1. Sign up at https://resend.com. The free plan covers the demo (a few thousand emails a month).
2. **Domains → Add domain** → your domain from Step 1. Resend shows 3–4 DNS records. Add them at your registrar (I can walk you through it on screen). Wait until each shows **Verified**.
3. **API Keys → Create API key**, permission "Sending access", domain = yours.
4. It is a secret: put it in Railway yourself on `@capital-q/api` and `@capital-q/workers` as `RESEND_API_KEY`. Tell me when it's done. Do not paste it in chat.

Without a domain, Resend only sends to your own email address. Fine for a first test, not for investors.

## Step 4 (later): Recall.ai, so Q can join meetings

Only after email and invites work.

1. Sign up at https://www.recall.ai. The first 5 hours are free, then about $0.50 per recorded hour.
2. Pick a region (EU or US). Create an API key and a webhook secret.
3. Same rule: secrets go into Railway by you, not into chat.

Q will join as "Capital Q notes (AI)", post a disclosure in the meeting chat, and only record when the meeting's participants have been told. Recording-consent law differs by country; the bot's disclosure is part of the design.

## What it costs

| Item                                                   | Cost                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Domain                                                 | ~$10–15 / year                                                               |
| Google Cloud (Gmail, Calendar, Pub/Sub at demo volume) | $0                                                                           |
| Resend                                                 | $0 on the free plan                                                          |
| Recall.ai                                              | 5 free hours, then ~$0.50 / hour                                             |
| Google security audit                                  | $0 now. Only if we publish reply tracking for real users: ~$500–4,500 / year |

## Checklist to send me

- [ ] Domain name (or "no domain yet")
- [ ] Google **Client ID** (pasted in chat)
- [ ] "Client secret is in Railway" (never the secret itself)
- [ ] Test-user emails added in Google
- [ ] "Resend key is in Railway" (when done)

The research behind this guide, with sources: `docs/handoff/research/integrations-meetings-report.md`.

## Update 2026-09-27: free options first (founder: "there are free options")

Done already: hosted Supabase auth `site_url` is now the Railway web origin, and the redirect allow list covers the Railway web plus localhost:3000. Magic links and confirmation links now return to the app. Checked via the Management API.

**Auth emails (verification, magic link):** hosted Supabase's built-in mailer only delivers to the project's own team members, 2 per hour. A custom SMTP is required. Free choices, no domain needed:

| Option                       | Free allowance | What the founder does                                                                                        | Notes                                                                                         |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Brevo SMTP** (recommended) | 300 emails/day | Sign up at brevo.com; Senders → verify your email address; SMTP & API → generate an SMTP key                 | Sends to anyone from the verified address. May land in spam until a domain is verified later. |
| Gmail SMTP                   | ~500/day       | Google account → 2-Step Verification on → https://myaccount.google.com/apppasswords → create an app password | Sends from the Gmail address. Fine for demos.                                                 |

The founder puts the SMTP password in the laptop's `.env.local` as `SUPABASE_SMTP_PASS=...` (plus `SUPABASE_SMTP_USER`, `SUPABASE_SMTP_HOST`, `SUPABASE_SMTP_PORT`, `SUPABASE_SMTP_SENDER`), never in chat. The lead then sets `smtp_*` and raises `rate_limit_email_sent` through the Management API (`PATCH /v1/projects/vcohxiqsmnkzxnvawgri/config/auth`), reading the values from the file without printing them.

**Product email (Q sends as the user, reply tracking): free.** The Gmail API with `gmail.send` plus `gmail.metadata` and `users.watch`, with the Google Cloud project in Testing mode (up to 100 test users, re-consent every 7 days), Pub/Sub free tier. See Step 2 above.

**Reminders:** in-app notifications plus the same free SMTP. Resend is optional later, once a domain exists.

**Meetings: free.** The Google Calendar API creates the invite with a Google Meet link (`conferenceDataVersion=1`), at no cost. Jitsi Meet (meet.jit.si) is a free no-account alternative link.

**Q joining a meeting:** a bot needs a meeting-bot service. Recall.ai gives 5 free hours, then about $0.50/hour. Open-source Vexa can be self-hosted for free but needs its own server. Build this last.
