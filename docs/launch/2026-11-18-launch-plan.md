# Capital Q: launch plan, costs and pricing

Prepared 18 November 2026. All amounts are in US dollars unless marked otherwise.

This note covers what I need from you, what we pay for, how to stop running out of credit, how to price the product, how we get paid, where to host it, the name and domain, the legal documents, the go-live checklist and an honest status report.

One point up front, because it shapes the payments and legal sections: **Capital Q never holds or moves investors' money.** When an investor commits to a company, Capital Q records the commitment and the evidence for it. The money itself goes directly between the investor and the company, outside Capital Q. The only payments we take are our own fees, such as subscriptions (decision of 18 November).

## Everything I need from you

This is the one list of everything I need from you before launch: accounts, payments, decisions and information. The later sections explain the amounts in more detail.

**How to send me anything secret.** Passwords, access tokens and API keys go into the hosting environment's secret settings (Railway's variable settings for the live services, or the secret settings of the environment I work in). Never send them by email, WhatsApp or chat. For everything else (choices, company details, documents), a normal message is fine.

**Already decided** (nothing more needed from you):

| #   | Decision                                                                                                                                                                                                                           | When          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| D1  | **Plans are usage allowances, never feature locks.** Every plan can ask Q and use meetings. A plan sets how much is included, with top-ups and upgrades.                                                                           | 18 November   |
| D2  | **Stripe plus Paystack** for subscriptions: Stripe for international customers, Paystack for African ones (section 5).                                                                                                             | 18 November   |
| D3  | **Capital Q is not a payment platform.** It never holds or moves investment money. Money raised is recorded with its evidence, never processed.                                                                                    | 18 November   |
| D4  | **Zino Aviation is only the name of the admin account.** It doesn't invest, so running the admin side from it is no conflict of interest. This settles the conflict-of-interest question I raised earlier.                         | 18 November   |
| D5  | **Q's meeting face must move its lips when Q speaks,** with Q's voice coming through the face. The earlier idea of a silent face, or a still picture instead, is dropped. This is being built now; I'll show you before we charge. | 18 November   |
| D6  | **The current database becomes staging** (our test copy) and production gets a brand-new database project.                                                                                                                         | 17 November   |
| D7  | **Cut costs only without losing quality** (section 1). The one exception I'm asking you about is item 10 below.                                                                                                                    | 6 and 18 Nov. |

**Decisions I need from you:**

| #   | What                                                              | Why                                                                                                                                                                          | Rough cost                                                        | How to give it to me                                                                                                   |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | **The new name** (section 7)                                      | "Capital Q" clashes with two US investment firms. The new name must contain Q.                                                                                               | Domain about $10 a year; trademark search and filing $300–$1,500  | Pick one of the names in section 7, or another with Q, and I'll check it the same way.                                 |
| 2   | **Plan prices** (section 4)                                       | I can't build the plan screens or set up the prices in Stripe and Paystack without them.                                                                                     | None                                                              | Approve the prices in section 4, or send changes.                                                                      |
| 3   | **Success-fee terms,** if you still want one                      | The rate for each side, whether it's charged on money actually received (my suggestion), any negotiated exceptions, and how much evidence we need before sending an invoice. | Lawyer's fee (item 27)                                            | Tell me your preferred terms. Nothing is invoiced until the lawyer signs off; until then we only record and calculate. |
| 4   | **Checking that money really arrived**                            | To prove a commitment was paid, we could later connect to company bank accounts (with permission) or work with an escrow firm. Now, later or never?                          | None now                                                          | A one-word answer. I suggest "later".                                                                                  |
| 5   | **Names or codes in admin analytics**                             | When admins look at usage and business numbers, should they see people's names, or a code instead (my suggestion, for privacy)?                                              | None                                                              | Tell me which.                                                                                                         |
| 6   | **Sales tax collection through Stripe**                           | Stripe can work out and add sales tax or VAT for each country.                                                                                                               | 0.5% of each payment where we're registered (Stripe's price page) | Yes or no. I suggest "not yet" until we know where customers are.                                                      |
| 7   | **CRM lists we may import**                                       | Investors and founders can import their pipelines, and we may want to email our own contacts. For each list I need to know where it came from and that we may use it.        | None                                                              | Send a short note per list: who it covers, where it came from, and whether those people agreed to hear from us.        |
| 8   | **Marketing email set-up**                                        | Our own outreach should go from a separate sub-address so sign-in emails keep a clean reputation. I also suggest not tracking opens and clicks.                              | Included in Brevo (item 21)                                       | Approve the sub-address (for example news.yourname.com) and the no-tracking default.                                   |
| 9   | **Load test on staging** (optional)                               | Proves how many people we can handle before we pay for bigger servers.                                                                                                       | About $60–$125                                                    | A yes, and I'll run it.                                                                                                |
| 10  | **Cheaper models for simple internal steps** (see the note below) | The single biggest further saving (section 1).                                                                                                                               | Saves money                                                       | Yes or no.                                                                                                             |

**Accounts and payments I need from you:**

| #   | What                                                       | Why                                                                                                                                                 | Rough cost                                                                                                                                | How to give it to me                                                                                                                                                                                  |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11  | **Buy the domain, and give me DNS access**                 | The web address, the email-sending records and Q's meeting account all hang off it.                                                                 | About $10.46 a year for .com; .ai about $140–$180 for two years (section 2)                                                               | Buy it in your own name at Cloudflare. Invite me to the Cloudflare account with permission to edit DNS only. Don't send me your password.                                                             |
| 12  | **Supabase: a production project and a full-access token** | Production needs its own database (decision D6). With the token I can fetch the project's keys myself and set everything up.                        | $40 a month for production (Small) and staging (Micro) together                                                                           | Create the project in Frankfurt on the Small size, create a personal access token in your Supabase account, and put it in the environment's secret settings. Add a spending alert.                    |
| 13  | **Railway Pro**                                            | Needed for more copies of each program, longer logs and team access.                                                                                | $20 a month including $20 of usage; about $90 a month for us, plus $12 for the virus scanner                                              | Upgrade the existing workspace and keep a card with headroom on it.                                                                                                                                   |
| 14  | **OpenAI** credit with auto-recharge                       | Q's main thinking and its live voice. Running dry stops Q completely.                                                                               | Start with $300; for example add $100 whenever it drops below $50                                                                         | In OpenAI's billing settings. The existing key stays; no new key needed.                                                                                                                              |
| 15  | **Anthropic** credit with auto-recharge                    | Q's second AI provider and the last-resort search.                                                                                                  | Start with $100; for example add $50 below $25                                                                                            | In Anthropic's billing settings.                                                                                                                                                                      |
| 16  | **Google Gemini** on a card                                | Small internal tasks.                                                                                                                               | Under $1 last month                                                                                                                       | Keep a card on the Google Cloud billing account.                                                                                                                                                      |
| 17  | **ElevenLabs** Creator plan                                | Q's read-aloud voice.                                                                                                                               | $22 a month                                                                                                                               | Subscribe in the existing account.                                                                                                                                                                    |
| 18  | **Deepgram** card on file                                  | Speech-to-text. The free credit eventually runs out.                                                                                                | $0 until the $200 free credit is used, then $0.0048 a minute                                                                              | Add a card before the credit runs out.                                                                                                                                                                |
| 19  | **Tavus** Builder plan                                     | Q's face in meetings and pitch rehearsal (decision D5).                                                                                             | $59 a month, including 175 minutes                                                                                                        | Subscribe in the existing account.                                                                                                                                                                    |
| 20  | **Recall** credit                                          | The meeting bot that lets Q join, listen and take notes.                                                                                            | $20 to start; $0.65 an hour with transcripts; first 5 hours free                                                                          | Add credit or a card in the existing account.                                                                                                                                                         |
| 21  | **Search: Serper and Brave**                               | Q's public research. Most search providers are out of credit today.                                                                                 | Serper $50 pack; Brave $25                                                                                                                | Buy the credit in the existing accounts. If you open a new account, put its key in Railway's variable settings.                                                                                       |
| 22  | **Cloudflare Stream**                                      | Stores and plays founders' pitch videos.                                                                                                            | About $5 a month                                                                                                                          | Keep a card on the Cloudflare account.                                                                                                                                                                |
| 23  | **Brevo,** and the email-sending records                   | Sign-in codes, meeting invitations and alerts must reach inboxes, not spam.                                                                         | Free up to 300 emails a day; about $32 a month for 20,000 (reported; please confirm in Brevo)                                             | Add the new domain in Brevo. With DNS access (item 11) I add the three records it shows (SPF, DKIM and DMARC).                                                                                        |
| 24  | **A Google Workspace for Q's meeting account**             | So Q joins video meetings signed in, as an invited guest, and skips the waiting room. In our records, 5 of 13 meeting bots were left waiting there. | **$7 per user a month** on a one-year plan, or $8.40 month to month (Google's own help page). About $21 a month.                          | See the note below the table.                                                                                                                                                                         |
| 25  | **Recall login group** for that account                    | Tells Recall to sign Q's bot in with the Workspace account.                                                                                         | None                                                                                                                                      | Once item 24 exists, I do the technical set-up with you on a short call (it needs a few settings in the Workspace admin screen). The private sign-in key goes into the environment's secret settings. |
| 26  | **Payment accounts: Stripe and Paystack**                  | Stripe for international customers, Paystack for African ones (decision D2, section 5).                                                             | No monthly fee; about 4% of each payment; a US company through Stripe Atlas costs $500 once, then $100 a year plus Delaware's yearly fees | Open both business accounts in the company's name. Put the secret keys in Railway's variable settings. Flutterwave is the fallback if Paystack doesn't cover a country we need.                       |

**Information and people I need from you:**

| #   | What                                   | Why                                                                                                                                                                     | Rough cost                                                                     | How to give it to me                                                                                                      |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 27  | **A lawyer**                           | Terms of service, privacy policy, Nigeria's data protection registration (NDPC), and an opinion on success fees and the licences they need in each country (section 5). | About $500–$2,000 for the documents; $1,000–$5,000 for the success-fee opinion | Instruct one, and send me their documents when ready. I publish them in the product with consent at sign-up.              |
| 28  | **Company and billing entity details** | Invoices, receipts, the payment accounts and the legal documents all need the seller's details.                                                                         | None                                                                           | The legal name, registration number, registered address, tax number (TIN, and VAT if registered) and the billing country. |

**Notes on three of the items:**

- **Item 10 and cheaper models.** On 6 November we agreed to cut costs only in ways that keep Q's quality. Our scale review found that quick internal sorting steps (deciding what kind of question it is, before the real answer) cost more in total than Q's ordinary conversation. Using a smaller, cheaper model for just those steps is the biggest saving left, and the answer itself would still come from the strongest model. It goes against the earlier decision, so I won't do it without your yes.
- **Item 24, Q's meeting account.** Recall's set-up guide asks for a separate, paid Google Workspace used only by the meeting bot, with its own primary address. So I suggest a small sub-address of the new domain, such as meet.yourname.com, with three users: one administrator for you, and two meeting accounts, for example q@meet.yourname.com and q2@meet.yourname.com (Recall suggests two to start). That is 3 × $7 = **$21 a month** on the yearly plan, or $25.20 month to month. The meeting accounts must not be administrators. Q is added to every meeting invite as that account, so Google lets it straight in. Google can still show its own warning label on an outside account; only Google can lift it, and we'll check this on the first test call. Your own email mailbox, if you want one, is a separate Workspace.
- **Item 26, Stripe and the company.** Stripe only opens accounts for companies registered in the countries it supports. Nigeria isn't one of them: Stripe's own country list sends Nigerian, Ghanaian, Kenyan, South African and Ivorian businesses to Paystack. So Stripe needs a company abroad, for example a US company formed through Stripe Atlas, or a UK company. If you already have one, use it. Paystack needs the Nigerian company's registration documents.

## How to read the numbers

Every figure comes from one of three places, and I say which:

- **Price page.** The provider's own public pricing page, checked on 18 November 2026. Links are in the sources list at the end.
- **Measured.** What our own system actually spent in production, read from our usage records. This is the most reliable figure we have.
- **Estimate.** My own working, shown so you can check it. Treat these as rough.

Where a provider's own page was blocked or unclear, I used a second-hand source and say so. Please check those in the provider's dashboard before paying.

Two scenarios run through this document:

- **Minimum to launch.** A soft launch with a few hundred people a month and a handful using Q at the same moment. This is close to what we have today: in the last 30 days, 248 people used Q and the AI bill was $78.68 (measured).
- **Comfortable for 1,000 people at the same time.** A big step up. As a rule of thumb, 1,000 people online at once means about 10,000 people using the product each day, and roughly 100,000 registered accounts. I assume each daily user asks Q about 5 questions a day (estimate, from our scale review).

## 1. What one use of Q costs us

These unit costs drive everything else, including the plan prices in section 4.

| One unit                                    | What it costs us                                                                                           | Where the figure comes from                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One typed question to Q                     | **$0.03** on average. Half cost under $0.019. One in twenty costs $0.08 or more.                           | Measured: 447 questions in the last 7 days.                                                                                                                 |
| Background work per question                | About half again on top (reading documents, research jobs, onboarding).                                    | Measured: in the last 30 days, $17 of AI spend happened outside questions (not counting voice) against $31 inside them.                                     |
| **Planning figure per question**            | **$0.045**                                                                                                 | $0.03 × 1.5                                                                                                                                                 |
| One minute of live voice with Q             | About **$0.09** for the voice itself, plus questions Q looks up while talking. **Planning figure $0.11.**  | Measured: $30.17 of realtime voice over about 328 conversation minutes in 30 days. The minute count is approximate, so this could be somewhat lower.        |
| One minute of a meeting with Q's video face | About **$0.35** for the face, plus about $0.01 for the meeting bot. **Planning figure $0.40.**             | Measured: 17 settled meeting minutes cost $5.95 on the face provider. Meeting bot: Recall's price page, $0.50 per hour plus $0.15 per hour for transcripts. |
| One web search                              | $0.001 to $0.008, depending on provider. Our last-resort search through the AI provider costs about $0.01. | Price pages (Serper, Brave, Tavily, OpenAI and Anthropic).                                                                                                  |
| One deep research job                       | **$0.25** (cautious estimate)                                                                              | Measured total: $4.15 for all delegated work in 30 days. The per-job figure can't be read cleanly from our records, so I've rounded it up.                  |

One important point: we decided on 6 November that we cut costs only in ways that don't reduce Q's quality: saving repeated work, reusing what the AI has already read, and avoiding duplicate calls. No smaller models and no trimmed instructions. So these unit costs will fall a little over time, not dramatically. We keep working on it: on 18 November, better reuse of what the AI has already read (prompt caching) cut about 11% from each question, with no change to the answers. Today only 35% of what the AI reads is reused this way (measured, scale review), so there is more to gain.

**The biggest further saving needs your agreement.** Our scale review found that quick internal sorting steps, which decide what kind of question it is before Q answers, cost more in total than Q's ordinary conversation ($15.23 against $8.71 over 14 days, measured), partly because many are started early and then thrown away. Running those steps on a smaller, cheaper model, while the answer itself still comes from the strongest model, is the largest lever left. The review's target, combining this with fewer wasted steps and more reuse, is to bring the AI cost of each answer from about $0.022 to about $0.008 (estimate; the review measured 915 answers over 14 days, counted slightly differently from the $0.03 above). Because it changes the 6 November quality-first decision, I'll only do it with your yes (item 10 in the list above).

## 2. What we pay for, and the amounts

### The short version

- **At launch, the expected bill is about $435 a month,** plus about $21 for Q's meeting account once you set it up (item 24). That is the left-hand column of the table below.
- **The "1,000 people online at once" column is not a bill we face at launch.** It shows what the costs would be if Capital Q became very busy: roughly 10,000 people using it every day and about 30,000 different people a month. We would only reach it gradually, and the bill grows only as people actually use Q.
- **Most of that bigger figure is AI usage, and subscriptions pay for it.** Of the $67,000–$91,000 a month, only about $2,800 is hosting, the database, email, search, read-aloud voice, the meeting bot and video storage. The rest is AI, live voice and Q's video face, used by people who are on plans. Free accounts get small allowances, so free use can't run away with the bill.
- **A worked example is below the table.** In it, the subscriptions bring in about four to five times what the platform costs at that size.

### Monthly costs

| Service                                                                          | What it does                                                                                  | Minimum to launch                                   | Comfortable for 1,000 at once     | Working and source                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hosting: Railway**                                                             | Runs our four programs: the website, the main server, the Q server and the background worker. | **$90**                                             | **$750**                          | Price page: Pro plan $20 a month including $20 of usage; memory about $10 per GB a month, processor about $20 per core a month. Measured: our programs use about 5.7 GB of memory together and very little processor. At 1,000 at once (estimate): 2–4 copies of each program, about 20 GB and 10 cores on average, about 2 TB of traffic at $0.05 per GB, plus a small shared memory store (about $50–100). |
| **Virus scanner**                                                                | Checks every uploaded file for viruses before anyone can open it. Runs on Railway.            | **$12**                                             | **$30**                           | Measured: 1.1 GB of memory at $10 per GB. Two copies at the larger size.                                                                                                                                                                                                                                                                                                                                     |
| **Database: Supabase**                                                           | Stores all accounts, companies, documents and history.                                        | **$40**                                             | **$600**                          | Price page: Pro plan $25 a month including $10 of computer time. Production on the Small size ($15), staging on Micro ($10): $25 + $15 + $10 − $10 = **$40**. At 1,000 at once: XL size ($210), one read-only copy to share the load ($210), staging ($10), point-in-time backup ($100), some extra traffic (about $50), less the $10 credit.                                                                |
| **AI for typed questions** (OpenAI, Anthropic, small amounts on Google and Groq) | Q's thinking and writing.                                                                     | **$100** expected; at most $1,500 under today's cap | **$45,000–$68,000**               | Measured: $48 in 30 days for 248 people, without voice. Allowing for growth at launch: about $100. At 1,000 at once: 10,000 daily users × 5 questions × 30 days = 1.5 million questions × $0.03 to $0.045.                                                                                                                                                                                                   |
| **Live voice** (OpenAI realtime)                                                 | Talking to Q out loud.                                                                        | **$40** expected; at most $1,200 under today's caps | **$15,000**                       | Measured: $30.17 in 30 days. At 1,000 at once (estimate): 1 in 10 daily users talks for 5 minutes a day = 150,000 minutes × $0.10.                                                                                                                                                                                                                                                                           |
| **Read-aloud voice: ElevenLabs**                                                 | Q's spoken narration on tours and answers.                                                    | **$22** (Creator plan)                              | **$299** (Scale plan)             | Price page: Creator $22 for 275,000 characters and 10 at once; Scale $299 for 3.7 million characters and 30 at once; Business $990 for 40 at once.                                                                                                                                                                                                                                                           |
| **Speech-to-text: Deepgram**                                                     | Turning speech into text where the voice provider doesn't.                                    | **$0**                                              | **$0–700**                        | Price page: new accounts get $200 of free credit; $0.0048 a minute after that; 150 streams at once. The upper figure assumes all 150,000 voice minutes go through it, which they don't today.                                                                                                                                                                                                                |
| **Q's video face: Tavus**                                                        | The face Q shows in meetings and pitch rehearsals.                                            | **$59** (Builder plan)                              | **$4,400**                        | Price page: Builder $59 includes 175 minutes and 3 calls at once, then $0.35 a minute; Business $975 includes 4,000 minutes and 15 at once, then $0.26 a minute. At 1,000 at once (estimate): 200 meetings a week of 20 minutes = about 17,000 minutes: $975 + 13,000 × $0.26.                                                                                                                               |
| **Meeting bot: Recall**                                                          | Lets Q join a video meeting, listen and take notes.                                           | **$5**                                              | **$190**                          | Price page: $0.50 an hour plus $0.15 an hour for transcripts, first 5 hours free. 17,000 minutes is about 290 hours × $0.65.                                                                                                                                                                                                                                                                                 |
| **Web search** (see below for which ones)                                        | Q's public research on companies and markets.                                                 | **$50**                                             | **$650**                          | Price pages. Minimum: a Serper pack plus a small Brave balance. At 1,000 at once (estimate): 1 in 10 questions searches 3 times = 450,000 searches a month, mostly on Serper's cheaper large pack ($375 for 500,000) with Brave as backup.                                                                                                                                                                   |
| **Last-resort search through the AI provider**                                   | Used only when every search provider is empty.                                                | **$10** expected; at most $60                       | **$60**                           | Our cap is $2 a day.                                                                                                                                                                                                                                                                                                                                                                                         |
| **Video hosting: Cloudflare Stream**                                             | Stores and plays founders' pitch videos.                                                      | **$5**                                              | **$100**                          | Price page: $5 a month per 1,000 minutes stored, $1 per 1,000 minutes watched.                                                                                                                                                                                                                                                                                                                               |
| **Email sending: Brevo**                                                         | Sign-in codes, meeting invitations, alerts.                                                   | **$0** (free, 300 a day)                            | **$50**                           | Free plan is 300 emails a day (several reviews agree). Paid Starter is reported at about $32 a month for 20,000 emails; I couldn't open Brevo's own page, so please confirm.                                                                                                                                                                                                                                 |
| **Domain and DNS**                                                               | The web address and the settings that point it at our site.                                   | **$1**                                              | **$1**                            | Cloudflare sells .com at cost, about $10.46 a year (reported by several sites); its DNS service is free. A .ai address costs much more (see section 6).                                                                                                                                                                                                                                                      |
| **Monitoring**                                                                   | Tells us when something breaks.                                                               | **$0**                                              | **$45**                           | We already have built-in alerts that email the admins, and Railway's logs. At scale, add Sentry Team ($29 a month, price page) and an uptime checker (about $15).                                                                                                                                                                                                                                            |
| **Backups**                                                                      | Copies of the database in case of mistakes or failures.                                       | **$0**                                              | included above                    | Supabase Pro keeps daily backups for 7 days at no extra cost (price page). Point-in-time recovery ($100) is in the database line for the larger scenario.                                                                                                                                                                                                                                                    |
| **Total**                                                                        |                                                                                               | **about $435 a month**                              | **about $67,000–$91,000 a month** | Sum of the lines above, using the low and high ends of each range.                                                                                                                                                                                                                                                                                                                                           |

How to read the two totals:

- **At launch,** about $435 a month is the expected bill. The daily caps (section 3 below) stop a bad day from becoming a disaster. The worst case if every cap were hit every single day would be about $2,800 for AI, voice and search combined, which won't happen at our current traffic.
- **At 1,000 at once,** the platform itself (hosting, database, scanner, email, monitoring) is only about **$1,500 a month**, and search, read-aloud voice, the meeting bot and video hosting add about $1,300. Everything else, roughly 95% of the bill, is AI, live voice and Q's video face, and that grows only with how much people use it.

### Worked example: 1,000 people online at once

All figures are estimates built from the plans in section 4 and the costs above.

**Who the people are.** 1,000 online at once means about 10,000 people a day and about 30,000 different people a month. Suppose 1 in 5 of them pays, which is 6,000 paying customers, spread like this:

| Plan            | Customers | Price | Revenue a month |
| --------------- | --------- | ----- | --------------- |
| Founder Pro     | 3,600     | $29   | $104,400        |
| Founder Premium | 1,200     | $99   | $118,800        |
| Investor Pro    | 1,000     | $79   | $79,000         |
| Investor Team   | 200       | $299  | $59,800         |
| **Total**       | **6,000** |       | **$362,000**    |

That is an average of about $60 per paying customer. The other 24,000 people stay on the free plans.

**What it costs us.**

| Line                                                              | A month               |
| ----------------------------------------------------------------- | --------------------- |
| Everything in the right-hand column of the table above            | $67,000–$91,000       |
| Payment fees, about 4% of revenue                                 | about $14,500         |
| **Total cost**                                                    | **$81,500–$105,500**  |
| **Left over** before salaries, the lawyer and other company costs | **$256,500–$280,500** |

**The worst case.** Even if every paying customer used every unit in their plan, every month, the AI, voice and face cost for them would be about $168,000 (3,600 × $12.30 + 1,200 × $54.70 + 1,000 × $27.10 + 200 × $156, from section 4). The 24,000 free users can use at most $2.23 each (section 4), under $54,000. With about $2,800 of running costs and about $14,500 of payment fees, that is about $239,000, still well below the $362,000 coming in. This is why plans are allowances with top-ups: usage beyond a plan is paid for before it happens.

**Where the break-even sits.** At the top of the cost range ($91,000 plus fees), about 1,600 paying customers at $60 cover the platform: roughly 1 in 19 of the 30,000 monthly users.

**If fewer people pay.** If only 1 in 10 pays (3,000 customers, about $180,000 a month), there is still about $82,000–$106,000 left after costs and payment fees. The daily caps in section 3 also mean spending can never run ahead of what we've chosen to allow.

### The database: production and staging

On 17 November we agreed that the current database becomes **staging** (our test copy) and **production** gets a brand-new project. That means paying for two projects.

- Each Supabase project is billed separately. The Pro plan's $10 credit covers one small one.
- **Can staging be made cheaper?** It already runs on the smallest paid size (Micro, $10 a month), so that's the floor for a paid project. A free project pauses itself after a week without use and has a 500 MB database limit. Our staging database is 620 MB, so it would not fit without deleting test data. I recommend keeping staging on Micro at $10 a month.
- **Production size.** Our scale review found the smallest size (Micro, 1 GB of memory, 60 connections) will struggle somewhere around 50 to 150 people asking Q at the same moment. I recommend starting production on **Small ($15)** and moving to **Medium ($60)** as soon as we see steady daily use. Moving up takes a few minutes of downtime and is done from the dashboard.
- **Region.** Our servers run in Amsterdam. Staging's database is in Frankfurt. I recommend creating production in Frankfurt too: it's a few milliseconds from Amsterdam and is the setup we already know works. Supabase doesn't currently list an African region.

### One-off costs

| Item                                                   | Amount                                  | Notes                                                                                                               |
| ------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Domain, .com                                           | about $10.46 a year                     | Price reported for Cloudflare's at-cost registrar.                                                                  |
| Domain, .ai (if wanted)                                | about $140–$180 for the first two years | Estimate. .ai addresses are usually sold for two years at a time at roughly $70–$90 a year. Check at checkout.      |
| Lawyer: terms, privacy policy and data agreements      | about $500–$2,000                       | Estimate. Get two quotes.                                                                                           |
| Lawyer: securities opinion on fees tied to investments | about $1,000–$5,000                     | Estimate. Only needed if we want to charge a fee on money raised (section 4).                                       |
| Nigeria data-protection registration (NDPC)            | set by the regulator's fee schedule     | The fee depends on our size category. I couldn't confirm the exact figure online, so the lawyer should check it.    |
| First search credit packs                              | about $75                               | Serper $50 pack and Brave $25.                                                                                      |
| Load test on staging (optional)                        | about $60–$125                          | From our scale review: proves how many people we can handle before we spend on bigger servers. Needs your approval. |
| Trademark search and filing for the new name           | about $300–$1,500                       | Estimate. Depends on country and the number of classes.                                                             |

### Which search providers to top up

Today Serper, Tavily, SerpApi and ScrapingBee are out of credit or blocked, and Brave is close to empty. Q is falling back to the paid search inside the AI provider, which is capped at $2 a day.

I recommend topping up two:

1. **Serper:** the cheapest by far. A $50 pack buys 50,000 searches ($1 per 1,000), and bigger packs are cheaper still. The credit is reported to expire after 6 months. Serper's own pricing page wouldn't load, so these figures come from several independent sites; check them in the dashboard.
2. **Brave:** $5 per 1,000 searches with $5 free each month. It handles 50 searches a second, and it's the provider our research already leans on.

Start with **$50 on Serper and $25 on Brave.** Tavily ($0.008 a search, 1,000 free each month) can stay on its free allowance as a third option.

## 3. How to stop running out

### Top-up or auto-recharge, provider by provider

| Provider              | How it bills                | My recommendation                                                                                                                                                     |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                | Prepaid credit              | **Turn on auto-recharge** (for example, add $100 when the balance drops below $50) and set a monthly spending limit in its dashboard. Running dry stops Q completely. |
| Anthropic             | Prepaid credit              | Same as OpenAI, with smaller amounts (for example, add $50 below $25).                                                                                                |
| Google (Gemini), Groq | Pay as you go on a card     | Leave on a card. We spent under $1 last month.                                                                                                                        |
| ElevenLabs, Tavus     | Monthly plan                | Plan on a card. Tavus Builder charges $0.35 a minute beyond 175 minutes. Our own monthly safeguard already limits meeting video to 85 minutes.                        |
| Deepgram              | Free $200 credit, then card | Add a card before the credit runs out, otherwise it stops working.                                                                                                    |
| Recall                | Pay as you go               | Card on file.                                                                                                                                                         |
| Serper, Brave         | Prepaid packs               | Top up by hand. Our system tells us when one runs dry, and Q switches to the next.                                                                                    |
| Railway, Supabase     | Monthly bill on a card      | A card with enough headroom. In October the database was briefly restricted after it hit a traffic limit, so set a spending alert in Supabase.                        |

### Our own safety caps, in plain words

We built caps into Capital Q so that a bug or a sudden crowd can't empty the bank account overnight.

- **AI: $50 a day.** Across the whole platform, Q can spend at most $50 on AI per day. At today's cost per question, that's roughly 1,100 to 1,600 questions a day, enough for about 100 to 200 active people. When the cap is reached, Q stops answering until midnight UTC (1 a.m. in Lagos). Admins get an email when spending reaches 80% of the cap.
- **Voice: $20 a day for each of the two voice lines.** Enough for about 80 to 130 voice conversations a day. When it's reached, voice stops for the day and typing still works.
- **Search fallback: $2 a day.** The last-resort search through the AI provider stops at $2 a day; ordinary search providers carry on.
- **Per person:** at most 20 questions a minute and 300 a day, and at most 20 voice starts in 10 minutes. This stops one account from using up everyone's allowance.

As subscriptions start paying, we raise the caps in step with revenue. Every change is a single setting, and I'll keep a note of the amounts.

### Suggested first top-ups from a $1,000 budget

| Item                                                     | Amount                                  |
| -------------------------------------------------------- | --------------------------------------- |
| OpenAI credit (with auto-recharge on)                    | $300                                    |
| Anthropic credit (with auto-recharge on)                 | $100                                    |
| Railway, first month (Pro plan plus usage)               | $100                                    |
| Supabase, first month (production Small + staging Micro) | $40                                     |
| Tavus Builder                                            | $59                                     |
| ElevenLabs Creator                                       | $22                                     |
| Serper pack                                              | $50                                     |
| Brave credit                                             | $25                                     |
| Recall credit                                            | $20                                     |
| Domain (.com)                                            | $12                                     |
| Google Workspace for Q's meeting account (3 users)       | $21                                     |
| Deepgram, Brevo, Sentry, Google, Groq                    | $0 to start (free credit or free plans) |
| **Reserve** for surprises, or a .ai domain               | **$251**                                |
| **Total**                                                | **$1,000**                              |

This covers the first month comfortably at today's traffic. The lawyer's fees are not included.

## 4. Subscription plans

### Rules the plans must respect

These come from the locked product decisions, and the plans below follow them:

- **The diagnosis is free.** A founder's full InvestIQ assessment (strengths, gaps, risks, readiness) is never put behind a paywall. Paid value comes from the deeper Readiness Blueprint, more Q, and human help.
- **No paying to rank.** Nobody can pay to appear higher in investors' feeds.
- **Investors never pay for visibility or anonymity.** They are the scarce side. Founders can pay, on mid tiers and up, to see which investors viewed them, but only investors who chose to be visible.
- **Human execution is separate.** Specialist help (financial preparation, data room set-up, fundraising support) is quoted on its own, not hidden inside a plan.
- **Plans are allowances, never locks** (your decision of 18 November). Everyone, on every plan, can ask Q and have Q in their meetings. A plan sets how much is included, and anyone can buy a top-up or upgrade.

**One thing to tidy before prices are final.** The tables below were drafted before that last decision, so a few lines still read like features reserved for paid plans: the Readiness Blueprint, the data room, seeing which investors viewed you, the GateQ intake inbox, and tables and visuals. Before I set up prices (item 2 in the list at the top), I'll turn each into an allowance instead, for example one Readiness Blueprint free and more on paid plans. One point to confirm with you: the original product decisions describe the deeper Readiness Blueprint as part of what founders pay for. Under the new rule it becomes a larger allowance on paid plans rather than paid-only. The costs and margins below don't change much either way.

### What comparable products charge

| Product                      | What it is                    | Price                                   | Source                                                  |
| ---------------------------- | ----------------------------- | --------------------------------------- | ------------------------------------------------------- |
| ChatGPT Plus, Perplexity Pro | General AI assistants         | $20 a month                             | Several comparison sites                                |
| Crunchbase Pro               | Company and funding data      | $49–$99 a month                         | Several comparison sites                                |
| Visible                      | Investor updates for founders | Free, then about $59–$249 a month       | Review sites; prices differ between them                |
| Affinity                     | CRM for venture investors     | $2,000–$2,700 per user per year         | Affinity's price page                                   |
| PitchBook                    | Private markets data          | about $12,000–$20,000 per user per year | Third-party estimates; PitchBook doesn't publish prices |

So a founder plan around $29–$99 and an investor plan around $79–$299 sits sensibly between general AI tools and specialist investor software.

### Proposed plans

The working below uses the planning unit costs from section 1: $0.045 a question, $0.11 a voice minute, $0.40 a Q-face minute and $0.25 a research job. Payment fees are taken at about 4% (Paystack's international card rate is 3.9% plus ₦100; Stripe's is 2.9% plus 30¢ plus 0.7% for subscriptions).

**"Full use"** means someone uses every unit in their plan, which is the worst case for us. **"Typical"** assumes half, which is common for subscriptions (estimate).

**For founders**

| Plan                | Price                 | Included each month                                                                                                                       | Our cost at full use                                 | Margin at full use           | Margin at typical use |
| ------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------- | --------------------- |
| **Founder Free**    | $0                    | Full InvestIQ diagnosis, profile, GateQ applications, 25 questions to Q, 10 voice minutes                                                 | $2.23                                                | (our cost to win a customer) |                       |
| **Founder Pro**     | **$29** ($290 a year) | 200 questions, 30 voice minutes, the Readiness Blueprint, data room, see which visible investors viewed you                               | 200 × 0.045 + 30 × 0.11 = $12.30, plus fees $1.30    | **$15.40 (53%)**             | $21.55 (74%)          |
| **Founder Premium** | **$99** ($990 a year) | 600 questions, 120 voice minutes, 30 minutes with Q's video face (pitch rehearsal or meetings), tables and visuals, 10 deep research jobs | $27 + $13.20 + $12 + $2.50 = $54.70, plus fees $3.90 | **$40.40 (41%)**             | $67.75 (68%)          |

**For investors**

| Plan              | Price                                       | Included each month                                                                                                                                                                   | Our cost at full use                                | Margin at full use           | Margin at typical use |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------- | --------------------- |
| **Investor Free** | $0                                          | Mandate set-up, personalised feed, save, pass and express interest, 25 questions                                                                                                      | $1.13                                               | (our cost to win a customer) |                       |
| **Investor Pro**  | **$79** per person ($790 a year)            | 400 questions, 60 voice minutes, company comparisons, 10 deep research jobs, GateQ intake inbox                                                                                       | $18 + $6.60 + $2.50 = $27.10, plus fees $3.10       | **$48.80 (62%)**             | $62.35 (79%)          |
| **Investor Team** | **$299** for up to 3 people ($2,990 a year) | 1,500 questions shared, 300 voice minutes, 120 minutes with Q's video face (meetings with founders), GateQ gateway with your own intake address, tables and visuals, 30 research jobs | $67.50 + $33 + $48 + $7.50 = $156, plus fees $11.70 | **$131.30 (44%)**            | $209 (70%)            |

**Top-up packs** for anyone who runs out:

| Pack                          | Price | Our cost | Margin |
| ----------------------------- | ----- | -------- | ------ |
| 100 more questions            | $9    | $4.50    | 50%    |
| 60 more voice minutes         | $12   | $6.60    | 45%    |
| 30 more minutes with Q's face | $25   | $12      | 52%    |

**Prices in Nigeria.** Paystack charges in naira. I suggest showing a naira price set from the dollar price and reviewed every quarter, so currency swings don't eat the margin. If you want a lower local price for founders, Founder Pro at the equivalent of about $19 still covers full use ($12.30 + fees), but with a thin margin. I'd rather start at the same price and offer annual discounts.

### What happens when someone reaches their limit

- At 80% of any allowance, Q mentions it once, in plain words.
- At 100%, Q says so and offers a top-up pack or an upgrade. It never cuts off an answer halfway through.
- A voice conversation gets a two-minute warning before its minutes run out, then ends politely. Typing still works.
- Meetings with Q's face can't be booked beyond the allowance. Q says so when you try to book, not on the day.
- The free diagnosis and the person's own data always stay available.
- The platform-wide caps from section 3 still apply on top, to protect us.

**Not built yet:** we already record usage per person and have video allowances in the database, but there's no payment provider connected and no plan screens. That has to be built before we can charge (section 9).

## 5. How we get paid

### Subscriptions

| Provider        | Good for                                                                                         | Fees (from the provider or its official help pages)                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Paystack**    | Nigeria and other African countries: cards, bank transfer, USSD. Supports monthly subscriptions. | Local cards 1.5% + ₦100, capped at ₦2,000; ₦100 waived under ₦2,500. International cards 3.9% + ₦100.                        |
| **Flutterwave** | Wider African coverage                                                                           | 2% for local Nigerian payments; 4.8% for international cards; plus 7.5% VAT on fees.                                         |
| **Stripe**      | International customers (Europe, US, UK)                                                         | 2.9% + 30¢ per card, plus 1.5% for international cards, plus 1% for currency conversion, plus 0.7% for subscription billing. |

**My recommendation, as you decided on 18 November: run both.**

- **Stripe for international customers** (Europe, the US, the UK and elsewhere). Our system already has a Stripe connection built and tested, so it's the quickest to switch on.
- **Paystack for African customers.** It takes naira, local cards, bank transfer and USSD, and it supports monthly subscriptions. Stripe owns Paystack.
- **Flutterwave** stays the fallback if we need an African country Paystack doesn't cover.

Each customer pays through one of them, chosen by where they are. Connecting Paystack is a few days of extra work on my side.

**What Stripe needs, simply.** Stripe only opens accounts for companies registered in a country it supports. Nigeria isn't one: Stripe's own country list sends businesses in Nigeria, Ghana, Kenya, South Africa and Côte d'Ivoire to Paystack instead. So to use Stripe, the business needs a company registered abroad, for example in the US or the UK. If you already have one, we use it. If not, Stripe's own service, Stripe Atlas, forms a US (Delaware) company for $500 once, including the first year of its registered address, then $100 a year plus Delaware's yearly fees (Stripe's price page). Please ask the lawyer or an accountant how that foreign company and the Nigerian company should relate before you set it up. Paystack needs the Nigerian company's registration documents.

**We never touch investment money.** Both providers only collect our own subscription fees. Capital Q never holds, receives or passes on money that investors put into companies. It records commitments and the evidence that money arrived, and nothing more.

### A fee on money raised (success fees)

You asked about taking a percentage when a founder raises money through Capital Q. Here's what the market looks like:

- **Finders** (people who introduce investors) are commonly paid **1–5%** of the money raised.
- **Placement agents** (firms that run the raise) commonly take **2–7%** on small private rounds, sometimes plus a small share option.
- **The Lehman formula** comes from company sales: 5% of the first $1 million, 4% of the second, 3% of the third, 2% of the fourth and 1% above that. The modern "double Lehman" doubles each step (10%, 8%, 6% and so on).

I couldn't find an authoritative source for a single "standard" seed-round fee. These ranges come from advisers' and law firms' published guides, listed in the sources.

### The legal side: please read this before charging any success fee

**Taking a percentage of investments usually requires a financial licence.** Roughly:

- **Nigeria:** the Investments and Securities Act 2025 and the SEC's rules require firms that bring investors and companies together for securities deals to be registered. That covers capital market operators, crowdfunding platforms, brokers and advisers. Crowdfunding platforms alone face a ₦1,000,000 registration fee plus capital, insurance and reporting requirements.
- **UK:** "arranging deals in investments" is an activity the FCA regulates. There is a narrow exclusion for pure introductions, but the courts read it strictly once the introducer does anything more.
- **US:** the SEC's long-standing view is that anyone paid a fee tied to a completed investment is acting as a broker and must register. A proposed exemption for finders (2020) was never adopted. Unregistered fees can let the investor undo the investment, which also hurts the founder.

Our own product rules also say Q must never imply brokerage or regulated advisory status. A success fee would cut against that.

**Safer options while a lawyer reviews it:**

1. **Subscriptions only.** This is my recommendation for launch, and it needs no licence for the fee itself.
2. **Flat fees for services** that don't depend on whether money is raised. Examples: preparing a data room, a diligence pack, or a readiness review by the human team.
3. **A partnership with a licensed placement agent or broker** who charges the success fee under their own licence. Any referral payment to us also needs the lawyer's sign-off.
4. **Our own licence later,** once volumes justify the cost and the compliance work.

**Please don't charge any fee tied to investment amounts until a securities lawyer in each country we serve has reviewed it.**

### How we would actually collect

- **Subscriptions:** charged automatically through Stripe (international customers) or Paystack (African customers) each month or year. Receipts and invoices are sent by email.
- **Larger flat fees (services, Investor Team):** an invoice with a payment link (Paystack or Stripe invoicing), payable within 14 days.
- **Contract terms to have in place:** what is being delivered, the price and currency, when it's payable, refunds, VAT (7.5% in Nigeria), cancellation, and limits on our liability.
- **If a success fee is ever approved:** a signed engagement letter that defines exactly when the fee is earned, a "tail" period (usually 12–24 months after the work ends), and payment through a licensed escrow or trustee at closing, not after.

## 6. Where to host: is Railway right?

| Option               | What it is                                          | Rough monthly cost for us now                           | Effort to run                                                                        | Scaling                                                            | Regions near our users                                                         |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Railway** (today)  | Managed hosting: we push code, it runs.             | about $100                                              | Low. Already set up, with safe releases and rollbacks.                               | Copies of each program at the press of a button on Pro (up to 42). | Amsterdam (where we are), US, Singapore. No Africa.                            |
| **Contabo**          | Cheap rented server; we manage everything ourselves | about $8–$30 (6 cores and 12 GB from about €7 a month)  | High: security updates, backups, monitoring, restarts and deployments are all on us. | By hand only.                                                      | Europe, US, UK, Asia. No Africa.                                               |
| **Hetzner**          | Cheap, well-regarded rented servers; we manage them | about $20–$80 (from €5.49, dedicated cores from €36.99) | High, same as Contabo, but more reliable hardware.                                   | By hand or with extra tooling.                                     | Germany, Finland, US, Singapore.                                               |
| **DigitalOcean**     | Managed hosting, similar to Railway                 | about $100–$150 ($5–$50 per program)                    | Low to medium                                                                        | Automatic scaling only on dedicated sizes                          | Europe and US. No Africa.                                                      |
| **Fly.io**           | Managed hosting with many regions                   | about $100–$200                                         | Medium                                                                               | Good                                                               | Has Johannesburg (about 30% dearer), but traffic to Africa costs $0.12 per GB. |
| **Google Cloud Run** | Google's managed hosting, billed by the second      | about $50–$150                                          | Medium to high to set up, then low                                                   | Excellent, automatic                                               | Has Johannesburg.                                                              |

What matters most for speed:

- **The database location matters more than the server's.** Every page Q builds makes many trips between our server and the database, so the two must sit close together. That means moving the server to Johannesburg alone would make things slower, not faster.
- **Lagos to Amsterdam is fast enough.** The connection takes roughly a tenth of a second. The waiting people notice is Q thinking (about 7–15 seconds per answer), not the distance.

**My recommendation:**

- **Now:** stay on **Railway**, move to the **Pro plan** (needed for more copies of each program, 30 days of logs and team access), and keep everything in Amsterdam with the database in Frankfurt. Changing host now would cost weeks and buy us almost nothing.
- **Later,** at around 1,000 people at once: revisit. The two sensible options are Railway's enterprise plan or Google Cloud Run in the same region as the database. A cheap self-managed server (Contabo or Hetzner) only makes sense once we have someone whose job is to look after servers. Saving $50 a month isn't worth the risk to a product that holds investors' confidential documents.

## 7. Name and domain

### The problem with "Capital Q"

A quick search shows **Capital Q Ventures**, a venture capital firm in Florida, and **Capital Q Management LLC**, an investment adviser registered with the US SEC. They're in the same industry as us. That's a real trademark risk, especially if we ever serve US investors. There are also several "Q Capital" firms.

### Suggestions: every name contains Q

You asked for a name with Q in it, and told me Qadence already exists, so it's off the list. Here are 14 names where the Q is prominent. Q stays the name of the analyst inside the product whichever name you choose.

**How I checked, and what it doesn't cover.** On 18 November I looked up each address in the public domain registries (the official lookups run by each ending's registry: Verisign for .com, Identity Digital for .ai and .io, and the .co registry). "Free" means the registry had no record of it that day. A free address can still be reserved by the registry or sold at a premium price, so check at checkout. I also ran a quick web search for companies or products with the same or a very similar name in investing, finance or AI. **This is not a trademark search.** Before you commit, a trademark lawyer or agent should search the official registers in Nigeria, the UK, the US and any other country we plan to serve (about $300–$1,500, section 2).

| #   | Name            | Why it fits                                                                                         | .com  | .ai   | .io   | .co   | Conflicts found in a quick search                                                                          |
| --- | --------------- | --------------------------------------------------------------------------------------------------- | ----- | ----- | ----- | ----- | ---------------------------------------------------------------------------------------------------------- |
| 1   | **Qvidence**    | Q + evidence. "Evidence before opinion" is our first principle. (Carried over from the first list.) | free  | free  | free  | free  | No exact match. Nearest is Qvidian, proposal-writing software from Upland, in a different field.           |
| 2   | **Qertain**     | Sounds like "certain". Capital Q exists to reduce investment uncertainty.                           | free  | free  | free  | free  | No exact match. A Belgian company called Quertain & Co, with no stated line of business.                   |
| 3   | **Qmandate**    | An investor's mandate is where every match starts. Says "investing" at once.                        | free  | free  | free  | free  | None found. It speaks more to investors than to founders.                                                  |
| 4   | **Qorroborate** | Q + corroborate: checking a claim against other sources, which is what Q does.                      | free  | free  | free  | free  | None found. Long and hard to spell or say on a call.                                                       |
| 5   | **Diligenq**    | Q + diligence.                                                                                      | free  | free  | free  | free  | **Too close** to DiligentIQ (now ToltIQ) and DiligenceSquared, both due-diligence AI for investors. Avoid. |
| 6   | **Evidenq**     | Q + evidence.                                                                                       | free  | free  | free  | free  | **Too close** to Eviden, a large technology brand of the Atos group. Avoid.                                |
| 7   | **Qonviction**  | Investors back companies they have conviction in.                                                   | taken | free  | free  | free  | No exact match. "Conviction" appears in many fund names.                                                   |
| 8   | **Provenq**     | From "proven" and "provenance": where every fact came from.                                         | taken | free  | free  | free  | None found.                                                                                                |
| 9   | **Qround**      | A funding round, run with Q.                                                                        | taken | free  | free  | free  | None found in finance.                                                                                     |
| 10  | **Thesiq**      | From "investment thesis".                                                                           | taken | taken | free  | free  | None found.                                                                                                |
| 11  | **Qredence**    | Q + credence: belief earned by evidence.                                                            | taken | taken | free  | free  | **Taken in AI:** a company called Qredence sells AI tools to businesses. Avoid.                            |
| 12  | **Qandor**      | Q + candour: honest about what is and isn't known.                                                  | taken | taken | taken | taken | None found in finance, but every address is taken.                                                         |
| 13  | **Qlarity**     | Q + clarity.                                                                                        | taken | taken | taken | taken | Close to ClarityQ, a funded AI start-up. Avoid.                                                            |
| 14  | **Qlens**       | A clear lens on a company.                                                                          | taken | taken | free  | free  | Close to LensAI and other "lens" AI products.                                                              |

Longer .com addresses that also came back free, if you prefer a short name with a longer address: **qvidencehq.com**, **qfounders.com** and **qcapitalhq.com**.

**My top three:**

1. **Qvidence.** The strongest. All four addresses appear free, the Q is the first letter, and it says our first principle out loud. The nearest name I found, Qvidian, is in a different field.
2. **Qertain.** All four addresses appear free, it's easy to say, and it names what investors want most: more certainty. The only near match is a small Belgian company with no stated business.
3. **Qmandate.** All four addresses appear free and nothing similar turned up. It's the clearest about investing, but it leans towards investors; founders may relate to it less.

Diligenq and Evidenq look tempting because every address is free, but each is too close to an established name in our field or in technology.

### Setting up the domain, step by step

1. **Buy the domain** at an at-cost registrar such as Cloudflare. Turn on auto-renew and the lock that stops it being moved without you.
2. **Point it at the site.** I add the address to Railway, which then gives a couple of settings to paste into the domain's DNS (the address book that tells browsers where our site lives). The secure padlock certificate is created automatically.
3. **Set up email sending so it doesn't land in spam.** Add three standard records that prove our emails are really from us: SPF (lists who may send), DKIM (a digital signature) and DMARC (tells inboxes what to do with fakes). Brevo shows the exact values. I'd send from a sub-address such as mail.yourname.com, so the main domain's reputation stays clean.
4. **Set up a mailbox** for people to reply to, and an inbox address for GateQ. Google Workspace Business Starter costs $7 a person a month on a yearly plan, or $8.40 month to month (Google's help page). This is separate from the small Workspace for Q's meeting account (item 24 at the top).
5. **Set up Q's meeting account** on a sub-address such as meet.yourname.com (item 24), so Q joins meetings signed in and skips the waiting room.
6. **Move users over.** Keep the old address redirecting to the new one for at least a year.

## 8. Legal and compliance documents

| Document                                 | What it is, simply                                                                                                                        | Why we need it                                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Terms of service**                     | The rules for using Capital Q, what we promise and what we don't, and how disputes are settled                                            | Required to take payment and to limit our liability                                                                                                                                                   |
| **Privacy policy**                       | What personal data we collect, why, who we share it with (our AI, voice and video providers) and people's rights                          | Required by Nigeria's data law and Europe's GDPR                                                                                                                                                      |
| **Cookie notice**                        | Which small browser files we use and why                                                                                                  | Required in Europe; good practice everywhere                                                                                                                                                          |
| **Data processing agreement**            | A contract saying how we handle a customer's data on their behalf. We also need signed ones from each of our providers.                   | Investment firms will ask for it before signing; GDPR requires it                                                                                                                                     |
| **Nigeria Data Protection Act 2023**     | Nigeria's data law, enforced by the NDPC. Its 2025 implementation directive adds registration and yearly audits for larger data handlers. | We process founders' and investors' personal and financial data. Registration, a data protection officer and an annual compliance audit may apply as we grow; the lawyer should confirm our category. |
| **GDPR (if serving Europe or the UK)**   | Europe's data law                                                                                                                         | Applies as soon as we serve people there. It needs a lawful reason for each use of data and safeguards for transfers to the US.                                                                       |
| **Acceptable use policy**                | What users must not do: upload others' confidential data without permission, harass, scrape, or misuse Q                                  | Lets us suspend bad actors fairly                                                                                                                                                                     |
| **Investor disclaimer**                  | Q's analysis is information, not investment advice; no returns are promised; do your own diligence                                        | Protects us from claims that we advised an investment; supports our "not a regulated adviser" position                                                                                                |
| **KYC and anti-money-laundering policy** | Checking who people are, and watching for suspicious money                                                                                | Needed only if money flows through us or we take success fees. Not needed for subscriptions alone, but we already verify organisations.                                                               |
| **Meeting recording consent**            | Telling everyone in a meeting that Q is present and recording, and getting their agreement                                                | Recording without consent is unlawful in many places; our meeting bot must announce itself                                                                                                            |
| **AI disclosure**                        | A clear statement that Q is an AI, what it can get wrong, and that its face and voice are AI-generated                                    | Fairness to users; increasingly required (for example the EU AI Act's transparency rules)                                                                                                             |
| **Data retention and deletion policy**   | How long we keep each kind of data, and how people can get theirs deleted                                                                 | Required by both data laws; investors will ask                                                                                                                                                        |
| **Security and incident response plan**  | How we protect data, and what we do, and who we tell, if something goes wrong                                                             | Nigeria's law and GDPR require breach notices within 72 hours; investors will ask                                                                                                                     |

## 9. Go-live checklist, in order

| #   | Step                                                                                                                                                                      | Who                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Choose the new name (it must contain Q) and buy the domain                                                                                                                | You                               |
| 2   | Instruct a lawyer: terms, privacy policy, cookies, data agreements, NDPC registration check and the success-fee question                                                  | You                               |
| 3   | Move Railway to the Pro plan; put a card on Supabase with a spending alert                                                                                                | You                               |
| 4   | Create the new production Supabase project (Frankfurt, Small size) and add its access token in the environment's secret settings, never in chat                           | You                               |
| 5   | Top up OpenAI and Anthropic with auto-recharge, buy the Serper and Brave credit, and choose the Tavus, ElevenLabs and Recall plans (section 3 amounts)                    | You                               |
| 6   | Open Stripe and Paystack business accounts (company documents needed; Stripe needs a company abroad, section 5) and set up the Google Workspace for Q's meeting account   | You                               |
| 7   | Set up production: every database change, reference data only (no demo data), the same settings as staging, and a check that everything that works on staging works there | Me                                |
| 8   | Connect the domain, secure certificate and email-sending records                                                                                                          | Me, once you've bought the domain |
| 9   | Finish the open work in section 10, starting with plans and billing (Stripe and Paystack, plan screens, allowances, top-up packs)                                         | Me                                |
| 10  | Make the improvements our scale review lists for the first thousand users                                                                                                 | Me                                |
| 11  | Run the load test on staging (about $60–$125, with your approval)                                                                                                         | Me, with your approval            |
| 12  | Publish the legal documents in the product, with consent at sign-up and the meeting recording notice                                                                      | Me, once the lawyer delivers      |
| 13  | Final check on production with test accounts, then open sign-ups                                                                                                          | Me, then you                      |
| 14  | After launch: weekly cost report against the caps, raising them as revenue arrives                                                                                        | Me                                |

## 10. Honest status

**Works today, live and checked:**

- Sign-up and onboarding (typed, form and voice).
- Discover and investor feeds.
- Q answering questions with sources.
- Founders' own figures, recorded straight away with undo.
- Document upload, with every file virus-scanned (switched on 17 November).
- GateQ applications.
- Pitch rehearsal with Q's face.
- Spending caps and alerts.

**Still being finished:**

- **Meetings with Q.** Booking and the investor's approval of times work up to review, counter-offer and decline. The final "confirmed" step and Q's full behaviour inside a live meeting are deployed but not yet proven end to end. Only one Q face can run at a time across the whole platform until we buy a larger plan. Q's face is being rebuilt so its lips move with Q's voice (decision D5), and Q is being set up to join signed in so it isn't left in the waiting room (items 24 and 25).
- **Admin dashboard.** Not finished. We monitor through logs and alert emails for now.
- **Plans and billing.** Usage is recorded per person, and a Stripe connection is built but not switched on. Paystack isn't connected and there are no plan screens yet. This is the largest piece of work before we can charge.
- **GateQ email.** The in-app intake works. Email intake and investors' own intake addresses still need finishing and live testing.
- **Voice speed.** Follow-up questions on the same subject dropped from about 16 seconds to about 7. A fresh question still takes about 10–15 seconds, and one in twenty takes much longer. Work continues.
- **Production database.** Not yet created. It waits on step 4 of the checklist.
- **Search credit.** Most search providers are empty until topped up (section 2).

## Sources

All pages checked on 18 November 2026 unless stated.

**Our own measurements (production, read-only, 18 November 2026)**

- AI usage records: 30-day spend $78.68 across 248 people; 7-day average $0.0305 per question (447 questions; median $0.0186; 95th percentile $0.0823); realtime voice $30.17; delegated work $4.15.
- Voice conversation records: 109 voice sessions, about 328 minutes, in 30 days.
- Video usage records: settled meeting time 1,012 seconds (17 billed minutes), $5.95.
- Scale review: `docs/ai-handoff/audits/2026-11-18-scale-ceilings.md`.
- Caps and alerts: `docs/ai-handoff/OPS-ALERTS.md`.
- Owner decisions 73, 74, 99–106: `docs/ai-handoff/DECISIONS.md`.
- Meetings design (lobby, sign-in, the face): `docs/specs/meetings/2026-11-18-meetings-design.md`.
- Admin, ledger and billing design (open owner questions in its section 15): `docs/specs/admin/2026-11-18-admin-ledger-billing-design.md`.
- Scale review figures used in section 1: 915 answers in 14 days at $0.022 each on average; 35% of AI input reused from cache; quick sorting steps $15.23 against $8.71 for ordinary conversation over 14 days.

**Provider prices**

- Railway pricing: https://railway.com/pricing
- Railway regions: https://docs.railway.com/reference/regions
- Supabase pricing: https://supabase.com/pricing
- Supabase regions: https://supabase.com/docs/guides/platform/regions
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- Anthropic API pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Tavus pricing: https://www.tavus.io/pricing (the page shows two layouts; I used the current developer plans: Builder $59, Growth $397, Business $975)
- ElevenLabs API pricing: https://elevenlabs.io/pricing/api
- Deepgram pricing: https://deepgram.com/pricing
- Recall pricing: https://www.recall.ai/pricing
- Brave Search API: https://brave.com/search/api/
- Tavily pricing: https://www.tavily.com/pricing
- Serper: https://serper.dev/ (2,500 free searches). Pack prices from secondary sources because Serper publishes no price page: https://apiserpent.com/blog/serper-pricing-credits-explained and https://costbench.com/software/web-scraping/serper/
- Cloudflare Stream pricing: https://developers.cloudflare.com/stream/pricing/
- Cloudflare .com price (secondary): https://www.whtop.com/plans/cloudflare.com/135912
- Brevo (secondary; brevo.com would not load): https://www.sendx.io/blog/brevo-pricing-plans-costs-alternatives-2026
- Sentry pricing: https://sentry.io/pricing/
- Google Workspace Business Starter, $7 a user a month on the yearly plan and $8.40 on the flexible plan (Google's help page; the main pricing page did not show figures to automated reading): https://knowledge.workspace.google.com/admin/billing/ai-features-and-pricing-updates-for-google-workspace-business-editions
- Recall signed-in Google Meet bots (dedicated paid Workspace, non-admin bot users, two accounts to start, bot email on the invite): https://docs.recall.ai/docs/google-meet-login-getting-started

**Payments**

- Paystack transaction fees (official help centre): https://support.paystack.com/hc/en-us/articles/360009881920 and https://support.paystack.com/hc/en-us/articles/360009882020
- Flutterwave Nigeria pricing: https://flutterwave.com/ng/pricing
- Stripe pricing: https://stripe.com/pricing
- Stripe supported countries (African countries listed point to Paystack): https://stripe.com/global
- Stripe Atlas ($500 once, then $100 a year for the registered agent): https://stripe.com/atlas
- Stripe Tax (0.5% per transaction where registered, no-code plan): https://stripe.com/tax/pricing

**Hosting comparison**

- Hetzner Cloud: https://www.hetzner.com/cloud/
- Contabo (secondary; contabo.com blocked automated reading): https://www.vpsbenchmarks.com/hosters/contabo/plans/cloud-vps-20
- DigitalOcean App Platform: https://www.digitalocean.com/pricing/app-platform
- Fly.io pricing: https://fly.io/pricing/
- Google Cloud Run pricing: https://cloud.google.com/run/pricing (rates confirmed through secondary summaries: https://cloudchipr.com/blog/cloud-run-pricing)

**Comparable products**

- Affinity: https://affinity.co/pricing
- Crunchbase and PitchBook (secondary): https://privateequitylist.com/intelligence/crunchbase-pricing and https://vcbeast.com/pitchbook-vs-crunchbase
- Visible (secondary): https://startupik.com/?p=6771 and https://www.roundfunded.com/en/alternatives/visible
- ChatGPT and Perplexity (secondary): https://www.costbench.com/compare/chatgpt-vs-perplexity/

**Fees on capital raised, and licensing**

- Finder and placement fee ranges: https://kalungi.com/blog/how-to-pay-someone-who-helps-you-raise-money and https://pipelineroad.com/agency/blog/finders-fee-raising-capital
- Lehman and double Lehman: https://waveup.com/blog/m-and-a-advisor-fees/ and https://exitpromise.com/lehman-scale/comment-page-1
- US finders and broker registration: https://www.thecorporatecounsel.net/blog/2023/08/everything-you-always-wanted-to-know-about-finders-but-were-afraid-to-ask.html and https://ropesgray.com/en/insights/alerts/2020/10/sec-proposes-exemption-from-broker-registration-for-private-placement-finders
- UK FCA perimeter guidance on arranging: https://www.handbook.fca.org.uk/handbook/PERG/2/7.html and https://www.lw.com/en/insights/2025/09/Arranging-Deals-in-Investments-Revisited
- Nigeria SEC crowdfunding intermediary requirements: https://sec.gov.ng/about/resources/checklists/individual-registration-requirements-for-each-cmo/crowdfunding-intermediary-registration-requirements
- Nigeria Investments and Securities Act 2025 summary: https://www.pwc.com/ng/en/assets/pdf/summary-key-changes-to-the-investments-securities-act-2025.pdf

**Data protection**

- NDPA General Application and Implementation Directive 2025 (NDPC): https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf
- Summary of GAID obligations: https://privacymatters.dlapiper.com/2025/06/nigeria-ndpc-issues-gaid-key-compliance-insights/

**Name checks**

- Capital Q Ventures and Capital Q Management LLC: https://www.cbinsights.com/investor/capital-q-ventures and https://fintrx.com/firms/firm/capital-q-management-llc-305337
- Domain registration status, 18 November 2026: Verisign's public lookup for .com (https://rdap.verisign.com/com/v1/domain/), Identity Digital's for .ai and .io (https://rdap.identitydigital.services/rdap/domain/) and the .co registry's (https://rdap.registry.co/co/domain/). Known-taken addresses were checked first to confirm each lookup works.
- Qvidian (Upland Software): https://uplandsoftware.com/qvidian/resources/blog/how-qvidian-uses-artificial-intelligence-ai/
- Quertain & Co (Belgian company register listing): https://busibee.be/en/0687687141-quertain-and-co.md
- DiligentIQ, now ToltIQ: https://app.dealroom.co/companies/diligentiq and https://morningsun.net/uncategorized/diligentiq-announces-name-change-to-toltiq/
- DiligenceSquared: https://www.ycombinator.com/companies/diligencesquared-inc
- Eviden (Atos group): https://www.techzine.eu/news/infrastructure/138367/eviden-becomes-bull-95-year-old-former-atos-brand-returns/
- Qredence: https://www.crunchbase.com/organization/qredence
- ClarityQ: https://pitchbook.com/profiles/company/754851-07
- LensAI: https://pitchbook.com/profiles/company/1167966-19
