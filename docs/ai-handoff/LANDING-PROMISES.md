# Landing page promises - CapitalQ (FDN Capital Partners)

- URL (exact): https://www.fdncapitalpartners.com/capitalq.html
- Retrieved: 2026-10-11T13:11:15Z (Playwright, Chromium); HTTP status 200 (desktop and mobile; no redirect). WebFetch also succeeded (summary only).
- Screenshots: `../product-sources/landing-capture-2026-10-11/desktop-1440.jpg` (full page, 1440px), `../product-sources/landing-capture-2026-10-11/mobile-390.jpg` (full page, 390px)
- Text: `../product-sources/landing-capture-2026-10-11/desktop-1440.innertext.txt`, `../product-sources/landing-capture-2026-10-11/mobile-390.innertext.txt` (after expanding all `details` and `[aria-expanded=false]`: 8 elements each; the six Journey cards show "Read Less" i.e. expanded). Tab panels of "Features" in `../product-sources/landing-capture-2026-10-11/features-all-panels.txt`.
- HTML: `../product-sources/landing-capture-2026-10-11/page.raw.html` (server response), `../product-sources/landing-capture-2026-10-11/desktop-1440.rendered.html`, `../product-sources/landing-capture-2026-10-11/mobile-390.rendered.html`.
- Capture notes: the page has no FAQ section. The hero mock card is animated, so values differ by capture time (desktop 92% / 84 / $2.5M / +180% / 14 months; mobile mid-animation 6% / 5 / $0.2M / +12% / 1); treat the final values as illustrative sample data. Mobile hides the desktop top-nav links and the 04.2-04.9 feature-tab list (panel text is still in the DOM). No other mobile-only copy found. Page content is marketing copy; not verified as product fact.
- Nav/footer links: Who We Serve (for-businesses.html, investors.html), CapitalQ, Knowledge Centre, Team, Talent Capital, Africa to Arabia, Get in Touch (contact.html); waitlist.html; contact.html?topic=capitalq.

Acceptance criteria are tests against the intended product, not claims that the product does this today.

## Hero

- LP-01 "Discovering the right investment opportunity shouldn't take months. It should take minutes." (Hero; repeated before Before-the-First-Meeting)
  - A new investor with a saved thesis sees a ranked, personalised set of opportunities within minutes of onboarding.
  - No document upload or questionnaire is needed from the investor before first value.
- LP-02 "Think TikTok for investment discovery + Jarvis from Iron Man. All built for the entire investment journey." (Hero; repeated in Better Way)
  - Discovery is a vertical/swipeable short-video feed plus a conversational voice-capable Q.
  - The same surface leads from discovery through to introduction request.
- LP-03 "The opportunities that fit your thesis come to you. Q helps you understand, evaluate and act on them." (Hero)
  - Feed is driven by the investor's declared thesis.
  - Each opportunity offers Understand (snapshot), Evaluate (Q Q&A, scores) and Act (save / interest / intro) actions.
- LP-04 CTAs "Join the Waitlist" (to waitlist.html), "Book a Demo" (contact.html?topic=capitalq) (Hero, footer repeats Join the Waitlist; footer "Subscribe for Updates")
  - Both CTAs resolve and capture an email/contact; waitlist submission is stored.
  - Mobile: CTAs reachable without horizontal scroll, touch targets 44px+.

## The Old Way

- LP-05 "The problem isn't a lack of opportunities. It's finding the right ones." (Old Way)
  - Product outcome metric: time to find a relevant opportunity is lower than warm-intro / inbound-deck baseline.
- LP-06 "Every business presents itself differently... Every new investment means starting from scratch." (Old Way)
  - All businesses render in one standardised structure.
- LP-07 "Too much time searching. Too much time screening. Too many opportunities missed. And too little time spent investing." (Old Way)
  - Search and screening are replaced by feed plus snapshot; no manual list-building is required.

## The Better Way (Discover / Understand / Interrogate / Go deeper)

- LP-08 "Search. Don't Wait. CapitalQ turns investment discovery into an intelligent, personalised experience." (Better Way)
  - Investor can search on demand and also receive pushed matches.
- LP-09 "01 DISCOVER - Swipe through elevator pitches and investment opportunities personalised to your investment thesis, or search for exactly what you want."
  - Swipe feed of short pitch videos, personalised from thesis; free-text/structured search is available.
  - Save/Pass on swipe is instant.
- LP-10 "02 UNDERSTAND - Every business, standardized and comparable, with the information that matters in one place."
  - Every company profile uses the same fields; any two can be compared side by side.
- LP-11 "03 INTERROGATE - Talk to Q, your AI investment analyst just like Jarvis from Iron Man. Ask questions and get intelligent audible answers. Analyse opportunities, and interview founders before you meet them."
  - Q accepts spoken questions and returns spoken (audio) answers.
  - Answers about a company are grounded in that company's evidence and cited.
  - Investor can ask Q about a company without engaging the founder.
- LP-12 "04 GO DEEPER - Access financials, traction, Investability IQ, Thesis Match and the Smart Data Room when you're ready."
  - Deeper layers are progressively disclosed, gated by company sharing permissions.
- LP-13 "Discover earlier. Understand faster. Invest smarter." (Better Way)
  - Three-stage flow is visible in navigation: discover, understand, decide.

## The Journey (six cards, expandable "Read Less")

- LP-14 "CapitalQ brings investors and businesses into one intelligent investment experience... with Q intelligently connecting both sides throughout."
  - One platform with investor and founder roles on the same company record.
- LP-15 "01 Q LEARNS - Q learns each investor's thesis and conversationally onboards businesses to understand their traction, financials, team, raise and investment story."
  - Investor thesis capture and founder conversational onboarding both exist.
  - Founder onboarding covers traction, financials, team, raise, story without a long form.
- LP-16 "02 ASSESS & IMPROVE - Q scores each business across key investment-readiness factors, identifies what may prevent it from raising and shows the founder what to improve next."
  - Founder sees readiness assessment by factor, blockers and prioritised improvements.
  - Insufficient evidence lowers confidence, not the score (per PADL).
- LP-17 "03 DISCOVER - CapitalQ's algorithm brings investors the opportunities most aligned with their preferences, while making businesses visible to the investors most likely to back them."
  - Bilateral discovery: investors get ranked companies; founders get matched investors.
  - Ranking is explainable; no pay-to-rank.
- LP-18 "04 QUALIFY - Investors set the criteria businesses must meet before contacting them. When a business matches an investor's gateway, the founder can connect with an investor actively looking for an opportunity like theirs."
  - Investor can set criteria and a minimum gateway score (GateQ).
  - A non-qualifying business cannot contact the investor; a qualifying one can see and approach them.
- LP-19 "05 UNDERSTAND - Every opportunity follows the same standardised structure... Ask Q questions, explore the numbers and challenge assumptions using the information gathered directly from founders during Q's conversational onboarding interview. It is the interview before the interview."
  - Q answers from the founder's onboarding answers and states when information is missing.
- LP-20 "06 CONNECT - The investor understands the opportunity. The founder understands the fit. The first meeting begins with alignment, not discovery."
  - Introduction request carries the match rationale to both sides.

## One Place / standard structure

- LP-21 "Everything You Need. All in One Place. Every opportunity on CapitalQ follows the same standardized structure... easier to discover, evaluate, compare."
  - Profile has one canonical structure and no need to open email or separate documents for basics.
- LP-22 Mock card: INVESTMENT READY, Thesis Match, Investability IQ (/100), Capital Raising, Revenue Growth YoY, Funding Stage, Sector, Region, Monthly Burn ("14 months runway"), Status, Last Updated ("3 days ago").
  - Snapshot shows these fields, each with source/freshness; unknown shown as unknown, not zero.
  - Match and readiness are shown as separate values (not merged).
  - Note: the mock labels "Monthly Burn" with "14 months runway" (label/value mismatch in the source copy).
- LP-23 "Every Opportunity. The Same Structure. Every Time. So every investment decision starts with clarity, not complexity."
  - Structure is identical across all companies.

## Features (tabs 04.1-04.9)

- LP-24 04.1 Investment Snapshot - "See the essentials of an opportunity quickly." + "Compare Opportunities Side by Side... using the same standardized structure"
  - Investor can select 2+ companies and see a side-by-side comparison.
- LP-25 04.2 Investability IQ - "FDN's proprietary assessment framework, evaluating governance, financial readiness, commercial traction, founder strength, legal preparedness, and more before you spend valuable time on due diligence."
  - Assessment dimensions listed are all represented (compare with PADL seven dimensions).
  - Each score explains its reasons, evidence and confidence.
- LP-26 04.3 Investment Thesis Match - "Every opportunity is intelligently matched against your investment thesis... Know your fit before your first conversation."
  - Each feed item shows fit to the thesis with reasons (explicit mandate fields).
- LP-27 04.4 Q / AI Investment Associate - "Simply talk. CapitalQ listens... Ask questions, compare businesses, explore opportunities, understand risks, receive instant investment insights, or discover companies that match your investment thesis, all by simply speaking."
  - Voice in and out; supports compare, risk, discovery queries in one Q.
  - "For founders, the same conversational experience powers onboarding, replacing lengthy forms... and Investor Briefing" - founder onboarding is conversational and produces profile plus briefing.
- LP-28 04.5 Investor Briefing - "pitch, founder videos, business model, traction, financials, team, market, insights... Every Investor Briefing includes: Founder Story & Journey; AI Investment Summary; Tailored Due Diligence Q&A; Investment Thesis Match; Investability IQ; Financial Highlights; Key Risks & Red Flags; Suggested Due Diligence Questions."
  - Briefing page contains all eight listed sections.
  - Risks/red flags are evidence-based, with unknowns flagged rather than penalised.
- LP-29 "By the time you request an introduction, you've already answered most of the questions you'd normally ask."
  - Briefing is available before introduction request.
- LP-30 04.6 AI Intelligent Interview - "The interview before the interview. AI identifies what's missing, asks deeper questions, and adapts based on the founder's answers."
  - Interview detects missing information and asks adaptive follow-ups.
- LP-31 04.7 Smart Data Room - "investment decks, financial models, legal documents, supporting information, and due diligence materials from one secure, structured location. Everything organised. Everything searchable."
  - Permissioned, searchable data room; access is revocable and per-organisation.
  - Q knowledge is not disclosure of room contents beyond permission (PADL).
- LP-32 04.8 Intelligent Discovery / Investment Radar (for Investors) - "continuously surfaces and prioritises the businesses most relevant... as CapitalQ learns your investment thesis, preferences, and behaviour."
  - Feed re-ranks over time; declared mandate is never silently rewritten by behaviour (PADL).
- LP-33 04.9 Matching & Intelligence Reports / Investor Matching (for Businesses) - "Once your business is investment-ready, Investor Matching identifies investors whose investment thesis aligns... launch a targeted investor campaign through FDN... Introduced only to qualified investors who match your stage, sector, geography, cheque size, and investment thesis. Track every introduction, monitor campaign progress."
  - Founder sees matched investors with reasons, and an introduction tracker with status.
  - Introductions only go to investors whose hard criteria the business meets.
  - Understand "not just that an opportunity matches, but why" - match report shows alignment, highlights, areas to investigate.

## Before the First Meeting

- LP-34 Investor checklist: "You've watched the founder tell their story... explored the Investment Snapshot... reviewed financials and traction... seen thesis alignment... assessed Investability IQ... received AI-powered investment insights... explored due diligence questions through the Investor Briefing... conducted the interview before the interview."
  - The eight investor steps can be completed in one session on a single company record.
- LP-35 Founder checklist: "completed a conversational onboarding interview... transformed your information into a clear, standardised Investment Snapshot and investment story... assessed your Investability IQ and identified what could prevent investors from saying yes... received a personalised improvement report and been directed to the right partners where additional support is needed... appearing in personalised feeds... see which investor gateways you qualify for and directly approach investors whose criteria you meet... Investors are already exploring your opportunity and questioning Q before meeting you."
  - Founder sees gateway qualification list and can approach qualifying investors.
  - Improvement report links to partner/support referrals.
  - Founder is told when investors explore (relationship signals, not surveillance per PADL #128).
- LP-36 "The meeting isn't about discovering the opportunity anymore. It's about validating the opportunity and deciding what comes next."
  - Meeting prep summarises what is already known and what remains to validate.

## "With CapitalQ, you can" (8 items)

- LP-37 01 "Search, not wait. Find businesses that match your investment thesis on demand."
  - Thesis-driven search returns results on demand.
- LP-38 02 "Scroll through opportunities like a personalised investment feed. Discover short elevator pitches... swipe through the opportunities that interest you."
  - Short pitch video feed with swipe; cursor-paginated, no Q in swipe path.
- LP-39 03 "Let the algorithm find what fits. CapitalQ learns your thesis and continuously brings the most relevant businesses to the front of your feed."
  - Ranking is deterministic and explainable; fit explanation visible.
- LP-40 04 "Review hundreds of opportunities in a fraction of the time. Standardised profiles make businesses easier to understand, evaluate and compare."
  - A reviewer can triage many items quickly using snapshot cards.
- LP-41 05 "See the complete picture before the first meeting. Explore pitch videos, investment decks, traction, financial information and key business insights in one place."
  - Video, deck, traction, financials, insights reachable from one company page, subject to permissions.
- LP-42 06 "Interview the business before meeting the founder. Ask Q questions, explore the numbers and challenge assumptions using answers gathered during the founder's detailed onboarding interview."
  - Q answers cite the founder's interview answers.
- LP-43 07 "Control who can approach you. Set your investment criteria and minimum gateway score so only qualifying businesses can contact you."
  - Criteria and minimum score are enforced server-side; non-qualifying contact is blocked.
- LP-44 08 "Build a smarter investment pipeline. Save, shortlist, compare and revisit opportunities, then request introductions when you are ready to move forward."
  - Save, shortlist, compare, revisit and request-introduction actions all exist; interest is server-confirmed.

## Closing / footer

- LP-45 "Ready to Experience CapitalQ? The Future of Investment Discovery Starts Today. ... a smarter, faster, and more intelligent way to connect, evaluate, and achieve your goals. Ready to see CapitalQ in action?" (CTA: Join the Waitlist)
  - Waitlist CTA works from this section.
- LP-46 Footer: "Capital. Intelligence. Opportunity."; contact team@fdncapitalpartners.com, +234 806 848 9639, Lagos, Nigeria and Dubai, UAE; "Never Miss an Update ... latest insights, research, product updates, webinars, and news" + email form "Subscribe for Updates".
  - Subscribe form stores email and confirms; contact details correct.
- LP-47 Branding claims: trademark marks (TM) on CapitalQ, Investment Snapshot, Investability IQ, Investment Thesis Match, Investor Briefing, Investment Radar, Investor Matching; "AI Investment Associate".
  - Product UI uses these exact feature names, or a naming decision is recorded (PADL uses "InvestIQ"; page uses "Investability IQ"; GateQ doc uses "Q Score").
