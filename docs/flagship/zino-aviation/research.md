# Zino Aviation: flagship research dossier

- Prepared: 2026-10-18 (pages fetched 15:45–17:20 UTC; core claims re-checked 17:10–17:20 UTC). Research branch `claude/flagship-research-b-oct18`.
- Scope: public web only. No founder documents were available, and no provider APIs or production systems were used.
- Status vocabulary: same as `facts.json`.
  - **VERIFIED_PUBLIC:** an independent public record (registry, regulator, third-party press reporting an event).
  - **SELF_REPORTED:** the company's own website, the founder's own site, or the founder quoted in press.
  - **OWNER_PROVIDED:** supplied by the Capital Q owner in the research brief.
  - **ASSUMPTION:** our own modelling input.
  - **UNKNOWN:** not established.
- Press that only repeats company claims stays SELF_REPORTED.
- Licences, aircraft ownership, market leadership, placement outcomes and partnerships remain claims unless an independent source confirms them. None of these was independently confirmed.

## 1. Proposition (one paragraph)

Zino Aviation is a Lagos-based aviation services business. It markets two divisions under one brand:

- **Zino Aviation Academy** (a pilot-career consultancy): mentorship, ground school, simulator experience, partner-school flight training, type-rating brokerage, assessment and recruitment.
- **Zino Aviation Jet** ("Private Aviation, Simplified"): a single-point private-aviation advisory and brokerage proposition covering acquisition, charter, sales, financing, interiors, management, revenue/charter management and a travel concierge.

The Academy has years of public evidence of operation. The Jet division is a newly built website (stylesheets versioned `20261006`, i.e. early October 2026). Most of its service pages are still "Coming Soon", and we found no independent evidence that it operates yet.

## 2. Description and history

| Date / period        | Event                                                                                                                                                                                                                    | Status                                                                                                                                                | Source                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2018                 | "In 2018, he founded Zino Aviation, the world's first and leading Pilot Training Consultancy firm"                                                                                                                       | SELF_REPORTED (founding year); "world's first and leading" is an unverified marketing claim                                                           | https://academy.zinoaviation.com/ and https://academy.zinoaviation.com/start-flying                                                                                   |
| 2020-12-24           | **ZINO AVIATION LTD** (UK company 13100002) incorporated. Registered office in Edgware, England; SIC 70229 (management consultancy). Directors are Efezino MARIO-GHAE and Temisan MARIO-GHAE, both appointed 2020-12-24. | VERIFIED_PUBLIC (Companies House)                                                                                                                     | https://find-and-update.company-information.service.gov.uk/company/13100002                                                                                           |
| 2021                 | Founder "retired from active flying in 2021 to focus on running Zino Aviation full-time"                                                                                                                                 | SELF_REPORTED                                                                                                                                         | academy.zinoaviation.com                                                                                                                                              |
| c. Sep 2022          | First in-person Pilot Masterclass held in Lagos (The Legend Hotel by Hilton); said to have sold out. The firm previously ran from a UK base and was "setting up an office in Lagos".                                     | Event reported by press (VERIFIED_PUBLIC that press reported it). The sell-out, unnamed airline commitments and recruitment claims are SELF_REPORTED. | https://www.thisdaylive.com/2022/09/09/zino-aviation-takes-off-with-pilot-masterclass/                                                                                |
| Undated (2023–2025?) | Strategic alliance with SafeFly Express (Johannesburg)                                                                                                                                                                   | Press-reported; terms UNKNOWN                                                                                                                         | https://guardian.ng/business-services/aviation-business/zino-aviation-safefly-partner-on-capacity-building/ (HTTP 403 to our fetcher; summary from search index only) |
| 2026-07-19           | Nairametrics interview. The CEO says the company has a "new state-of-the-art Boeing 737NG flight simulator in Lagos" and "more than 8,000 aspiring pilots in our network".                                               | SELF_REPORTED                                                                                                                                         | https://nairametrics.com/2026/07/19/zino-aviation-ceo-why-many-licensed-nigerian-pilots-remain-unemployed/                                                            |
| Oct 2026             | Gateway site zinoaviation.com splits the brand into Jet and Academy. jet.zinoaviation.com launched as a custom static site.                                                                                              | Observed directly (site build markers)                                                                                                                | https://zinoaviation.com/ and https://jet.zinoaviation.com/                                                                                                           |

Discrepancies to resolve with the founder:

1. **Founding year.** The bio says 2018. The UK company was incorporated in Dec 2020. A Nigerian (CAC) entity was not found. 2018 may be the start of trading as a sole venture, or a different entity.
2. **Early career.**
   - ThisDay (2022) says he "retired from flying at 26".
   - The Academy site says he retired from active flying in 2021.
   - zinomario.com says he was "Nigeria's youngest commercial pilot" at 19.
   - FDN Capital Partners' team page says he was "licensed as an airplane pilot at 18 and a commercial helicopter pilot at 19".

   These sources are broadly consistent, but none of them is independently verified.

3. **Co-founder.** ThisDay (2022) names **Temisan Mario** as "Chief Operating Officer and Co-Founder". The Guardian (via search snippet) names Temisan Mario as COO. Companies House lists Temisan MARIO-GHAE as a director of the UK company.

## 3. Headquarters and locations

- **Lagos, Nigeria.**
  - Jet site footer and contact page: "Lagos, Nigeria" (SELF_REPORTED).
  - Academy careers page: roles located in "VI, Lagos" (Victoria Island) (SELF_REPORTED).
  - zinomario.com: the simulator is "based in Victoria Island, Lagos" (SELF_REPORTED).
  - Simulator FAQ phone line: +234 810 948 7652 (SELF_REPORTED).
  - Third-party job boards (hotnigerianjobs, Fuzu) list Lagos/Victoria Island roles. Fuzu shows a company size of "20-50 people", which is the employer's self-description.
- **Academy footer cities:** "London, United Kingdom | Lagos, Nigeria | Johannesburg, South Africa | Megara, Greece".
  - Johannesburg (SafeFly Express, Lanseria) and Megara (TAE Aviation Academy) are **partner flight-school locations** named on the programme pages. They should not be read as Zino-owned premises.
  - London matches the UK company's registered office region (Edgware, Middlesex).
- **Medicals:** "only conducting medical examinations in Lagos and Port Harcourt" through partner AMEs (SELF_REPORTED).

## 4. Legal and trading names (verdict)

| Name                                              | What it is                                                                                                                                                     | Evidence                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **ZINO AVIATION LTD** (England & Wales, 13100002) | Registered UK private limited company, active. Accounts overdue as of 2026-10-18 (next accounts were due 2026-09-30).                                          | Companies House (VERIFIED_PUBLIC)                                                                                                     |
| Nigerian entity                                   | **UNKNOWN.** No CAC registration name or RC number found on any site, footer, privacy policy or press article.                                                 | Academy privacy-policy PDF names only "Zino Aviation". Jet "Privacy Policy" and "Terms of Service" links point to `coming-soon.html`. |
| "Zino Aviation" / "ZINO AVIATION"                 | Trading brand used on every site                                                                                                                               | All sites                                                                                                                             |
| "Zino Aviation Jet" / "Zino Aviation Jets"        | Division/sub-brand of Zino Aviation. The site's own footer reads "© 2026 Zino Aviation".                                                                       | jet.zinoaviation.com                                                                                                                  |
| "Zino Aviation Academy"                           | Division/sub-brand. Footer "© 2026 ZINO AVIATION"; contact enquiries@zinoaviation.com.                                                                         | academy.zinoaviation.com                                                                                                              |
| "Zino Group"                                      | Umbrella name used in job adverts: "multiple companies within the Group" across "aviation, artificial intelligence, technology, consulting, media, education". | academy.zinoaviation.com/careers (SELF_REPORTED). We found no registered "Zino Group" entity.                                         |

**Verdict: Jet and Academy are divisions (trading sub-brands) of one Zino Aviation business, not evidenced as separate legal entities.**

- Both carry the same "Zino Aviation" copyright line.
- Both share the zinoaviation.com domain and the gateway page.
- Neither names a distinct company.

The only registered entity found is the UK ZINO AVIATION LTD. Which legal entity contracts with Nigerian customers (and holds any Nigerian permits) is **UNKNOWN**. This is the first item to obtain from founder documents (CAC certificate, MEMART, CAC status report).

**Other ventures to keep distinct from Zino Aviation.** These are listed on zinomario.com; all are SELF_REPORTED.

- **Kuuza AI** (kuuza.ai): AI communication simulator.
- **SongScribe AI** (songscribe.ai): AI music platform.
- **FDN Capital Partners** (fdncapitalpartners.com): Zino Mario is listed as "Partner (Vision, Growth & Governance)"; David Nwankwo is Managing Partner and is credited there with creating Capital Q. FDN publicly hosts the CapitalQ™ landing page at https://www.fdncapitalpartners.com/capitalq/.
- **Capital Q**: zinomario.com does not list it. The owner names Zino Mario as a cofounder (OWNER_PROVIDED); see `../capital-q/research.md`.

None of these is evidenced as part of Zino Aviation. Do not attribute their revenue, staff or IP to Zino Aviation.

## 5. Sector

Aviation services, in three parts:

- **Academy:** aviation education, careers and consultancy. Also flight-training brokerage, pilot recruitment, simulator experiences and training-programme logistics for governments and airlines.
- **Jet:** business aviation advisory and brokerage, in particular aircraft transactions, charter brokerage, management and concierge.
- The business does **not** evidence operating aircraft itself (see §11).

## 6. Business model (as published)

**Academy revenue streams.** The site markets these. Prices appear only where stated.

- **1-on-1 calls with Capt. Zino:** ₦95,000 for 30 min and ₦150,000 for 1 hr; a 15-min exploration call is "Request to Book". SELF_REPORTED price list at https://academy.zinoaviation.com/call.
- **Online Pilot Masterclass, Employment Bootcamp and free pilot webinar:** event and course fees. Prices are not captured here.
- **Pilot Mentorship Programme:** fee-based; the price was not captured.
- **Ground school and simulator sessions in Lagos:** the simulator runs about 1h30 sessions with "different packages", gift certificates, and corporate and educational group packages. Prices are behind booking.
- **Partner flight-school programmes.** Fees are published as the programme cost; Zino's own take (commission or margin) is **UNKNOWN**.
  - SACAA 0-CPL with SafeFly Express, Johannesburg: the page states both "$45,000 / 12–13 months" and "ZAR 875,000 ($54,000) / 18–24 months". **This is an internal inconsistency.**
  - SACAA CPL+CFI: ZAR 948,000 ($58,500).
  - SACAA PPL: $19,000.
  - EASA 0-ATPL(f) with TAE Aviation Academy, Megara: the page states both "€65,000" and "€62,000". **This is also inconsistent.**
  - EASA 0-ATPL+FI: €72,500.
  - EASA PPL: €15,000.
- **Type ratings via partner ATOs:** "competitive rates and a Zino Aviation discount". Sim-partner pairing; online CBT type-rating preparation courses.
- **Aviation medicals via partner AMEs:** FAA, TCCA, EASA, NCAA and SACAA certificates are claimed. Issuance is by the licensed AME, not Zino.
- **Pilot recruitment ("Employment Service"):** candidates apply through Zino, which assesses them and recommends them to "partner airlines and private jet companies". It claims "established agreements with airlines". No airline is named.
- **Logistics management for governments, parastatals and airlines:** full programme management (selection, travel, visas, payments, welfare, progress reports via "our training management system", employment). No client is named.
- **Consultancy, speaking and media.**

**Jet revenue streams.** These are inferred from the marketed services. No price is published anywhere.

- Advisory fees.
- Brokerage commissions (acquisition, sales, charter).
- Management fees.
- Revenue-share on owner aircraft chartered through the "ZinoJet Network".
- Concierge mark-ups.
- Interiors project fees.
- Financing advisory fees.

All of these are **UNKNOWN** in amount and in whether any has been earned.

## 7. Services and status

Status key:

- **ACTIVE:** published evidence of current operation (bookable with price/schedule, live form plus operational detail, job adverts, third-party report).
- **MARKETED:** a live page with a description but no evidence of delivery.
- **PLANNED:** a "Coming Soon" page, or the service is described only on the homepage.
- **PARTNER-DELIVERED:** a third party performs the regulated or core activity.

### Jet (jet.zinoaviation.com)

| Service                                              | Status                                 | Evidence                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private jet charter                                  | MARKETED (likely PARTNER-DELIVERED)    | `charter.html` is live with a quote-request form and a list of trip types. No aircraft, operator, AOC holder or completed flight is named. No public NCAA AOC for a Zino entity was found. Charter would legally have to be flown by an AOC holder.                                                                                                |
| Aircraft acquisition (via "The JetVault Experience") | MARKETED                               | `aircraft-acquisition.html` is live. It describes the "private JetVault Experience Centre" (in-person with an interactive display) and the "JetVault digital platform" for live cabin and exterior customisation. We found no evidence that the centre's address exists or that the platform is live. No completed transaction has been evidenced. |
| JetVault (Experience Centre + digital platform)      | MARKETED / PLANNED                     | As above. It is described in the future-facing "Bring Your Future Aircraft to Life" copy.                                                                                                                                                                                                                                                          |
| The Journey Concierge™                               | MARKETED (PARTNER-DELIVERED by nature) | `journey-concierge.html` is live. It lists 10+ concierge solutions (hotels, chauffeur, VIP airport, close protection, helicopters, yachts, events). Delivery is by third-party providers. Trademark registration of "Journey Concierge" is UNKNOWN: the ™ sign is only a claim.                                                                    |
| Aircraft sales                                       | PLANNED                                | Nav link → `coming-soon.html`.                                                                                                                                                                                                                                                                                                                     |
| Aircraft management                                  | PLANNED                                | → `coming-soon.html`. Management that includes "crew coordination, regulatory compliance" in Nigeria typically sits with an AOC holder or an approved maintenance organisation.                                                                                                                                                                    |
| Aircraft financing (advisory)                        | PLANNED (PARTNER-DELIVERED by nature)  | → `coming-soon.html`. The copy says "explore financing solutions". No lender is named.                                                                                                                                                                                                                                                             |
| Interiors & customisation                            | PLANNED (PARTNER-DELIVERED by nature)  | → `coming-soon.html`. Completion centres are not named.                                                                                                                                                                                                                                                                                            |
| Revenue & Charter Management / ZinoJet Network       | PLANNED                                | Homepage section only; "Estimate Revenue Potential" → `coming-soon.html`. No network members are named.                                                                                                                                                                                                                                            |
| Advisory / consulting for HNW clients                | MARKETED                               | Homepage copy; Advisory page → `coming-soon.html`. A contact form exists. zinomario.com says the firm works with "airlines, governments, and high-net-worth clients" (SELF_REPORTED).                                                                                                                                                              |
| Knowledge Centre (guides, comparisons, videos)       | PLANNED                                | All links → `coming-soon.html`.                                                                                                                                                                                                                                                                                                                    |
| About / Privacy / Terms                              | PLANNED                                | → `coming-soon.html`. **A Jet site with a live data-collection form but no privacy policy is a compliance gap** (see §13).                                                                                                                                                                                                                         |

### Academy (academy.zinoaviation.com)

| Service                                                                    | Status                                                | Evidence                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pilot mentorship (Capt. Zino)                                              | ACTIVE                                                | Dedicated page and named testimonials, including a "First Officer, Bristow Group, S76D" and a "First Officer, ATR … Green Africa Airways". Testimonials are SELF_REPORTED; employment outcomes are not independently verified.                                                                                                          |
| 1-on-1 consultancy call                                                    | ACTIVE                                                | Bookable, with ₦ prices (/call).                                                                                                                                                                                                                                                                                                        |
| Online Pilot Masterclass / Employment Bootcamp / free webinar              | ACTIVE                                                | Pages live. The ThisDay 2022 report covers an in-person masterclass.                                                                                                                                                                                                                                                                    |
| Ground school (online and in-person)                                       | ACTIVE (per job adverts)                              | Careers page: "Ground & Simulator Instructor … VI, Lagos". The `/ground` page returned an empty render to our fetcher.                                                                                                                                                                                                                  |
| Flight simulator experience (Lagos)                                        | ACTIVE                                                | `/simulator`: bookable, operating hours (Mon–Fri 9–6, Sat 8–12), phone, gift certificates.                                                                                                                                                                                                                                              |
| Boeing 737NG simulator                                                     | SELF_REPORTED ownership; device qualification UNKNOWN | zinomario.com: "Zino Aviation owns a Boeing 737NG flight simulator based in Victoria Island". Nairametrics quotes the CEO. A Fuzu job seeks a retired 737NG captain. The `/simulator` page itself does not name the type. **No NCAA/EASA FSTD qualification level was found.** It must not be described as a qualified training device. |
| Flight training (PPL/CPL/IR/ME; FAA, EASA, ICAO, SACAA)                    | PARTNER-DELIVERED                                     | "through our partnerships with reputable flight schools". Named partners: SafeFly Express (Lanseria, Johannesburg) and TAE Aviation Academy (Megara, Greece).                                                                                                                                                                           |
| Type ratings (B737 CL/NG/MAX, A320, ATR, E-Jets, CRJ, Dash 8, AW139, S76…) | PARTNER-DELIVERED                                     | "through our partner type rating providers and ATOs". The providers are not named.                                                                                                                                                                                                                                                      |
| Type-rating preparation CBT course                                         | MARKETED                                              | "REGISTER FOR COURSE"; email programmes@zinoaviation.com.                                                                                                                                                                                                                                                                               |
| Sim-partner pairing                                                        | MARKETED                                              | Described on /type.                                                                                                                                                                                                                                                                                                                     |
| Licence conversion                                                         | UNKNOWN                                               | Not found as a distinct service on the fetched pages. The /type and logistics pages cover licensing paperwork "with the relevant CAAs".                                                                                                                                                                                                 |
| Aviation medicals                                                          | PARTNER-DELIVERED (ACTIVE in Lagos/Port Harcourt)     | Via partner AMEs.                                                                                                                                                                                                                                                                                                                       |
| Psychometric / aptitude assessment                                         | MARKETED                                              | Homepage.                                                                                                                                                                                                                                                                                                                               |
| Recruitment / placement (Employment Service)                               | MARKETED (outcomes SELF_REPORTED)                     | /pilotjob. Agreements with airlines are claimed; none is named. ThisDay 2022 reports a claim of recruiting "for a major airline" (unnamed).                                                                                                                                                                                             |
| Interview preparation                                                      | MARKETED                                              | Bootcamp, plus "interview training" on the homepage.                                                                                                                                                                                                                                                                                    |
| Logistics management (government/airline cadet programmes)                 | MARKETED                                              | /logistics. No named client. The CEO says cadet programmes are "being developed" (Nairametrics 2026).                                                                                                                                                                                                                                   |
| Aviation consultancy                                                       | MARKETED                                              | Homepage; /our-services.                                                                                                                                                                                                                                                                                                                |
| Speaking / media                                                           | ACTIVE                                                | TEDx talks and interviews are listed on zinomario.com. ThisDay and Nairametrics coverage.                                                                                                                                                                                                                                               |
| Pilot funding / loans                                                      | PLANNED                                               | The CEO says the company is working on pilot-funding solutions with banks, airlines and governments (Nairametrics 2026). No product is live.                                                                                                                                                                                            |

## 8. Customers and buying process

**Academy.**

- **Customers:** aspiring pilots (largely Nigerian; global marketing), families and corporates for simulator sessions, and qualified pilots seeking jobs.
- **Institutional buyers:** governments, parastatals, airlines and private operators for assessment, logistics and recruitment.
- **Funnel:** content (blog, social, TEDx, webinars) → free webinar or paid call → masterclass → mentorship → enrolment at a partner school → type rating → employment service.
- **Payment:** online gateways (PayPal, Paystack, DPO) or "Offline Payment" (contact page).
- **Network size:** "More than 8,000 aspiring pilots in our network" (SELF_REPORTED, Nairametrics 2026). The homepage counters render as the template placeholders "TITLE 1000+" and are not data.

**Jet.**

- **Targets:** HNW individuals, corporates, government and diplomatic travel, medical/special missions, and aircraft owners.
- **Funnel:** "Book a Private Consultation" (email link), the charter quote form, the contact form, or a JetVault consultation in person or online.
- **Customers:** no named customer, testimonial or completed transaction appears on the site.

## 9. Pricing and revenue

- Published prices are limited to:
  - the ₦ call fees;
  - the partner-programme tuition figures (§6);
  - simulator accommodation figures for the SafeFly partner (shared flat ZAR 7,200/month incl. transport, as shown).
- **Revenue, margins, student counts, placements, aircraft transactions: UNKNOWN.** We did not obtain the UK company's filed accounts (overdue for FY2025; the FY2024 accounts were filed but not opened here). Do not infer revenue from tuition prices: Zino likely earns a fee or commission, not the full tuition.

## 10. Founder background

**Captain Zino Mario** (Founder & CEO).

- **Registered name.** Companies House officer record: "MARIO-GHAE, Efezino", British nationality. ThisDay styles him "Capt. Zino Mario-Ghae". Date-of-birth data from the register is deliberately omitted here.
- **Self-reported background.** Sources: Academy site, zinomario.com, FDN team page. All SELF_REPORTED.
  - British-Nigerian; born in Nigeria and raised in the UK (Isle of Wight, Norwich).
  - Private pilot at 18 and commercial pilot at 19; "Nigeria's youngest commercial pilot". **This superlative is unverified.**
  - Flew airplanes and helicopters, including offshore Sikorsky S-92 operations.
  - "Holds EASA, FAA, and ICAO Airplane, Helicopter, and UAV licenses". **Licence numbers and validity are not verified.**
  - Trained "in over seven flight schools", "flown across three continents".
  - "Several thousand flight hours" (ThisDay 2022). Retired from active flying in 2021.
  - England national high-jump champion. **Unverified; no athletics-record source was checked.**
  - Two-time TEDx speaker. zinomario.com embeds a "TEDx Presentation"; the event names were not captured.
- **Other roles (SELF_REPORTED).** Partner at FDN Capital Partners; founder of Kuuza AI and SongScribe AI; Capital Q co-founder (OWNER_PROVIDED).
- **Co-founder / COO.** Temisan Mario (Mario-Ghae): COO and Co-Founder (ThisDay 2022). Also a UK director (Companies House).
- **Note on the simulator type.** The `/simulator` booking page itself does not name the aircraft type; the 737NG claim comes only from zinomario.com and the CEO's Nairametrics interview.

## 11. Partnerships: claimed vs evidenced

| Partner                                      | Claimed role                                                                | Evidence level                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| SafeFly Express (Lanseria, Johannesburg, SA) | Partner flight school (SACAA CPL), accommodation, CFI/FO employment pathway | Named on the Zino site. A Guardian Nigeria headline reports an alliance (press reporting the announcement). Contract terms UNKNOWN. |
| TAE Aviation Academy (Megara, Greece)        | Partner EASA ATO for the ATPL programme                                     | Named on the Zino site only (SELF_REPORTED). No counter-party confirmation found.                                                   |
| Partner type-rating providers / ATOs         | Type-rating delivery                                                        | Unnamed. UNKNOWN.                                                                                                                   |
| Partner AMEs                                 | Class 1/2/3 medicals                                                        | Unnamed. UNKNOWN.                                                                                                                   |
| "Partner airlines and private jet companies" | Recruitment off-takers                                                      | Unnamed. Testimonials mention Bristow and Green Africa as employers of mentees. This is not evidence of a partnership.              |
| Banks, airlines, governments                 | Pilot funding, cadet programmes                                             | "Working on" (Nairametrics 2026). UNKNOWN.                                                                                          |
| ZinoJet Network                              | Charter-revenue network for owner aircraft                                  | No members or operators named. PLANNED.                                                                                             |
| AOC holder for charter                       | Would operate charter flights                                               | **Not named anywhere. Required before charter can be represented as operational.**                                                  |
| "As Featured in" logos                       | Media                                                                       | Logos are image-only on the Academy home page. Confirmed press: ThisDay (2022), Nairametrics (2026), Guardian Nigeria (alliance).   |

## 12. Competition (illustrative, not exhaustive)

**Academy.**

- **Nigerian ATOs and simulator centres.** Examples:
  - Caverton Aviation Training Center, Lagos: NCAA-approved ATO015 with an EASA-qualified AW139 Level D FSTD, per an AFM report (https://afm.aero/african-pilot-simulator-training-center-receives-easa-fstd-aw139-qualification-certificate).
  - Lagos Aviation Academy: NCAA-approved ATO (https://blueprint.ng/?p=243994).
  - The Nigerian College of Aviation Technology (NCAT, Zaria).
  - International Aviation College, Ilorin.
- **Global and regional flight schools that recruit Nigerian students directly**, plus agent/consultant intermediaries.
- **Social-media pilot mentors.**
- **Differentiation claimed by Zino:** end-to-end mentorship, cost reduction, employment network, and a Lagos 737NG simulator.

**Jet.**

- Charter brokers and operators serving Nigeria. BusinessDay reported "36 private jet operators" in the country (https://businessday.ng/exclusives/article/safety-concerns-comfort-drive-uptake-private-chartered-plane-jet-services/, undated in our results).
- International brokers active in the market, such as PrivateFly and LunaJets.
- Global acquisition advisors and fractional programmes.

## 13. Market opportunity

**Cited figures.**

- **Pilot demand.** Boeing's 2025 Pilot & Technician Outlook (2025–2044) projects **23,000 new pilots in Africa**, out of about 660,000 globally (https://investors.boeing.com/investors/news/press-release-details/2025/Boeing-Forecasts-20-Year-Global-Demand-for-Nearly-2-4-Million-New-Commercial-Pilots-Technicians-Cabin-Crew/default.aspx).
  - A later Boeing Africa forecast for 2026–2045 cites 22,000 (https://afm.aero/boeing-forecasts-africa-will-need-22000-new-pilots-as-fleet-more-than-doubles-by-2045).
  - Do not mix the two windows.
- **Private jets in Nigeria.** The figures conflict:
  - "nearly 240" operating: Minister Festus Keyamo, reported at https://ground.news/article/nigeria-has-highest-number-of-private-jets-in-africa.
  - "over 157 by 2024": a former NCAT rector, reported by AllAfrica (https://allafrica.com/stories/202603200305.html).
  - The CEO also cites "about 240".
  - The definitions (registered vs operating) differ.
- **Type ratings** cost about US$15,000–25,000 (CEO claim, Nairametrics 2026).

**ASSUMPTION-labelled sizing.** Illustrative only, not a forecast. Every input below is an assumption unless cited.

- **Academy (training-spend TAM, Africa).**
  - 23,000 pilots ÷ 20 years ≈ **1,150 new pilots/yr** (cited input).
  - × ASSUMPTION average ab-initio cost of US$55,000, the midpoint of Zino's own published partner prices of $45k–€72.5k.
  - ≈ **US$63M/yr of tuition spend** (TAM of the underlying spend, not Zino revenue).
- **SAM (Nigeria-origin cadets).**
  - ASSUMPTION: Nigeria = 20% of African new-pilot demand → about 230 cadets/yr → about US$12.7M/yr tuition spend.
  - Add simulator, ground school, medicals, mentorship and type-rating preparation. ASSUMPTION: US$3,000 of ancillary spend per cadet → about US$0.7M/yr.
- **SOM (Zino capture in 3 years).**
  - ASSUMPTION: 15% of Nigerian cadets go through Zino → about 35 cadets/yr.
  - ASSUMPTION: Zino retains 10% of tuition as fee or commission, plus US$3,000 of direct services → 35 × (5,500 + 3,000) ≈ **US$0.30M/yr**.
  - Add simulator experiences, institutional programmes and recruitment fees, all UNKNOWN.
  - **Every percentage here must be replaced with actual enrolment and take-rate data from the founder.**
- **Jet (management and brokerage SAM, Nigeria).**
  - ASSUMPTION: 160–240 private aircraft.
  - ASSUMPTION: 5% annual transaction turnover → 8–12 transactions/yr.
  - ASSUMPTION: 1.5% brokerage on a US$10M average aircraft value → US$150k per deal → **SAM ≈ US$1.2–1.8M/yr of acquisition/sales fees**.
  - ASSUMPTION: management-fee SAM = 160–240 aircraft × 30% externally managed × US$200k/yr ≈ US$9.6–14.4M/yr.
  - **SOM = UNKNOWN until first transactions exist.**

## 14. Capital intensity and economics

- **Academy is mostly asset-light.** Flight training, type ratings and medicals are delivered by partners. The exception is the **simulator**: a 737NG device plus premises, maintenance, instructors and power in Lagos. Its acquisition cost, financing and utilisation are UNKNOWN.
- **Jet as described is asset-light** (advisory, brokerage, network). If it moves into management or operations with an AOC, or into owning aircraft, capital intensity, insurance and regulatory burden rise sharply.
- **The JetVault Experience Centre** implies premium premises and display hardware, plus software (the "JetVault digital platform"). Cost and status are UNKNOWN.
- **Unit economics: UNKNOWN.** The founder's documents should provide gross margin by service, CAC by channel, and cohort conversion (webinar → mentorship → enrolment → placement).

## 15. Regulatory and operational risks

1. **Charter representation without an AOC.** In Nigeria, commercial charter must be operated by an NCAA AOC holder, with an Airline Operating Permit for non-scheduled commercial air transport.
   - NCAA describes AOC issuance under Nig.CARs Part 9 after financial and safety certification (https://ncaa.gov.ng/media/news/re-why-the-ncaa-should-ease-the-hurdles-to-air-operator-certificate-aoc).
   - Zino should present itself as a broker/agent and name the operating carrier.
   - **No AOC held by Zino was found. Do not state or imply one.**
2. **Training claims.**
   - Zino is not evidenced as an NCAA-approved ATO (Part 3, https://www.ncaa.gov.ng/media/gywnj2cn/nigcars-part-3-approved-training-organization.pdf).
   - Simulator time is not evidenced as loggable or creditable. Do not describe the simulator as "certified", "Level D" or "creditable" without the FSTD qualification certificate.
   - The site's "certified flight instructors" claim needs evidence of instructor licences.
3. **Consumer and data protection.**
   - The Jet site collects personal data with no live privacy policy or terms.
   - The Nigeria Data Protection Act 2023 and UK GDPR (UK entity) may apply.
   - The Academy publishes a privacy PDF without a legal entity name.
4. **Pricing inconsistencies** on the programme pages (SACAA $45k vs $54k; EASA €62k vs €65k) create misrepresentation risk.
5. **Marketing superlatives** ("world's premier", "world's first and leading", "state-of-the-art", "Nigeria's youngest commercial pilot") are unverified. Keep them out of investor-facing statements, or attribute them.
6. **UK filing compliance.** Accounts for ZINO AVIATION LTD were overdue at the time of research. This is a minor governance flag, but it is diligence-relevant.
7. **Key-person risk.** The brand, mentorship and sales depend on Capt. Zino personally, who is also active in several other ventures.
8. **FX and affordability.** Tuition is priced in USD, EUR and ZAR while customers earn NGN. There is no pilot-loan system (CEO claim).
9. **Third-party delivery risk.** The concierge, interiors, financing and type ratings depend on unnamed partners. Responsibility for service failures needs contracts.

## 16. Roadmap and expansion options (from the company's own statements, plus analyst options)

- **Stated by the company (SELF_REPORTED):**
  - pilot funding with banks, governments and airlines;
  - airline cadet programmes;
  - Africa-wide expansion ("the continent's leading aviation platform", zinomario.com);
  - the JetVault digital platform;
  - the ZinoJet Network;
  - the Knowledge Centre.
- **Analyst options (ASSUMPTION):**
  - qualify the 737NG device and seek NCAA ATO approval for a ground-school or MCC component;
  - wet-lease simulator time to airlines;
  - formal AOC-holder partnerships for charter, published on the site;
  - a recruitment-as-a-service contract with a named airline;
  - financing partnerships for tuition.

## 17. Open questions for founder documents

1. CAC certificate(s), RC number(s), MEMART and shareholder register for each Nigerian entity. Which entity bills Jet and Academy customers? How does ZINO AVIATION LTD (UK) relate to them?
2. Is "Zino Group" a registered holding company? Show the group structure chart.
3. Founding evidence for 2018 (first invoices, registrations).
4. **Simulator.**
   - Who is the manufacturer or provider?
   - Is it owned or leased, and how was it financed?
   - Has it been qualified by NCAA or EASA, and at what FSTD level?
   - What is its installation date and utilisation?
5. Signed agreements with SafeFly Express, TAE Aviation Academy, type-rating providers, AMEs and airlines (recruitment). What are the commission and fee terms?
6. Student and cohort data:
   - enrolments by programme per year;
   - completion rates;
   - verified placements (with consent);
   - the basis of the "8,000+ network" figure.
7. Revenue by service line for the last 3 years; management accounts; UK filed accounts.
8. **Jet.**
   - Any completed charter, acquisition or sale.
   - The operating carriers / AOC holders used.
   - Escrow and client-money handling.
   - Insurance.
   - The status of the JetVault Experience Centre and platform.
9. Trademark filings for "The Journey Concierge", "JetVault" and "ZinoJet".
10. The founder's licence documents (EASA/FAA/ICAO/NCAA) if the licence claims are to be used in investor materials.
11. Data-protection compliance (NDPA registration / DPO) and when the Jet privacy policy and terms will be published.
12. Staff headcount (Fuzu says 20–50, self-described) and key hires.

## Brand

See `brand.md` and `brand.json` (gold `#B59B48` on charcoal `#222222`; Poppins + GT Alpina on Jet; Wix palette on Academy).

## Sources (fetched 2026-10-18)

- https://zinoaviation.com/ (gateway)
- https://jet.zinoaviation.com/ and its pages charter.html, aircraft-acquisition.html, journey-concierge.html, contact.html and coming-soon.html; stylesheet css/style.css
- https://academy.zinoaviation.com/ and its pages /start-flying, /simulator, /pilotjob, /sacaa, /easa, /type, /logistics, /medicals, /mentorship, /masterclass, /call, /contact-us, /careers, /blog; privacy-policy PDF `/_files/ugd/ad758c_72fb86ababe2444ba6df26d61c65c7d2.pdf`
- https://www.zinomario.com/
- https://find-and-update.company-information.service.gov.uk/company/13100002 (overview and officers)
- https://nairametrics.com/2026/07/19/zino-aviation-ceo-why-many-licensed-nigerian-pilots-remain-unemployed/
- https://www.thisdaylive.com/2022/09/09/zino-aviation-takes-off-with-pilot-masterclass/
- https://guardian.ng/business-services/aviation-business/zino-aviation-safefly-partner-on-capacity-building/ (403; search snippet only)
- https://www.fuzu.com/nigeria/company/zino-aviation
- https://www.fdncapitalpartners.com/team/
- Market and regulatory sources are cited inline above.
