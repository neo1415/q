# KUUZA AI — investor-grade research profile

- **Prepared:** 2026-10-18. All pages fetched 2026-10-18 between 17:00 and 17:20 UTC, unless a row says otherwise.
- **Method:** public web only (company pages, founder site, press, UK Companies House). No founder documents, no provider API calls.
- **Machine-readable facts:** [`facts.json`](facts.json). **Brand kit:** [`brand.md`](brand.md) and [`brand.json`](brand.json).

## How to read this profile

Status labels match `facts.json`:

| Label             | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `VERIFIED_PUBLIC` | Confirmed by an independent public record or a third-party publication. Not company marketing. |
| `SELF_REPORTED`   | The company's or founder's own website or marketing. This is a claim, not a verified fact.     |
| `OWNER_PROVIDED`  | Supplied by the Capital Q owner in the brief. Not yet confirmed independently.                 |
| `ASSUMPTION`      | Analyst arithmetic or an inference. Labelled wherever it appears.                              |
| `UNKNOWN`         | Not findable publicly. It stays unknown. It is never read as zero or as negative evidence.     |

Testimonials on kuuza.ai are **published testimonials**. They are not audited traction, and several come from founder-affiliated entities (see Traction).

---

## 1. Proposition (SELF_REPORTED)

> "The Global AI Simulator and Coach for Sales, Service and All Human Communication." (kuuza.ai home)

How it works:

- A user picks a scenario: a cold call, a discovery call, a complaint, an interview, a pitch and so on.
- The user speaks naturally with an AI persona by voice, video or text. The persona answers in real time "with emotion, tone, attitude, and cultural nuance".
- The user gets instant scoring and a debrief.
- Managers see team analytics.

Taglines in use:

- "Simulate Today, Dominate Tomorrow"
- "Practice. Perform. Prevail"
- "Born in Africa. Built for the World"

## 2. Description

KUUZA AI is a B2B and B2C SaaS for practising conversations. Its core uses are:

- sales-rep onboarding and objection-handling roleplay;
- customer-service de-escalation and empathy training;
- a consumer use for individuals: interviews, negotiation, investor pitches, public speaking, even dating and social confidence.

The founder's site adds a direction of travel that the product site does not mention: "Building towards immersive Virtual Reality" ([zinomario.com](https://www.zinomario.com/)).

The name is Swahili: _kuuza_ means "to sell" ([Wiktionary, -uza](https://www.wiktionary.com/wiki/uza)). This is relevant to the Nairobi question in section 4.

## 3. Mission and vision (published, SELF_REPORTED, from [/about](https://www.kuuza.ai/about))

- **Mission:** "To Revolutionize How the World Learns to Communicate". The company says it delivers "AI-powered simulation training that empowers individuals and organizations across every industry, role, and continent."
- **Vision:** "To reinvent how the world learns, practices, and perfects human interaction". The stated aim is to make KUUZA AI "the global backbone of skills training".
- **Origin story:** the company was founded by Zino Mario and Excel Chukwu "after experiencing firsthand how painfully slow sales training can be" in "a previous startup". The site says "Zino brought the vision, Excel brought the tech."

## 4. Headquarters and location: the Nairobi reference resolved

**What the page shows:** [/features](https://www.kuuza.ai/features) shows the text "HQ: Nairobi, Kenya".

**Where it sits in the HTML:**

- The text is a `<span>` inside a small absolutely-positioned overlay chip (`bg-charcoal/90 … backdrop-blur-sm`) with a map-pin icon.
- The chip sits on the stock photo `/images/features-analytics.jpg`, in the "Real-Time Feedback & Analytics" section.
- Next to it is a mock "Team Leaderboard" widget with placeholder percentages (98%, 84%, 42%).

**What else the site says:**

- The phrase appears **once** across the 10 kuuza.ai pages fetched: home, about, features, pricing, contact, faq, success-stories, and the three solutions pages.
- No address appears anywhere on the site.
- No Kenyan entity, phone number, customer or office is referenced anywhere else.

**Evidence for Nigeria:**

- The contact form defaults to 🇳🇬 **+234** and to the country **Nigeria** ([/contact](https://www.kuuza.ai/contact)).
- Every named customer story is Nigerian or tied to the founder: Zino Aviation, FDN Advisory ("Nigeria") and Setu Down ("Nigeria").
- The founder's site says "BASED IN Lagos, Nigeria" ([zinomario.com](https://www.zinomario.com/)).
- Zino Aviation, the founder's company and Kuuza's lead testimonial customer, is Lagos-based. Sources: [ThisDay](https://www.thisdaylive.com/2022/09/09/zino-aviation-takes-off-with-pilot-masterclass/) and [Nairametrics, 2026-07-19](https://nairametrics.com/2026/07/19/zino-aviation-ceo-why-many-licensed-nigerian-pilots-remain-unemployed/).

**Resolution (ASSUMPTION, high confidence):** the Nairobi chip is decorative or placeholder UI copy on a mock analytics dashboard. It is probably themed around the Swahili brand name. It is **not** evidence of an office. Do not record Nairobi as HQ. Ask the founders to remove or confirm it, because it is a public inconsistency.

**HQ assignment:**

- **Operating base:** Lagos, Nigeria. Status `ASSUMPTION`, medium confidence. It is inferred from the founder's location, the Nigerian customer base and the +234 contact defaults.
- **Registered office and legal domicile:** `UNKNOWN`. The owner calls the venture Nigerian. Public signals support a Nigerian operating base.
- **A UK entity may exist:** the founder's sister venture SongScribe is incorporated in England (see the SongScribe profile). An English entity for Kuuza cannot be ruled out, but none was found (see section 5).

## 5. Legal name and trading name

| Item               | Finding                                                                                                                                                                                                                                                                                                                                                          | Status                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Trading name       | "KUUZA AI" in body copy; "KUuZA" in the HTML `<title>`, a stylised wordmark; "Kuuza AI" in mixed case                                                                                                                                                                                                                                                            | SELF_REPORTED                                 |
| Legal entity       | Not published anywhere on the site. `/terms` and `/privacy-policy` return **HTTP 404** even though the footer links to them                                                                                                                                                                                                                                      | UNKNOWN                                       |
| UK Companies House | A search for "kuuza" returned **no** company ([search](https://find-and-update.company-information.service.gov.uk/search/companies?q=kuuza)). The founder's own UK appointments (Efezino Marlon Mario-Ghae) list Pilot Pairing Ltd, Mariozino Ltd and Delta Dash Aviation Ltd, all dissolved. A separate record covers Zino Aviation Ltd. None is a Kuuza entity | VERIFIED_PUBLIC (absence in UK register only) |
| Nigeria CAC        | The CAC public search portal is JavaScript-only and could not be queried from this environment. No secondary-source mention was found                                                                                                                                                                                                                            | UNKNOWN                                       |

## 6. Sector and subsector

| Level     | Classification                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Sector    | Enterprise software / HR tech and EdTech (workforce learning)                                                              |
| Subsector | AI conversation simulation; sales enablement and readiness; contact-centre agent training; communication coaching (B2C)    |
| Adjacent  | Revenue intelligence (real-call scoring is listed in the Custom plan); hiring assessments (also listed in the Custom plan) |

## 7. Business model (SELF_REPORTED, partly ASSUMPTION)

**Free Demo**

- "No Account, No Password, No Credit Card".
- Includes BDR/SDR/AE/discovery roleplay, interactive video simulations, real-time feedback, default BDR/SDR scorecards, full transcription, objection detection and "Unlimited Call Duration".
- Described as "For individual, small teams, founders… Up to 1,000 AI calls."

**Custom Plan** ("Recommended", sold by "Book a Demo")

- Unlimited custom bots, an AI bot builder, learning modules and hiring assessments.
- A custom scorecard builder, real-call scoring and advanced reporting.
- LMS/LXP integration, "CRM Integration (20+)", "SSO & Advanced Security" and "Multilingual Support (30+ Languages)".
- A simulated auto-dialer, product-demo simulations, custom scenario development and a dedicated account manager.

**Revenue model:** inferred as enterprise contracts with custom pricing, sales-led after the demo (ASSUMPTION). No price is published anywhere on the site.

**B2C:** the Individuals page sells "Start Training Free →". No consumer price is published, so whether B2C is monetised is UNKNOWN.

## 8. Capabilities and differentiators (all SELF_REPORTED)

**Capabilities**

- AI roleplay personas whose moods range "from polite to frustrated… hostile". Named demo personas include "Sarah — Sales AI" and "Tyler Jackson, C-Level Executive".
- Voice, video and text simulation.
- **Realistic audio environments:** traffic noise, poor signal, interruptions and network delay. This is uncommon in Western competitors' marketing and fits the African and emerging-market call reality.
- **"Cultural & Contextual Intelligence":** the site says the AI "understands accents, slang, tone, culture, and communication norms… especially within Africa, Asia and The Middle East".
- **Scoring dimensions:** accuracy, tone, structure, speed, clarity, empathy and objection skill; speech pace; and "readiness scores" and "script compliance".
- Manager dashboard, leaderboard, learning paths and benchmarking.
- Customer uploads of scripts, FAQs and customer profiles.
- Integration claims: HubSpot, Salesforce, Zoho, LMS.

**Claimed differentiator:** cultural and accent realism plus noisy-channel simulation for African, Asian and Middle Eastern markets, against "generic AI platforms built predominantly just for Western markets".

**Not evidenced publicly:**

- which speech and LLM stack the product uses;
- latency;
- language coverage beyond the "30+" claim;
- whether the integrations are live or roadmap;
- any security certification.

## 9. Segments and use cases

**Segments**

- Sales teams (BDR, SDR, AE)
- Customer-service and call-centre teams
- Individuals: job seekers, students, founders, professionals

**Industries named:** aviation, banking, healthcare, tech, e-commerce, retail, logistics, government.

**Use cases**

- Cold calls, discovery, objection handling, upselling and demo calls
- Complaint handling and de-escalation (shouting, crying, sarcasm)
- Onboarding "from weeks to days"
- Interviews, salary and rent negotiation
- Investor pitches
- Public speaking and preaching, wedding speeches
- Oral exams and viva practice
- Dating and social confidence

## 10. Live pricing (fetched 2026-10-18)

| Plan      | Published price   | What is stated                                                           | Source                                           |
| --------- | ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Free Demo | Free              | No account or card. "Up to 1,000 AI calls". Feature list as in section 7 | [kuuza.ai/pricing](https://www.kuuza.ai/pricing) |
| Custom    | **Not published** | "Book a Demo"                                                            | same                                             |

The page headline is "Simple, Transparent". It publishes no numeric price.

## 11. Licensing and terms

- The footer links to "Privacy Policy" and "Terms", but `/privacy-policy`, `/terms` and `/privacy` all returned **404** on 2026-10-18.
- **No published privacy policy or terms** were found. This is a material gap, because the product records voice and video of employees and consumers (see Regulatory).

## 12. Named competitors (public sources; figures are third-party reports)

| Competitor                                   | Positioning                                                                          | Public data point                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Second Nature](https://www.secondnature.ai) | AI roleplay for sales and service teams                                              | $22M Series B, Oct 2025, led by Sienna VC; Zoom is an investor and a customer ([Built In NYC](https://www.builtinnyc.com/articles/second-nature-raises-22m-series-b-20251020)) |
| [Hyperbound](https://www.hyperbound.ai)      | AI sales roleplay and real-call scoring (YC)                                         | $15M Series A, Sep 2025, led by Peak XV; $18.3M total ([Entrepreneur India](https://india.entrepreneur.com/?p=87366))                                                          |
| [Yoodli](https://yoodli.ai)                  | AI communication and roleplay coach, individual and enterprise                       | Funding not verified in this pass                                                                                                                                              |
| [Awarathon](https://www.awarathon.com)       | India; AI video roleplay ("Trinity")                                                 | Emerging-market comparator                                                                                                                                                     |
| [FullyRamped](https://www.fullyramped.com)   | AI roleplay for sales reps                                                           | $2.3M raise ([IT Brief UK](https://itbrief.co.uk/story/fullyramped-secures-2-3m-for-ai-sales-training-tech))                                                                   |
| Milameet (Togo)                              | African AI sales-simulation entrant (MIT Solve submission)                           | [solve.mit.edu](https://solve.mit.edu/solutions/95306)                                                                                                                         |
| Mindtickle, Gong, Zenarate, Retorio          | Incumbent sales-readiness and revenue-intelligence suites; contact-centre simulation | Category incumbents (links not individually verified in this pass)                                                                                                             |

**Implication (ASSUMPTION):** the category is funded and crowded in North America. Kuuza's defensible wedge, if real, is accent, culture and noisy-channel realism plus price fit for African, Middle Eastern and South Asian enterprises. That needs evidence: a model and eval data on non-Western accents.

## 13. Go-to-market (SELF_REPORTED plus ASSUMPTION)

**Published channels**

- A free self-serve demo.
- "Book a Custom Demo".
- "Partner With Us… training institutions & tech".
- LinkedIn, Instagram and YouTube handles `@kuuza-ai`.
- A newsletter.
- Contact by email, phone, WhatsApp or Zoom.

**Inferred motion (ASSUMPTION):** founder-led enterprise sales, seeded through the founder's own network. The lead logos are the founder's Zino Aviation and FDN, where the founder is a Partner. Expansion would go through Nigerian SMEs and services firms.

## 14. Founders

| Founder          | Public background                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zino Mario**   | Public name "Captain Zino Mario". He is identified as Capt. Zino Mario-Ghae ([ThisDay](https://www.thisdaylive.com/2022/09/09/zino-aviation-takes-off-with-pilot-masterclass/)); the UK register lists the officer name Efezino (Marlon) Mario-Ghae. Founder and CEO of Zino Aviation, a Lagos pilot-training and consultancy firm that says it has a Boeing 737NG simulator in Lagos ([Nairametrics 2026-07-19](https://nairametrics.com/2026/07/19/zino-aviation-ceo-why-many-licensed-nigerian-pilots-remain-unemployed/)). He became a licensed pilot at 18 and retired from flying at 26 (ThisDay). His own site says he was born in Nigeria and raised in the UK (Isle of Wight and Norwich); calls himself "Nigeria's youngest commercial pilot" at 19 and a Sikorsky S-92 offshore pilot; claims to be an England national high-jump champion and a two-time TEDx speaker; and says he is a Partner at FDN Capital Partners ([zinomario.com](https://www.zinomario.com/)) | Press: VERIFIED_PUBLIC (third-party press). Records and titles: SELF_REPORTED. "Youngest" is **unverified**: other people have been publicly reported with similar records |
| **Excel Chukwu** | Named cofounder on [/about](https://www.kuuza.ai/about) ("Excel brought the tech"). **No public professional footprint was found**: no LinkedIn, GitHub or press result under this name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | OWNER_PROVIDED plus SELF_REPORTED; background UNKNOWN                                                                                                                      |

**Prior ventures on the UK register (VERIFIED_PUBLIC):** Pilot Pairing Ltd (appointed 2017), Mariozino Ltd (2014) and Delta Dash Aviation Ltd (2013), all **dissolved**. Zino Aviation Ltd (UK, inc. 2020-12-24) is active, but the register shows "Accounts overdue" as of 2026-10-18. These may be the "previous startup" in the origin story (ASSUMPTION).

## 15. Traction claims (SELF_REPORTED; none audited)

**Widget figures**

- "+34% Close Rate", "12 Days Streak", "11.7% Book Rate" and "Score: 12.6%" appear in the hero.
- These are **illustrative UI mock-ups**, not reported metrics.

**Testimonials on [/success-stories](https://www.kuuza.ai/success-stories), with related-party flags**

| Person                                     | Company             | Relationship                                                                                                                                                                     |
| ------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rita Ekwonu, Exec. Asst to the CEO         | Zino Aviation       | **Related party:** the cofounder's own company                                                                                                                                   |
| Olabisi Ajikanle, Head of Growth & Revenue | Zino Aviation       | **Related party.** Note: the job title differs between pages ("Head of Growth & Sales" on home)                                                                                  |
| David Nwankwo, CEO                         | FDN Advisory        | **Related party:** zinomario.com names David Nwankwo as Managing Partner of FDN Capital Partners, where Zino is a Partner. The home page labels him "Tech Sales Lead / Director" |
| Samson Popola, CEO                         | Setu Down (Nigeria) | Relationship UNKNOWN. The quote says "We tested KUUZA AI", which is a trial, not necessarily paid use                                                                            |
| Nia Thompson, "CEO OF Proxima"             | /features page      | Unidentifiable. UNKNOWN                                                                                                                                                          |

**Other claims**

- "Teams typically see improvements within the first week" (FAQ).
- "Most managers spend 70-80% of their time coaching" (Sales Teams page). No source is given; treat as marketing.

**Not published:** customer count, paying customers, ARR or revenue, usage volumes, retention.

## 16. Risks

1. **Related-party traction.** At least three of the four named stories come from founder-affiliated entities. Independent paying customers are unproven.
2. **Missing legal pages.** Terms and privacy links 404 while the product processes biometric-adjacent voice and video. This is a trust and compliance blocker for enterprise and investor diligence.
3. **Public inconsistencies:** the "HQ: Nairobi, Kenya" chip; mismatched testimonial titles; mock metrics styled like results.
4. **Technical cofounder opacity.** No public footprint for Excel Chukwu. The IP ownership, the model stack and third-party dependencies are unknown.
5. **Crowded, well-funded category.** Second Nature, Hyperbound and Yoodli are already selling to global enterprises.
6. **Founder bandwidth.** Zino Mario is concurrently running Zino Aviation, SongScribe AI, FDN Capital Partners (Partner) and the Man-Up Initiative.
7. **Model and vendor dependency (ASSUMPTION).** Real-time voice and video simulation usually relies on third-party ASR, LLM and TTS APIs. Gross margin and latency depend on those vendors.
8. **Scope sprawl.** The B2C use cases (dating, preaching, spouse conversations) may dilute an enterprise positioning.

## 17. Regulatory considerations

- **Nigeria Data Protection Act 2023 (NDPA) and NDPC oversight:**
  - voice and video recordings and performance scores of employees are personal data;
  - lawful basis, data-subject notices and cross-border transfer rules apply;
  - a published privacy notice is expected.
- **EU AI Act Article 5(1)(f)** prohibits AI systems that infer the emotions of people in the workplace, except for medical or safety reasons, from 2 February 2025.
  - Kuuza's scoring of "empathy", "emotional intelligence" and "confidence" from employees' voice would need careful scoping before any EU sale.
  - Employment-related AI can also be high-risk under Annex III. The Custom plan lists "Hiring Assessments", which raises that question directly.
- **UK and EU GDPR** apply if they sell to UK or EU employers. Voice data can become special-category biometric data if it is used to identify people.
- **US:** state laws on biometrics (for example Illinois BIPA) and on AI in hiring (for example NYC Local Law 144) apply if they sell hiring assessments there.
- **Consumer protection:** the B2C "dating" and minors' "school" use cases need age gating and content policies.

## 18. Market sizing (sourced figures plus ASSUMPTION arithmetic)

**Sourced figures**

- **Global corporate training spend:** $394.5B in 2025. Of this, $186.4B was North America and $208.2B the rest of the world. The 2026 estimate is $398.8B. Source: [Training Industry, "Size of the Training Industry"](https://trainingindustry.com/wiki/strategy-alignment-and-planning/size-of-training-industry/). The figure excludes consumer spend.
- **Category funding signal:** Second Nature's $22M Series B (Oct 2025) and Hyperbound's $15M Series A (Sep 2025), as cited in section 12.

**ASSUMPTION arithmetic.** These are illustrative only. Every percentage below is an analyst assumption, not a sourced number.

| Step                                                                                                                              | Calculation        | Result              |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| **TAM.** Share of corporate training that is sales and customer-service communication training: 10% (ASSUMPTION)                  | $394.5B × 10%      | ≈ $39.5B            |
| Share of that addressable by AI simulation software: 10% (ASSUMPTION)                                                             | $39.5B × 10%       | **TAM ≈ $3.9B**     |
| **SAM.** Rest-of-world spend, with Africa, the Middle East and South Asia taken as 8% of RoW (ASSUMPTION)                         | $208.2B × 8%       | ≈ $16.7B            |
| Apply the same 10% communication share and 10% software share (ASSUMPTION)                                                        | $16.7B × 10% × 10% | **SAM ≈ $167M**     |
| **SOM.** 1% of SAM within about 5 years (ASSUMPTION)                                                                              | $167M × 1%         | **SOM ≈ $1.7M ARR** |
| **Bottom-up cross-check.** 100 enterprise accounts × 50 seats × $30 per seat per month (all ASSUMPTION; Kuuza publishes no price) | 100 × 50 × 30 × 12 | ≈ $1.8M ARR         |

**B2C** (individual communication coaching) is excluded from this table. It is UNKNOWN whether Kuuza monetises it.

## 19. Open questions needing founder documents

1. Legal entity or entities: name, jurisdiction, CAC RC number or UK number, registered address, date of incorporation.
2. Cap table, and whether Excel Chukwu holds equity and IP-assignment agreements.
3. Excel Chukwu's CV and his technical ownership of the stack.
4. The model and vendor stack (ASR, LLM, TTS, video avatar), unit cost per simulated minute, and latency.
5. Paying customers and contracts, separating related parties (Zino Aviation, FDN) from independent ones; ARR, pilots and conversions; retention.
6. Price list for the Custom plan; whether B2C is monetised.
7. Evidence for the "30+ languages", "20+ CRM integrations" and "SSO" claims: live or roadmap?
8. Privacy policy, terms, DPA, data retention and where data is hosted; any NDPA compliance filings.
9. Accent and culture evaluation data supporting the "culturally intelligent" claim.
10. Why the features page says "HQ: Nairobi, Kenya", and whether there is any Kenyan operation or plan.
11. Funding raised to date (none found publicly; UNKNOWN, not zero).
