# Capital Q: launch plan, costs and pricing

Prepared 18 November 2026. All amounts are in US dollars unless marked otherwise.

This note covers what we pay for, how to stop running out of credit, how to price the product, how we get paid, where to host it, the name and domain, the legal documents, the go-live checklist and an honest status report.

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

One important point: the owner decided on 6 November (decision 73) that we cut costs only in ways that don't reduce Q's quality: saving repeated work, reusing what the AI has already read, and avoiding duplicate calls. No smaller models and no trimmed instructions. So these unit costs will fall a little over time, not dramatically. On 18 November one such fix cut about 11% from each question.

## 2. What we pay for, and the amounts

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
- **At 1,000 at once,** the platform itself (hosting, database, scanner, email, monitoring) is only about **$1,500 a month**, and search, read-aloud voice, the meeting bot and video hosting add about $1,300. Everything else, roughly 95% of the bill, is AI, live voice and Q's video face, and that grows with how much people use it. The plans in section 4 are built so every paying customer covers their own usage with a margin. At that size, 10,000 people a day usually means around 30,000 different people a month; if 1 in 5 of them paid an average of $60, that would bring in about $360,000 a month (estimate).

### The database: production and staging

On 17 November you decided (decision 104) that the current database becomes **staging** (our test copy) and **production** gets a brand-new project. That means paying for two projects.

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
| Deepgram, Brevo, Sentry, Google, Groq                    | $0 to start (free credit or free plans) |
| **Reserve** for surprises, or a .ai domain               | **$272**                                |
| **Total**                                                | **$1,000**                              |

This covers the first month comfortably at today's traffic. The lawyer's fees are not included.

## 4. Subscription plans

### Rules the plans must respect

These come from the locked product decisions, and the plans below follow them:

- **The diagnosis is free.** A founder's full InvestIQ assessment (strengths, gaps, risks, readiness) is never put behind a paywall. Paid value comes from the deeper Readiness Blueprint, more Q, and human help (product decision log #105 and #106).
- **No paying to rank.** Nobody can pay to appear higher in investors' feeds.
- **Investors never pay for visibility or anonymity.** They are the scarce side. Founders can pay, on mid tiers and up, to see which investors viewed them, but only investors who chose to be visible (decision 74).
- **Human execution is separate.** Specialist help (financial preparation, data room set-up, fundraising support) is quoted on its own, not hidden inside a plan.

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

**My recommendation:** launch with **Paystack** only. It handles naira and international cards, and it supports subscriptions. Stripe owns Paystack. Stripe itself generally needs a company registered in one of its supported countries (for example the US or UK). Nigeria isn't one of them, so I'd add Stripe later, if most customers turn out to be abroad and you set up a foreign company. Flutterwave is a good second option if we need countries Paystack doesn't cover.

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

- **Subscriptions:** charged automatically through Paystack each month or year. Receipts and invoices are sent by email.
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

### Suggestions

I checked whether the .com address appears to be registered (using the public domain registry lookup) and ran a quick web search for companies using the name. A domain showing as free can still be held back by the registry or sold at a premium. None of this replaces a proper trademark search.

| Name          | Why it fits                                                              | .com         | Other addresses                                     | Conflicts found in a quick search                                       |
| ------------- | ------------------------------------------------------------------------ | ------------ | --------------------------------------------------- | ----------------------------------------------------------------------- |
| **Qvidence**  | Q + evidence: "evidence before opinion" is our first principle. Keeps Q. | appears free | .ai appears free                                    | None found                                                              |
| **Evidara**   | Soft, memorable, built on "evidence"                                     | taken        | .ai taken; .io and .co appear free                  | None found                                                              |
| **Qadence**   | Q + cadence, the rhythm of a raise. Keeps Q.                             | taken        | qadencehq.com appears free; .io and .co appear free | A wealth product with a similar name ("inCadense")                      |
| **Fundlens**  | Says what it does: a clear lens on a company                             | taken        | .io and .co appear free                             | None exact; similar "Invest Lens" (founder tool)                        |
| **Thesio**    | From "investment thesis"                                                 | taken        | not checked                                         | A small dating app with the same name                                   |
| **Provena**   | From "provenance": where every fact came from                            | taken        | not checked                                         | Similar "Proven Investments"                                            |
| **Raisewell** | Founder-friendly: raise well                                             | taken        | not checked                                         | None found                                                              |
| **Diligiq**   | Diligence + IQ, echoes InvestIQ                                          | appears free | .ai appears free                                    | Close to DiligentIQ (now ToltIQ), a due-diligence AI for private equity |
| **Kapitaq**   | Capital + Q                                                              | appears free | .ai appears free                                    | Sounds like Qapita, an equity management platform for startups          |
| **Qorum**     | Q + quorum                                                               | taken        | not checked                                         | A funded company called Qorum, and Quoroom, a fundraising platform      |

**My top three: Qvidence, Evidara and Qadence.** Qvidence is the strongest: the .com appears free, it keeps Q, and nothing similar turned up. Q stays the name of the analyst inside the product whichever name you choose.

### Setting up the domain, step by step

1. **Buy the domain** at an at-cost registrar such as Cloudflare. Turn on auto-renew and the lock that stops it being moved without you.
2. **Point it at the site.** I add the address to Railway, which then gives a couple of settings to paste into the domain's DNS (the address book that tells browsers where our site lives). The secure padlock certificate is created automatically.
3. **Set up email sending so it doesn't land in spam.** Add three standard records that prove our emails are really from us: SPF (lists who may send), DKIM (a digital signature) and DMARC (tells inboxes what to do with fakes). Brevo shows the exact values. I'd send from a sub-address such as mail.yourname.com, so the main domain's reputation stays clean.
4. **Set up a mailbox** for people to reply to (for example Google Workspace or Zoho, about $1–$7 a person per month, estimate), and an inbox address for GateQ.
5. **Move users over.** Keep the old address redirecting to the new one for at least a year.

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
| 1   | Choose the new name and buy the domain                                                                                                                                    | You                               |
| 2   | Instruct a lawyer: terms, privacy policy, cookies, data agreements, NDPC registration check and the success-fee question                                                  | You                               |
| 3   | Move Railway to the Pro plan; put a card on Supabase with a spending alert                                                                                                | You                               |
| 4   | Create the new production Supabase project (Frankfurt, Small size) and add its access token in the environment's secret settings, never in chat                           | You                               |
| 5   | Top up OpenAI and Anthropic with auto-recharge, buy the Serper and Brave credit, and choose the Tavus, ElevenLabs and Recall plans (section 3 amounts)                    | You                               |
| 6   | Open a Paystack business account (company documents needed)                                                                                                               | You                               |
| 7   | Set up production: every database change, reference data only (no demo data), the same settings as staging, and a check that everything that works on staging works there | Me                                |
| 8   | Connect the domain, secure certificate and email-sending records                                                                                                          | Me, once you've bought the domain |
| 9   | Finish the open work in section 10, starting with plans and billing (Paystack, plan screens, allowances, top-up packs)                                                    | Me                                |
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

- **Meetings with Q.** Booking and the investor's approval of times work up to review, counter-offer and decline. The final "confirmed" step and Q's full behaviour inside a live meeting are deployed but not yet proven end to end. Only one Q face can run at a time across the whole platform until we buy a larger plan.
- **Admin dashboard.** Not finished. We monitor through logs and alert emails for now.
- **Plans and billing.** Usage is recorded per person, but no payment provider is connected and there are no plan screens yet. This is the largest piece of work before we can charge.
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
- Owner decisions 73, 74, 99–105: `docs/ai-handoff/DECISIONS.md`.

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

**Payments**

- Paystack transaction fees (official help centre): https://support.paystack.com/hc/en-us/articles/360009881920 and https://support.paystack.com/hc/en-us/articles/360009882020
- Flutterwave Nigeria pricing: https://flutterwave.com/ng/pricing
- Stripe pricing: https://stripe.com/pricing

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
- Quoroom: https://techcrunch.com/2024/10/03/quoroom-acquires-investory-to-scale-up-its-capital-raising-platform-for-startups
- Qorum: https://www.cbinsights.com/company/qorum/financials
- DiligentIQ / ToltIQ: https://app.dealroom.co/companies/diligentiq
- Domain registration status: public registry lookups (rdap.verisign.com for .com, rdap.org for others), 18 November 2026.
