# Investor Q&A: product questions after Q's story

**For the owner.** These are the questions investors are likely to ask about the product once Q has told Capital Q's story (`Q_STORY_VERBATIM.txt`), with the answer Q gives to each one. Q answers them instantly from a prepared bank, with no AI call, by meaning rather than exact wording. Every question carries at least two other phrasings in the code.

- **Source of truth:** `packages/q-pitch/src/qa-bank.ts`, `qa-bank-product.ts` and `qa-bank-founder.ts`. This document was generated from them on 2026-10-21 and regenerated with the retrieval round. If they disagree, the code wins: regenerate this document rather than editing it by hand.
- **Rules every answer follows (enforced by tests):**
  - plain, spoken words, with no engineering terms;
  - honest about stage: pre-seed and bootstrapping;
  - no invented traction, customers, revenue, investors or team size;
  - live versus not yet certified, as recorded in `CERTIFICATION_MANIFEST.md` and `PROMISE-COVERAGE.md`;
  - at least one source per answer, and each source file exists.
- **How the questions were chosen:** from research into what investors ask AI deal-flow, investment-intelligence and two-sided founder/investor platforms (Harmonic, Affinity, PitchBook, Dealroom, AngelList, Carta, DocSend and similar), on the product angle only.

## Questions Q cannot answer honestly from the sources

**Owner: please supply these facts.** Until you do, Q gives a holding answer ("the founders can speak to that") and makes no claim.

1. **Certification and testing.** Is there a SOC 2 or ISO certification, a penetration test or a security audit, or a date for one? (`qa.certification`)
2. **Regulation.** Is Capital Q or FDN licensed or regulated in any market, and has counsel reviewed the broker-dealer or investment-advice position? (`qa.advice`)
3. **Success fees.** Does Capital Q or FDN take any fee or share when a round closes? Is there a transaction-based charge? (`qa.success-fee`)
4. **Pricing.** Price levels and who pays: investors, founders or both, per seat or another basis. The sources fix only "diagnosis free, deeper layer paid, no pay-to-rank". (`qa.business-model`, `qa.free`)
5. **Launch markets** and the order of geographies. (`qa.geography`)
6. **Go-to-market and how both sides will grow**, beyond the FDN waitlist and demos. (`qa.go-to-market`, `qa.cold-start`)
7. **Roadmap dates and order.** (`qa.roadmap`)
8. **Integrations.** Two-way sync with Affinity, Salesforce, HubSpot or DealCloud; importing an existing pipeline; Slack or Teams; any outside access for a fund's data team. (`qa.integrations`)
9. **Mobile.** Whether there is, or will be, a native mobile app. Q says only that Capital Q runs in the web browser. (`qa.mobile`)
10. **Languages** beyond the certified English, French and Spanish start requests. (`qa.languages`)
11. **Validation of the scores** against real fundraising outcomes, and any audit for bias by founder gender, ethnicity or geography. (`qa.validation`, `qa.bias`)
12. **Measured time saved** and time to the first useful result for a real user. (`qa.time-saved`)
13. **Real usage today:** whether any real investors or founders use the product. Q currently says only "pre-seed, no traction claimed". (`qa.stage`)
14. **FDN's relationship to deal flow:** whether FDN invests in, or gets a first look at, companies on the platform, and how conflicts are handled. No bank entry yet, because there is no source.
15. **Team.** Who the team is. (`qa.team`)
16. **Data-protection commitments** by country, for example GDPR or Nigeria's data protection rules. Q states only what the hosting decision records: data is kept in the EU, with services in the Netherlands. (`qa.data-location`)
17. **Valuation and funding history, market size, unit economics and margins.** These were the knowledge pack's UNKNOWN entries; Q says it doesn't know and won't estimate. (`qa.valuation`, `qa.market-size`, `qa.unit-economics`)

## Notes on scope

- **Q Card:** the PADL locks it as a concept with its name still to be decided (#121). Q presents it as the direction, not a finished feature.
- **Voice:** the spoken presentation, live video rehearsals and the full live-meeting journey are **not certified** (manifest, "Short of the v6 definition of done"). Q says so whenever voice, rehearsals or meetings come up.
- **Wording changes to earlier entries:** the original answers used "canonical", "provenance", "deterministic", "visibility scope" and "server/database". They were reworded in plain English and kept the same meaning.

## How Q decides to answer from the bank

The bank is matched on the device, with no AI call: under a millisecond on average and a few milliseconds at worst.

1. **Clean the spoken question.** Fillers ("um", "you know", "quick question") are dropped, and speech-to-text forms are repaired ("gate queue" becomes GateQ, "capital cue" becomes Capital Q). A misheard word is read as the bank's nearest word when it is one letter off, keeping its first letter.
2. **Not for the bank.** Instructions aimed at Q's rules ("ignore your rules", "pretend"), screen commands ("go back", "open"), and questions about one company or founder on screen go to normal Q.
3. **Exact wording.** A question that matches a stored wording, after clean-up and synonyms, gets that entry's answer. Each entry has 16 stored wordings, most of them spoken style.
4. **Meaning.** Otherwise Q compares the question with every stored wording. Rare words weigh more, and words the bank has never seen count against a match. Q then decides:
   - **Answer at once** when the best entry is close enough and clearly ahead of the runner-up, with at least two meaningful words in common.
   - **"Do you mean …?"** when the best entry is close but not certain. Q names one entry, or the two closest. A yes gives the prepared answer.
   - **Normal Q** for anything else.

**Measured** (tests in `packages/q-pitch/test/qa-spoken.test.ts`):

| Set                                               | Answered | Correct when answered | Offered as "Do you mean …?" | Unrelated questions answered |
| ------------------------------------------------- | -------- | --------------------- | --------------------------- | ---------------------------- |
| Tuning set: 300 spoken questions, 100 unrelated   | 109      | 106 (97%)             | 59 more                     | 0 of 200 checks              |
| Blind set: 200 written after tuning, 60 unrelated | 62       | 58 (94%)              | 23 more                     | 0 of 120 checks              |

**Tier 2: meaning (switched on 2026-10-22).**

- **When it runs:** for a question tier 1 isn't sure of.
- **What it does:** the Q API embeds the question with the same embedding service retrieval uses (OpenAI `text-embedding-3-small`), then compares it with precomputed vectors for every stored wording, kept at 512 dimensions. A live call took about 200 ms, or 770 ms when it also had to open the connection. Tier 2 waits at most 1.2 s, then tier 1's decision stands.
- **One-off cost:** the vectors came from a single approved run of `scripts/q-pitch/embed-qa-bank.mjs --live`: 2,348 strings, about 23,000 tokens, about $0.0005.
- **Thresholds**, calibrated on the tuning set so that no unrelated question gets an answer at 95% precision or better:
  - answer at a similarity of 0.765 or more;
  - "Do you mean …?" from 0.695.
- **Staying current:** if the bank's wordings change, a test fails until the run is repeated.

**Measured with both tiers**, the real vectors, and the same sets as above:

| Set                                           | Answered | Correct when answered | Also offered as "Do you mean …?" | Unrelated questions answered             |
| --------------------------------------------- | -------- | --------------------- | -------------------------------- | ---------------------------------------- |
| Tuning: 300 spoken questions, 100 unrelated   | 186      | 179 (96%)             | 49                               | 0 of 200 checks (20 asked "Do you mean") |
| Blind: 200 written after tuning, 60 unrelated | 90       | 86 (96%)              | 38                               | 0 of 120 checks (8 asked "Do you mean")  |

**What this means.**

- On wording it has never seen, the bank now answers 43% of questions outright (word matching alone: 31%), with 96% of those answers correct.
- It asks "Do you mean …?" with the right entry for about another 19%. The rest go to normal Q.
- It answers no unrelated question in either set.

## What Capital Q is and who it's for (10)

**Q: What is Capital Q?**
A: Capital Q is an AI-native investment intelligence operating system for private capital. It helps investors find, understand and act on the companies that fit their mandate, and helps founders become investable and reach the investors most likely to back them. It is not a marketplace, a directory or a CRM: its product is trusted investment intelligence.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #001; docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt 3.1. Bank id `qa.what-is-it`._

**Q: What is Q?**
A: I'm Q, the investment analyst inside Capital Q. I learn each investor's mandate and each business's story, assess companies on their evidence, match the two, answer questions and do the work you approve. I'm an analyst, not the source of truth, and the decisions stay with you.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #9; packages/q-pitch/src/investor-v6.ts opening. Bank id `qa.what-is-q`._

**Q: What problem are you solving?**
A: Private capital runs on information asymmetry. Every business presents itself differently, so investors start from scratch each time and spend too long searching and screening, while good companies are missed. Founders, for their part, cannot see what stops them from raising or which investors genuinely fit them. Capital Q standardises the picture and reduces that asymmetry.
_Sources: docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt 3.1; docs/ai-handoff/LANDING-PROMISES.md LP-05 to LP-07. Bank id `qa.problem`._

**Q: Who is Capital Q built for?**
A: Both sides of private capital. On one side, investors of every kind, from angels investing their own money to funds answering to their own backers. On the other, businesses raising capital: a first raise, a later round, a difficult round, or an established company looking for growth capital. Q learns each investor's thesis and each business's story, and connects the two.
_Sources: docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt opening; docs/ai-handoff/LANDING-PROMISES.md LP-14, LP-15; docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt 3.1. Bank id `qa.who-for`._

**Q: Is it only for startups?**
A: No. A first raise, a Series B, a down round, or an established business financing expansion or an acquisition: different stage, same problem, finding the right capital from the right investor at the right time. The assessment adjusts what it expects by stage, so a young company is never judged against a later one.
_Sources: docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt the other side of the table; docs/ai-handoff/INVESTIQ-METHODOLOGY.md Stage handling. Bank id `qa.business-types`._

**Q: What do you mean by TikTok plus Jarvis?**
A: TikTok for discovery: short pitches, one company at a time, chosen for your mandate, which you swipe through and save or pass. Jarvis for everything after: an analyst you can simply ask, who compares companies, challenges assumptions, prepares your meetings and does the work you approve. One is how you find; the other is how you decide.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-02, LP-09, LP-11; docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt CapitalQ. Bank id `qa.tiktok-jarvis`._

**Q: How does it work?**
A: Q learns each investor's thesis and onboards each business through a conversation, from the materials it already has. It turns every company into the same standard structure, assesses it on its evidence, and matches it against each investor's declared mandate. Investors discover and interrogate companies with Q; founders see what to improve and which investors fit. Investors can also set a gateway, so applicants arrive already qualified.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-14 to LP-20; docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt overview. Bank id `qa.how-it-works`._

**Q: What is a Q Card?**
A: The Q Card is a company's shareable identity: its story, numbers, raise and intelligence in one living record, shared by a link or a code, so someone outside Capital Q can open it without an account first. It is a locked product concept whose final name is still to be decided, so treat it as the direction rather than a finished feature.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #121; docs/ai-handoff/PROMISE-COVERAGE.md naming conflict. Bank id `qa.q-card`._

**Q: Which markets and regions do you cover?**
A: Capital Q is offered by FDN Capital Partners, which works from Lagos and Dubai. Inside the product, geography is part of every investor's mandate, so matching respects where you invest. Which markets the company will launch in first is a question for the founders; I won't guess at it.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-46 footer; docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt I learn how you invest. Bank id `qa.geography`._

**Q: Why now?**
A: Two things changed. AI can now read a deck, a pitch and a data room and reason over them like an analyst, at a cost that makes it available to every investor and founder, not only the largest firms. And deal flow keeps growing while investors' time does not, so the bottleneck has moved from finding opportunities to understanding them quickly and fairly.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-01, LP-05 to LP-07; docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt 3.1. Bank id `qa.why-now`._

## How it works for investors (24)

**Q: What does Capital Q do for me as an investor?**
A: It brings you the companies that fit your mandate, already in one comparable structure, and lets you interrogate each one with Q before you spend time on a call. You can set a gateway so applicants arrive qualified, keep every relationship's history in one place, and let Q act for you within the approval rules you set.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-03, LP-17 to LP-20. Bank id `qa.investor.value`._

**Q: How does onboarding work?**
A: From the start, Q interviews you to onboard you. It learns as much as it can about you and your company, or about your mandate as an investor, from a conversation and from what you already have, such as a deck. There is no long questionnaire: you can skip anything, unknown stays unknown, and Q asks you to confirm what it extracted before it becomes part of your record.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-15; CLAUDE.md Onboarding. Bank id `qa.onboarding`._

**Q: What do you capture about my investment thesis?**
A: Your thesis, stage, sectors, geography, cheque size, preferences and minimum criteria. I learn them in a conversation, not a long questionnaire, and then shape what you discover around them. What you declare stays yours: what you happen to view never quietly rewrites it.
_Sources: docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt I learn how you invest; docs/ai-handoff/LANDING-PROMISES.md LP-15, LP-32. Bank id `qa.mandate`._

**Q: How does the Discover feed work?**
A: Discover shows pitches one company at a time, chosen for your mandate, with why each one is there and the key facts beside it, in the same structure for every company. You save or pass with a swipe, or search for exactly what you want. Saving is instant; expressing interest is a deliberate step, because viewing is never interest. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts Discover step; docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Investor track. Bank id `qa.discover`._

**Q: Does my feed change based on what I swipe?**
A: It can bring forward companies like the ones you saved, and it says so on the card. But what you browse never rewrites the mandate you declared, nothing excludes a company except a rule you set, and the feed is never tuned for watch time or clicks. A view is not interest; only you decide that.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-32; packages/q-pitch/src/investor-v6.ts Explore step. Bank id `qa.behaviour`._

**Q: How do you decide what investors see first?**
A: The feed follows fixed, explainable rules: eligibility from your declared rules first, then fit against your mandate, evidence and freshness, then a little diversity. No model decides the order, nothing is optimised for watch time, and no company can pay to rank. Every card can tell you why it is there.
_Sources: docs/architecture/19_Capital_Q_Discovery_Matching_Recommendation_Architecture.md ranking order; CLAUDE.md Recommendations. Bank id `qa.ranking-fairness`._

**Q: What do I see on a company's profile?**
A: The same sections for every company: an overview built from the founder's own material, diligence with the key claims and what isn't known yet, risks in words, the elevator video, the documents the founder has shared with you, my reading of their deck, and the team. Every claim is labelled as the founder's until evidence says otherwise. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts profile steps; docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Investor track. Bank id `qa.profile`._

**Q: Can I compare companies side by side?**
A: Yes. Because every company sits in the same structure, you can compare like with like, either side by side on screen or by asking me to compare them, and I'll say where one is stronger, where the evidence is thin, and what is unknown for each.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-24; docs/specs/q-pitch/CERTIFICATION_MANIFEST.md INV-COMPARE-TABLE. Bank id `qa.compare`._

**Q: Can I ask Q about a company before I talk to the founder?**
A: Yes. You can ask me about any company you may see, and I answer from what the founder told me in their onboarding interview and from what they've shared, saying plainly when something isn't known. The founder isn't contacted until you choose to express interest.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #123; docs/ai-handoff/LANDING-PROMISES.md LP-19, LP-42. Bank id `qa.ask-before-meeting`._

**Q: Does Q do due diligence for me?**
A: No, and it never claims to. I organise the evidence, find what's missing, highlight what deserves attention and suggest the questions worth asking, so your diligence starts further along. The judgement, and the responsibility, stay with you and your advisers.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #75; packages/q-pitch/src/investor-v6.ts Diligence step. Bank id `qa.due-diligence`._

**Q: How do I get a company's documents?**
A: You see only what the founder has shared with you, organised in folders. What isn't open yet you can request, and the founder decides. Access can be withdrawn later, and everything I tell you respects the same permissions. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts data room step; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #124. Bank id `qa.documents`._

**Q: What is the difference between interest and a match?**
A: Interest is one-sided: you express it from a company's profile, deliberately. A match is two-sided: it happens when the founder accepts, and then the relationship appears in both your records. Viewing alone never tells the founder anything.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #117; packages/q-pitch/src/investor-v6.ts Explore step. Bank id `qa.interest-match`._

**Q: Will a founder know I looked at their company?**
A: Looking is not an invitation. Investors control how they appear when they browse, and a founder hears from you only when you deliberately express interest, ask to connect, request documents or a meeting. Founders get relationship signals that matter, not surveillance.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #129; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #128. Bank id `qa.viewing-privacy`._

**Q: What happens when I pass on a company?**
A: Passing is one swipe, with no reason required each time. Now and then I may ask, briefly, for feedback such as stage or sector, so the feed gets better without interrupting you. A pass is neutral, not a judgement on the company.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #122; CLAUDE.md Design: Pass is neutral. Bank id `qa.pass`._

**Q: Does this replace my CRM?**
A: For the relationships made here, yes: each one has a single record that both sides share, where it stands, everything that happened in order with who can see each entry, your private notes, chat, calls and commitments, plus a pipeline by stage. It is built on the evidence of what actually happened, not on someone updating a field. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts relationship and CRM steps; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #63. Bank id `qa.crm`._

**Q: Does Q join my meetings?**
A: You can have me join a call booked on Capital Q, with that stated at booking. I take notes for both sides and answer when asked; afterwards I ask you to confirm any commitment before it's recorded. Booking and having me join are in the product today; the full live-meeting journey is still being verified end to end.
_Sources: packages/q-pitch/src/investor-v6.ts Calls and meetings step; docs/ai-handoff/PROMISE-COVERAGE.md LP-20. Bank id `qa.meetings`._

**Q: Can Q act on my behalf?**
A: Yes, within the approval rules you set. I can watch your mandate, express interest, reply, book meetings and prepare documents. Anything consequential waits for you exactly as I prepared it, and if it changes it needs your approval again. You see what needs you and what I've done this week. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts Q Work step; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #120. Bank id `qa.q-acts`._

**Q: Is Q one AI or many?**
A: You talk to one Q. Behind me there is a team: a planner sets the steps, specialists research and draft, and a reviewer checks the work before it reaches you. You never have to choose between them, and each job's plan can be shown step by step. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts Q's team step; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #137. Bank id `qa.one-q`._

**Q: What is the Q Daily?**
A: A newspaper written for you: stories chosen for your mandate or your raise, with my take on what matters and every source named. It comes on the schedule you choose, and you can switch it off. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts Q Daily step; packages/q-pitch/src/founder-v6.ts Q Daily step. Bank id `qa.q-daily`._

**Q: Can I talk to Q by voice?**
A: Speaking to me and hearing answers is part of the product. Be aware that this presentation runs with captions, and the spoken version of it hasn't been certified yet, so I'm only claiming what you've seen working.
_Sources: docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Short of the v6 definition of done; docs/ai-handoff/LANDING-PROMISES.md LP-11. Bank id `qa.voice`._

**Q: What languages does Q speak?**
A: In this demonstration I've been verified starting the presentation from requests in English, French and Spanish; the narration itself is in English. Beyond that, I won't promise a list of languages.
_Sources: docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Natural-language trigger. Bank id `qa.languages`._

**Q: Can my partners and team use it together?**
A: Yes. A firm or a company is a team on Capital Q: you invite colleagues as owners, admins or members, and private notes are seen only by your own firm. When someone leaves, the firm's information stays with the firm.
_Sources: docs/adr/0057-organisations-as-teams.md; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #145. Bank id `qa.team-collab`._

**Q: Does Q remember our previous conversations?**
A: Yes. I keep memory about you, your companies and your relationships over time, with where each thing came from, so you don't start from scratch each time. That memory is still bound by permissions: remembering something never means I may show it to someone else.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #138; docs/adr/0012-memory-and-conversations.md. Bank id `qa.memory`._

**Q: Does it integrate with my existing tools?**
A: Calls are booked on your calendar through Google Calendar and Meet, and with your approval I can send a message from your own Gmail. Two-way syncing with other relationship tools, or importing an existing pipeline, is not something I can confirm today, so I won't promise it; the founders can tell you what is planned.
_Sources: docs/specs/2026-10/auto.md booking; docs/adr/0043-standing-instructions.md email. Bank id `qa.integrations`._

## GateQ and inbound (4)

**Q: What is GateQ?**
A: GateQ is the investor's front door. The investor sets the criteria a business must meet; a founder who matches applies through it, and Q interviews them first. The investor receives every application in the same structure: the founder's own words, Q's reading, and a dossier, so the first meeting starts with alignment, not discovery. The decision always stays with the investor.
_Sources: docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt overview; docs/ai-handoff/LANDING-PROMISES.md LP-18, LP-19. Bank id `qa.gateq`._

**Q: How do I put GateQ on my website?**
A: GateQ gives you a front door you can link from anywhere businesses already come to you: your website, an application page, social media, an accelerator or an investment programme. Every application lands in one place, in one structure, already interviewed by me and matched against your criteria.
_Sources: docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt And for inbound; docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt overview. Bank id `qa.gateq-setup`._

**Q: Can it handle hundreds of inbound applications?**
A: That is exactly what it's for. I interview each applicant, check them against your criteria, and order them by how well they suit you and how investable they are, so the most relevant rise to the top and you don't dig through the whole haystack. The decision on each one stays with your team.
_Sources: docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt GateQ; docs/ai-handoff/LANDING-PROMISES.md LP-40, LP-43. Bank id `qa.gateq-volume`._

**Q: Can founders who don't meet my criteria still reach me?**
A: You control your inbound. You set the criteria, and a minimum score if you want one, and that is checked on our side, not just hidden on screen. Capital Q is deliberately not an open messaging network: outreach is structured through your gate, so you get qualified approaches rather than volume.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-43; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #152. Bank id `qa.unqualified-contact`._

## Founders, as an investor sees them (9)

**Q: What does Capital Q do for me as a founder?**
A: Q works first: upload what you already have and it builds your company record, tells you what may stop you from raising and what to improve next, and shows you the investors whose mandates you actually match. You can apply through their gateways, rehearse with an investor persona, and keep every conversation in one place.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-15, LP-16; docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt founder onboarding. Bank id `qa.founder.value`._

**Q: How much work is it for a founder to get on?**
A: Very little to start. A founder uploads what they already have, I work first and return useful intelligence, then we fill the gaps together in conversation. They can skip anything, and nothing I extract becomes part of their record until they confirm it.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #56; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #103. Bank id `qa.founder-effort`._

**Q: Why would the best founders join?**
A: Because the value comes before the raise: a free, full diagnosis of what investors will see, what could block them, and which investors genuinely fit, plus rehearsal against those investors. A strong founder saves months by talking only to investors whose bar they meet. Whether that draws the best founders is the bet Capital Q has to prove, and I won't claim it already has.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #106; docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt For businesses. Bank id `qa.adverse-selection`._

**Q: How do you solve the chicken and egg problem?**
A: Each side gets value alone. An investor can point their existing inbound through GateQ and have it interviewed and ranked on day one. A founder gets a diagnosis and an improvement plan before any investor is involved. The network makes both better, but neither has to wait for it. How quickly both sides grow is for the founders to speak to.
_Sources: docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt overview; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #106. Bank id `qa.cold-start`._

**Q: Can founders game their score?**
A: Founders don't see interim scores while the assessment is underway, so they can't tune their answers to it. They can't edit the assessment either; they can only add evidence. And a claim counts for less than evidence: something the founder says moves the picture less than something a document or verification supports.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #104; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #107. Bank id `qa.founder-score-gaming`._

**Q: What if a founder disagrees with their assessment?**
A: They can challenge it, not edit it. I first explain the conclusion and the evidence behind it; they can then add new or corrected evidence, and I reassess. If nothing changes, I explain why. Where it's warranted, they can ask for a human review by FDN.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #50; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #107. Bank id `qa.appeal`._

**Q: Are the companies and investors verified?**
A: Verification grows with what someone tries to do. Anyone can explore and get value first, but a company is not shown to investors, and cannot request meetings, until it has been verified. Contact between the two sides runs through gates and permissions, with reporting and human review behind it, rather than open messaging.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #57; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #147. Bank id `qa.verification`._

**Q: Are the pitch videos made with AI?**
A: The elevator pitch is the founder's own video. Where a founder uses an AI presenter, it is always labelled as one, so you always know what you're watching. This is in the product today.
_Sources: packages/q-pitch/src/investor-v6.ts elevator step; docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Investor track. Bank id `qa.ai-presenter`._

**Q: What stops people taking the relationship off the platform?**
A: Nothing forces them to stay, and Capital Q doesn't try to trap anyone. The reason to stay is that the relationship record, the documents, the meetings with my notes and the commitments live in one place both sides trust, and I keep the next step moving.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #26; packages/q-pitch/src/investor-v6.ts relationship steps. Bank id `qa.off-platform`._

## Scores and the AI (15)

**Q: How are the scores calculated?**
A: There are two scores, never blended. Investability asks how investable a company is on its evidence; it is the InvestIQ method over investor-eligible evidence, the same for every investor, with its coverage and confidence shown. Suitability asks how well it fits this investor's mandate, and differs per investor. When too little is known, there is no number at all: unknown stays unknown and is never read as poor.
_Sources: docs/ai-handoff/INVESTIQ-METHODOLOGY.md Two scores, never one; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt InvestIQ. Bank id `qa.scores`._

**Q: What does the assessment look at?**
A: Eight areas from FDN's framework: the team, the business fundamentals, commercial strength, financial readiness, governance, legal and corporate, the investment case, and how ready the company is for diligence. How much each area counts depends on the company's stage. Fit with your mandate is measured separately, as Suitability.
_Sources: docs/ai-handoff/INVESTIQ-METHODOLOGY.md Dimensions and stage weights; docs/ai-handoff/LANDING-PROMISES.md LP-25. Bank id `qa.score-areas`._

**Q: Do you judge a pre-seed company like a Series B?**
A: No. At the earliest stages the team and the fundamentals count most; commercial results, finances, governance and diligence count more as a company matures. A pre-seed company is never read as weak for having no revenue yet, and if the stage isn't stated there's no number rather than a guess.
_Sources: docs/ai-handoff/INVESTIQ-METHODOLOGY.md Stage handling; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #64. Bank id `qa.stage-fairness`._

**Q: Can I see why a company got its score?**
A: Yes. Each score shows what raised it, what lowered or held it back, and what would make it more complete, each with its source and how well it's supported. Behind that sits the full record of how it was worked out, kept with every revision.
_Sources: docs/ai-handoff/INVESTIQ-METHODOLOGY.md Explainability; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #69. Bank id `qa.why-this-score`._

**Q: Isn't it all just what founders claim?**
A: Much of it starts as the founder's claim, and it is labelled that way. Every fact carries how well it's supported, from the founder's own word, through documents and several sources, to verification. Claims count for less than evidence, and today most scores show low confidence for exactly that reason. I'd rather tell you that than dress a claim up as fact.
_Sources: docs/ai-handoff/INVESTIQ-METHODOLOGY.md Content grading; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #105. Bank id `qa.self-reported`._

**Q: What happens when the numbers don't match?**
A: Both stay visible, side by side, until they're reconciled. I never quietly pick the more flattering number. A contradiction triggers a question rather than a penalty: that part is held back as unresolved, and confidence drops until it's settled.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #67; docs/ai-handoff/INVESTIQ-METHODOLOGY.md Anchors and evidence. Bank id `qa.contradictions`._

**Q: Is the scoring biased?**
A: The scores follow written rules, the same for every company at the same stage, and no AI model sets the number. They read what the evidence says about the business and the team's experience, never browsing behaviour, and every factor is shown. Missing information lowers confidence, never the score, which matters for founders with less public coverage. A formal audit of outcomes hasn't been published, and I won't claim one.
_Sources: docs/ai-handoff/INVESTIQ-METHODOLOGY.md Investor-eligible inputs; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #68. Bank id `qa.bias`._

**Q: How accurate is the AI? Can it hallucinate?**
A: Q is held to evidence before opinion. Every finding is labelled with what it rests on: a founder's own claim, a document, or verification, and Q's inferences are marked as Q's view, never as fact. When evidence is missing Q says so instead of guessing, and contradictions are shown side by side rather than resolved quietly. Q is an analyst, not the source of truth.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #006; docs/architecture/12_Q_Technical_Architecture.md evidence. Bank id `qa.ai-accuracy`._

**Q: Does the AI decide who gets funded?**
A: No. I present evidence, trade-offs and recommendations; you decide. A low assessment never stops a legitimate company from raising, and you're free to look at companies I didn't recommend. My firm authority is over permissions, privacy and integrity, not over your commercial judgement.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #90; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #154. Bank id `qa.ai-decides`._

**Q: Can Q predict which startups will succeed?**
A: No, deliberately. Capital Q analyses the evidence that exists today; it doesn't forecast outcomes. There is a separate, provisional Unicorn Potential indicator, but it measures present evidence against a set of criteria and is explicitly not a probability or a forecast.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #46; docs/adr/0076-unicorn-potential-provisional-indicator.md. Bank id `qa.prediction`._

**Q: Have the scores been validated against real outcomes?**
A: Not yet, and I won't pretend otherwise. The method rests on published research on what investors weigh at each stage, and its weights are product choices, not proven from outcomes. Changes to it are versioned and reviewed, never drift on their own. Validating it against real outcomes needs the outcomes first.
_Sources: docs/ai-handoff/INVESTIQ-METHODOLOGY.md Dimensions and stage weights; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #76. Bank id `qa.validation`._

**Q: Does Q get smarter over time?**
A: In two ways. I build memory for each person and firm, so the work compounds. Over time Capital Q is designed to learn from real outcomes, such as which improvements and introductions actually lead to raises, using protected patterns, never one party's private information. The scoring method itself changes only through reviewed, versioned updates.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #87; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #150. Bank id `qa.learning`._

**Q: Does Q use information from outside the platform?**
A: Mostly it uses what founders and investors bring, labelled by where it came from. When asked, I can do controlled public research, and the Q Daily reads the news with every source named. Something found on the web is never treated as truth about a company on its own; it's a lead, labelled as such.
_Sources: docs/adr/0009-controlled-public-web-research.md; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #146. Bank id `qa.outside-sources`._

**Q: What are Q's limits?**
A: I don't make investment decisions, give legal, tax or investment advice, certify due diligence, or predict winners. I won't send anything consequential without your approval, and no instruction can make me show you something you're not permitted to see. When I don't know, I say so.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #90; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #75. Bank id `qa.q-limits`._

**Q: Is this investment advice? Are you regulated?**
A: Capital Q is built never to give investment, legal, tax or accounting advice: I inform, and the decisions and terms are between you and the founder. Questions of licensing and regulation in particular markets are for the founders and their counsel; I won't state a position I don't have a source for.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #75; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #154. Bank id `qa.advice`._

## Trust, data and security (8)

**Q: Is my data private? Who can see what?**
A: Every piece of information carries a setting for who may see it, and that is enforced on our side at every layer, not just hidden on screen. Founder-private material never reaches an investor, and never quietly changes how an investor ranks or sees a company. What Q knows is not the same as what you may see: Q filters by permission before it reasons, and a data room opens only when the founder shares it.
_Sources: docs/architecture/15_Capital_Q_Security_Architecture.md context firewall; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Q knowledge vs data room. Bank id `qa.privacy`._

**Q: Where is my data stored?**
A: Capital Q is built to keep data in the European Union: keeping it there is a requirement of the architecture, and the services run in the Netherlands. Formal data-protection commitments for particular countries are for the founders to confirm.
_Sources: docs/adr/0014-railway-replaces-render-for-node-services.md region. Bank id `qa.data-location`._

**Q: Who owns the data?**
A: Users own what they bring: profiles, documents, financials, videos and evidence. Capital Q owns the intelligence it produces, such as assessments and briefs, which is why nobody can simply edit them. People keep control of their own information and can take it with them.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #49; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #151. Bank id `qa.data-ownership`._

**Q: Can I delete my data?**
A: Yes, with care for context. You can withdraw sharing and archive what you've added. Closing your whole account isn't something you can do yourself in the product yet. Your personal private information can be forgotten, but you can't erase another party's legitimate record of a relationship, and withdrawing access can't recall a copy someone already downloaded.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #151. Bank id `qa.deletion`._

**Q: Is my data used to train AI models?**
A: Private Capital Q information does not automatically become training material for outside AI models. Using information to serve you, learning privately for your firm, learning protected patterns across the network, and training outside models are treated as four separate things, and the AI services we use must keep to the same commitments.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #150. Bank id `qa.training`._

**Q: How do you keep data safe?**
A: Information is encrypted in transit and at rest. Every request is checked against permissions on our side, not just hidden on screen, so one firm can never see another's notes or pipeline. Sensitive actions are logged with who did what, and Capital Q staff access works through named roles that are themselves recorded.
_Sources: docs/architecture/15_Capital_Q_Security_Architecture.md encryption; docs/adr/0033-platform-operator-roles-step-up-break-glass.md. Bank id `qa.security`._

**Q: Do you have SOC 2 or a security certification?**
A: I have no certification or audit report to tell you about, so I won't claim one. The founders can tell you where that stands and what is planned.
_Sources: docs/architecture/15_Capital_Q_Security_Architecture.md scope. Bank id `qa.certification`._

**Q: Could a document trick Q into saying something false?**
A: Anything I read, whether a document, a web page or a message, is treated as material to analyse, never as instructions to follow. It can't change my rules, my permissions or what I'm allowed to show you, and what it claims stays labelled as a claim.
_Sources: docs/adr/0008-document-processing-and-parser-isolation.md; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #154. Bank id `qa.manipulation`._

## Against the alternatives (product only) (6)

**Q: Who are your competitors?**
A: Capital Q is deliberately not a CRM, a marketplace, a directory or a document store, and those are where the incumbents are. Generic AI assistants can summarise, but they hold no single trusted record with permissions, and no label for how well each fact is supported. Capital Q's category is investment intelligence: one trusted, comparable view of each opportunity, built for both sides.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #001; docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt 3.1. Bank id `qa.competition`._

**Q: How are you different from PitchBook or Dealroom?**
A: Those are about coverage: what can be found about many companies from the outside. Capital Q works from the inside: the founder's own material, interviewed and labelled by how well it's supported, assessed the same way for every company, and matched to your declared mandate. And it carries on past discovery, into the relationship, meetings and commitments.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #001; docs/ai-handoff/LANDING-PROMISES.md LP-10, LP-19. Bank id `qa.vs-databases`._

**Q: How are you different from Affinity?**
A: A relationship tool tracks your activity around companies. Capital Q starts earlier, with discovery and an evidence-based view of each company, and its relationship record is shared by both sides and built from what actually happened, with each entry marked with who can see it. Your private notes stay private to your firm.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #63; packages/q-pitch/src/investor-v6.ts relationship step. Bank id `qa.vs-relationship-tools`._

**Q: How are you different from AngelList or Carta?**
A: Capital Q isn't where money is pooled or ownership is recorded. It's where investors and businesses find, understand and qualify each other before that, and where the relationship is run. Commitments are recorded once both sides confirm them, but the terms and the transaction stay between the parties.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #001; packages/q-pitch/src/investor-v6.ts Capital step. Bank id `qa.vs-angellist`._

**Q: Why not just use ChatGPT?**
A: A general assistant can summarise a deck you hand it. It doesn't hold one trusted record per company that both sides rely on, label every fact by how well it's supported, keep each party's private information separate, apply one assessment method to every company, or act within your approvals on a live relationship. Those are what Capital Q is built around.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #85; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #144. Bank id `qa.vs-chatgpt`._

**Q: What is your moat?**
A: The defensibility is in the trusted structure, not the model: one trusted record per company and investor, evidence and its origin on every fact, a proprietary assessment framework, and relationship history that compounds with use. Generic AI tools can summarise a deck; they cannot hold a permissioned, comparable, evidence-labelled record that both sides trust.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #85; docs/ai-handoff/LANDING-PROMISES.md LP-25. Bank id `qa.moat`._

## Live, roadmap, business and the company (16)

**Q: What is live today and what is still planned?**
A: Each part of the product is marked in our certification record as live or not yet, and I describe it only that way. Recorded as live and verified on the product: matching, Discover, company profiles, diligence, documents, the CRM and pipeline, GateQ, my work for you and the Q Daily. Not yet certified: the spoken presentation, live video rehearsals and the full live-meeting journey. Illustrative moments in a story are illustrations, not product claims, and a rehearsal shown in a tour is a prepared exchange.
_Sources: docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Q Pitch v6 certification; docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Short of the v6 definition of done. Bank id `qa.whats-live`._

**Q: Are these real companies?**
A: No. The companies and investors in this demonstration are fictional and labelled as demonstration data. The product they run on is real.
_Sources: packages/q-pitch/src/investor-v6.ts opening; packages/q-pitch/src/founder-v6.ts opening. Bank id `qa.demo-data`._

**Q: What is on the roadmap?**
A: From the product record: certifying the spoken experience, verifying the full live-meeting journey, and a deeper paid Capital Readiness Blueprint on top of the free diagnosis. The order and timing are the founders' to set, so I'll leave dates to them.
_Sources: docs/specs/q-pitch/CERTIFICATION_MANIFEST.md Short of the v6 definition of done; docs/adr/0036-readiness-blueprint-and-plan-values.md. Bank id `qa.roadmap`._

**Q: How much time does it actually save?**
A: The aim is minutes instead of months to find the right opportunity, but that hasn't been measured with real users yet, so I won't give you a number.
_Sources: docs/ai-handoff/PROMISE-COVERAGE.md LP-01; docs/ai-handoff/LANDING-PROMISES.md LP-01. Bank id `qa.time-saved`._

**Q: What stage is Capital Q at? Do you have traction?**
A: Capital Q is pre-seed and bootstrapped. What you have seen is the working product on its own platform, with demonstration companies clearly labelled as demo data. There is no traction, revenue or customer figure to claim yet, and I won't invent one.
_Sources: docs/specs/q-pitch/CERTIFICATION_MANIFEST.md scene 16 rule. Bank id `qa.stage`._

**Q: What is the business model? How do you make money?**
A: The model is layered. Diagnosis is the core: Q assesses, explains and benchmarks freely, because trust comes first. Deeper strategic intelligence, such as a capital readiness blueprint, is the paid layer, and specialist human execution is optional on top. Ranking is never for sale: there is no pay-to-rank. Pricing levels themselves are not set yet.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #85; CLAUDE.md Recommendations: no pay-to-rank. Bank id `qa.business-model`._

**Q: Is Capital Q free to use?**
A: The full diagnosis is free: the assessment, strengths, gaps, risks and what investors will be concerned about. The paid layer is deeper strategy and execution, such as a Capital Readiness Blueprint, with specialist human help optional on top. Price levels aren't set yet.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #106; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #85. Bank id `qa.free`._

**Q: Do you take a fee when a round closes?**
A: That isn't settled in my sources, so I won't state it. What is fixed is that no one can pay to rank higher, and the diagnosis stays free. The founders can speak to how FDN's own services are charged.
_Sources: docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #85; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #106. Bank id `qa.success-fee`._

**Q: What is your go-to-market?**
A: Capital Q is offered through FDN Capital Partners, with a waitlist and demos for investors and businesses. The plan beyond that is not something I will state as fact; the founders can take you through it.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-04. Bank id `qa.go-to-market`._

**Q: What is FDN Capital Partners' role?**
A: Capital Q comes from FDN Capital Partners, and its assessment framework is FDN's. FDN is also the optional human layer: specialist support where a company needs it, and human review when someone challenges an assessment. The founders can speak to FDN itself.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-25, LP-33; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #50. Bank id `qa.fdn`._

**Q: Who is the team?**
A: The team is not what this pitch is about right now, and I won't make claims about its size. Capital Q comes from FDN Capital Partners; the founders can speak to the team themselves.
_Sources: docs/ai-handoff/LANDING-PROMISES.md capture notes (FDN Capital Partners). Bank id `qa.team`._

**Q: What are you raising?**
A: Capital Q's record states a USD 2 million raise. That is the founders' own claim, shown as a claim like anyone else's, and the terms are for the founders to discuss directly.
_Sources: Capital Q company record (raise: founder claim). Bank id `qa.ask`._

**Q: What is Capital Q's valuation?**
A: Capital Q's funding history and valuation haven't been given to me as approved company material, so I don't know them and won't estimate them. The raise is stated as USD 2 million, as the founders' own claim. The founders can answer the rest directly.
_Sources: docs/specs/q-pitch/story/INVESTOR-QA.md questions Q cannot answer; Capital Q company record (raise: founder claim). Bank id `qa.valuation`._

**Q: How big is the market?**
A: Capital Q's market size hasn't been given to me as approved company material, so I won't put a number on it. I'd rather leave it to the founders than invent one.
_Sources: docs/specs/q-pitch/story/INVESTOR-QA.md questions Q cannot answer. Bank id `qa.market-size`._

**Q: What are your unit economics?**
A: Unit economics and margins haven't been given to me as approved company material, so I don't know them and won't estimate them. The founders can take you through them.
_Sources: docs/specs/q-pitch/story/INVESTOR-QA.md questions Q cannot answer. Bank id `qa.unit-economics`._

**Q: Is there a mobile app?**
A: Capital Q runs in the web browser. Whether there will be a dedicated phone app isn't in my sources, so I won't promise one; the founders can tell you.
_Sources: CLAUDE.md Repository Architecture (apps/web). Bank id `qa.mobile`._

## Founder-side questions (8)

**Q: How do you decide which investors match me?**
A: Only investors who chose to be found appear. Where an investor publishes a gate, I check your company against each of its published criteria and say met, not met, or not known yet. Their private mandate is never read and never shapes your list, and meeting a gate is not a promise of interest. Not known yet means your profile doesn't say yet, never a no.
_Sources: docs/adr/0023-founder-connection-requests.md; docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt criteria. Bank id `qa.founder.which-investors`._

**Q: Can I message an investor directly?**
A: Not cold. You reach an investor in one of two structured ways: a Connection Request, which shows them your company and they accept or decline, or an application through their GateQ gate. Each investor decides whether they take requests at all. Once they accept, you are connected and can chat and book meetings from the shared record.
_Sources: docs/adr/0023-founder-connection-requests.md; docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt modes. Bank id `qa.founder.reach-investor`._

**Q: What happens in the GateQ interview?**
A: After you apply, Q interviews you on the investor's behalf in a short conversation, by voice or video, about what their gate cares about. The investor then receives your application in the same structure as every other: your own words, Q's reading of them and a dossier, with your claims labelled as your claims. The decision stays with the investor.
_Sources: docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt interview; docs/ai-handoff/LANDING-PROMISES.md LP-18, LP-19. Bank id `qa.founder.interview`._

**Q: How do rehearsals work?**
A: You pick who to practise with, and Q plays them by voice, from a persona built only from what you may already see about them. A persona is Q's inference about their style, never a fact about the person, and it is clearly labelled as a simulation. Afterwards Q reviews the call: what went right, what to improve, tips for that meeting and the full transcript.
_Sources: docs/adr/0029-rehearsal-personas-and-vision-frames.md. Bank id `qa.founder.rehearsal`._

**Q: How do I become more investable?**
A: Q assesses your company across the key investment-readiness factors on its evidence, says plainly what may prevent you from raising, and shows what to improve next, in order. Insufficient evidence lowers confidence; it never means a poor company, and anything unknown stays unknown until you add it.
_Sources: docs/ai-handoff/LANDING-PROMISES.md LP-16; docs/adr/0036-readiness-blueprint-and-plan-values.md. Bank id `qa.founder.readiness`._

**Q: Why can't I express interest in other founders' companies?**
A: Expressing interest is an investor action on the one shared relationship between a company and an investor. As a founder, Explore lets you watch other founders' pitches and learn from them; your own way forward with investors is a Connection Request or a GateQ application.
_Sources: docs/adr/0023-founder-connection-requests.md; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt bilateral discovery. Bank id `qa.founder.express-interest`._

**Q: Does Q join my investor meetings?**
A: Yes. Q attends meetings booked on Capital Q, keeps the transcript and a structured record of who attended and what was agreed, and afterwards asks you to confirm any commitments before they count. Commitments you confirm appear in Capital, beside your raise.
_Sources: docs/adr/0027-q-attends-every-capital-q-meeting.md. Bank id `qa.founder.meetings`._

**Q: Why did Q pitch Capital Q instead of my company?**
A: Because the subject everyone in the room knows is Capital Q itself. Q presented it on the same fourteen-section template every founder's overview uses, under the same rules: pre-seed and bootstrapping, the raise shown as the founders' own claim, and nothing invented about traction or team.
_Sources: docs/specs/q-pitch/V6-PLAN.md section 8; docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt Decision #006. Bank id `qa.founder.why-capital-q`._
