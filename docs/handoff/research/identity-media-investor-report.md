# Research brief for Capital Q: identity pages, brand kits, image generation, investor research, trust and safety, agent parity, messaging

Research date: 2026-09-25. I made no changes to the repo. Some prices come from third-party aggregators rather than the vendor's own page; those are marked **(secondary)** and should be re-checked before anyone budgets on them.

---

## 1. Digital business cards and identity pages

**What the market looks like**
- **Read.cv** was acquired by Perplexity. It began winding down on 17 Jan 2025 and fully shut on 16 May 2025. Users could export their data, and `.cv` sites moved to Hello.cv. https://www.neowin.net/news/readcv-announces-acquisition-by-perplexity-as-it-begins-winding-down-operations/ · https://theaiinsider.tech/2025/01/24/ai-search-engine-perplexity-acquires-read-cv-in-strategic-expansion/
- **Bento.me** was bought by Linktree in 2023 and shut on 13 Feb 2026. Its links now redirect to Linktree. Linktree did the same with Koji in Jan 2024. https://alternativeto.net/news/2025/12/bento-to-shut-down-in-2026-as-linktree-takes-over-and-offers-migration-path/
  - The lesson for Capital Q: profile URLs outlive products. Own the domain and keep redirects.
- **Popl, Blinq and HiHello:**
  - Blinq Business costs about $4.99 per user per month, with a minimum of 5 cards. HiHello is free for individuals and $5–6 per month for teams. Popl is strongest for event lead capture.
  - All three sync to Salesforce, HubSpot, Dynamics, Pipedrive and Zoho. They share by QR, link, NFC and widgets, and let you set brand fonts and colours.
  - https://blinq.me/blog/comparing-costs-of-digital-business-card-platforms · https://blinq.me/blog/top-digital-business-cards-compared (vendor-authored comparison)
- **Contra:** free portfolio and commission-free work. The Pro plan adds a custom domain, branding and analytics. https://contra.com/how-it-works/independents
- **Carrd:** Pro Standard at $19/yr adds a custom domain, forms and analytics. Pro Lite at $9 does not. https://carrd.com/docs/pro/plans
- **LinkedIn:** every member has a profile QR code in the mobile app. https://www.linkedin.com/help/linkedin/answer/a525286/using-a-linkedin-qr-code-to-connect-with-members
- **Apple NameDrop (iOS 17+ / watchOS 10):** two devices held together exchange a name, a chosen phone number or email, and the Contact Poster. The other person can pick "Receive Only". It shares nothing else, such as address or birthday. https://www.macrumors.com/how-to/ios-share-contact-details-with-namedrop/ · https://support.apple.com/guide/personal-safety/secure-namedrop-ips97e16d3b1/web
  - Web apps cannot trigger NameDrop. The nearest a web page can get is a `.vcf` download, or "Add to Wallet" (below).

**Features that matter, with the technical specifics**
- **vCard:** RFC 6350 (v4.0) embeds photos as `data:` URIs. v3.0 (RFC 2426) uses `ENCODING=b;TYPE=JPEG`. Device support for 4.0 is uneven, so **serve 3.0 for compatibility**. https://datatracker.ietf.org/doc/html/rfc6350 · https://alessandrorossini.org/the-sad-story-of-the-vcard-format-and-its-lack-of-interoperability/ · https://en.wikipedia.org/wiki/VCard
- **Dynamic QR:** encode a short redirect URL on your own domain (under about 30 characters, so the code stays small and scannable) and change the target on the server. The redirect hop is also where scan analytics get captured. https://en.wikipedia.org/wiki/Dynamic_QR_code · https://missinglinkz.io/blog/utm-qr-code-tracking-developer/
- **NFC:** NTAG215 has 504 bytes and holds an NDEF URL of about 480 characters. Write a short HTTPS redirect onto rewritable tags, never a static vCard. https://www.wakdev.com/en/knowledge-base/nfc-chips/nxp-ntag215.html · https://shopnfc.com/en/content/41-how-to-encode-a-digital-business-card-on-an-nfc-tag
- **Apple Wallet `.pkpass`:**
  - Signing needs a Pass Type ID certificate plus Apple's WWDR certificate, from the paid Apple Developer Program ($99/yr). https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates/ · https://developer.apple.com/programs/
  - Updates work like this: the pass carries a `webServiceURL` and an `authenticationToken` of at least 16 characters. Wallet registers the device. You send an empty APNs push, and Wallet then pulls the re-signed pass. The same certificate signs passes and sends pushes. Everything can change except the `passTypeIdentifier` and `serialNumber`. https://developer.apple.com/documentation/WalletPasses/adding-a-web-service-to-update-passes · https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html
- **Google Wallet Generic pass:**
  - Links take the form `https://pay.google.com/gp/v/save/<signed JWT>`. The JWT is signed with service-account credentials registered in the Wallet Business Console.
  - A new Issuer account starts in **Demo Mode**, where passes reach only admins, developers and listed test accounts. Going live requires a publishing-access review.
  - https://developers.google.com/wallet/generic/getting-started/issuer-onboarding · https://developers.google.com/pay-wallet/products/wallet/generic/test-and-go-live/request-publishing-access · https://codelabs.developers.google.com/add-to-wallet-web
- **Open Graph images:** use `next/og` `ImageResponse` through an `opengraph-image.tsx` file per route segment. Only ttf, otf and woff fonts work, and you must load and pass the font bytes yourself. https://nextjs.org/docs/app/api-reference/functions/image-response · https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
- **Indexing:**
  - Google recommends `noindex` for untrusted user-profile areas, and `nofollow`/`ugc` on user links. Profile pages are a common target for spam. https://developers.google.com/search/docs/monitor-debug/prevent-abuse
  - `X-Robots-Tag` covers non-HTML assets such as PDFs and vCards. https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- **Structured data:** a `ProfilePage` with `mainEntity` set to a Person or Organization, in JSON-LD. https://developers.google.com/search/docs/appearance/structured-data/profile-page · https://schema.org/ProfilePage

**Handle, squatting and impersonation policies**
- **GitHub:**
  - The old name redirects until someone else claims it. Once claimed, the redirect for a same-named repo breaks.
  - Popular namespaces are **permanently retired**: more than 100 clones or Actions uses in the week before the rename, or container images with more than 5,000 downloads.
  - Name squatting is prohibited.
  - https://docs.github.com/en/account-and-profile/concepts/username-changes
- **Instagram:** the old username is held for 14 days, during which the owner can revert. Usernames can change once every 14 days. https://wersm.com/instagram-will-start-locking-old-usernames-for-14-days/
- **Linktree:**
  - Squatting and impersonation are prohibited.
  - Usernames can be reclaimed after an IP report, with a counter-notice process.
  - An account with no login, no edits and no traffic for 6 months may be reassigned.
  - https://linktr.ee/s/terms · https://linktr.ee/s/about/ip-takedowns
- **X:**
  - Parody, commentary and fan accounts must put "parody", "fake", "fan" or "commentary" at the start of the name, and are not eligible for the badge.
  - A paid badge does not signal authenticity, which is a cautionary example for Capital Q.
  - https://help.twitter.com/en/rules-and-policies/x-impersonation-and-deceptive-identities-policy · https://www.socialmediatoday.com/news/x-formerly-twitter-launches-parody-account-labels/737124/

**Privacy notes**
- Public profiles get scraped. Default to `noindex`, rate-limit profile and vCard routes, and never put email or phone in the HTML unless the owner opts in.
- Keep scan analytics first-party, with no third-party pixels. That matches the product's "no engagement optimisation" rule.

---

## 2. Brand kits in AI tools, and document export

- **Canva:**
  - The Brand Kit holds logos, colours, fonts, graphics, photos, **brand voice** and guidelines.
  - The Brand Kit Builder fills it automatically **from a website or PDF**.
  - The Connect API exposes brand-template publishing, metadata and autofill datasets.
  - https://www.canva.com/help/brand-kit-builder/ · https://www.canva.com/help/brand-kit/ · https://www.canva.dev/docs/connect/api-reference/brand-templates/
- **Gamma:**
  - The Generate API has been GA since Nov 2025 and takes input up to about 100k tokens.
  - It supports themes, image options and **PPTX/PDF export**.
  - Base URL `public-api.gamma.app/v1.0`, key sent in an `X-API-KEY` header.
  - Paid plans apply brand colours, logos and fonts.
  - https://developers.gamma.app/ · https://gamma.app/integrations/gamma-api · https://help.gamma.app/en/articles/8022861-what-s-the-easiest-way-to-export-my-gamma
- **Pitch:** slide styles hold brand colours and uploaded ttf/otf fonts, plus an asset library. Exports to PPTX and PDF. Free-plan exports carry Pitch branding. https://help.pitch.com/en/articles/6713988-export-a-presentation-to-power-point · https://help.pitch.com/en/articles/4057308-upload-custom-fonts · https://help.pitch.com/en/articles/4508816-pitch-branding-for-exported-presentations-and-links
- **Beautiful.ai:** the Brand Kit (logos and colours) is on the Team and Enterprise plans. "Smart Slides" reflow layouts automatically. Exports to PPTX and PDF. https://support.beautiful.ai/hc/en-us/sections/25701365958413-Importing-and-exporting
- **Tome:**
  - Announced its pivot in Oct 2024 and shut the slides product on 30 Apr 2025.
  - It **never had native PPTX export**, and decks that weren't exported were deleted.
  - The team moved on to Lightfield, an AI CRM.
  - Lesson: always give users a portable export.
  - https://deckary.com/blog/tome-review · https://autoppt.com/blog/tome-app-pivot-away-from-presentations/
- **The shared pattern:** a brand kit is structured data with the following fields.
  - logo variants
  - a palette with roles (primary, accent, neutrals)
  - type pairs (heading and body)
  - tone of voice
  - It gets captured by *extraction from a website or PDF, followed by user confirmation*. That fits the "upload what you already have, Q works first" onboarding.

**Generating documents server-side in Node**
- **pptxgenjs** produces real OOXML (text, tables, shapes, images, **native editable charts**). It runs in Node, the browser and serverless. https://gitbrent.github.io/PptxGenJS/ · https://www.npmjs.com/package/pptxgenjs
- **pptx-automizer** fills existing `.pptx` templates, which suits brand templates. https://www.npmjs.com/package/pptx-automizer
- **Chromium print-to-PDF (Playwright):** supports `tagged: true` (accessible, tagged PDF) and `outline: true` (bookmarks). These map to Chromium's `generateTaggedPDF` and `generateDocumentOutline`. Puppeteer now tags by default. Of the options here, this gives the highest layout fidelity, since it prints the same HTML and CSS the app uses. https://blog.chromium.org/2020/07/using-chrome-to-generate-more.html · https://github.com/puppeteer/puppeteer/commit/4fc14026e9bfffeedf317e9b61c7cda8509091ba · https://github.com/gotenberg/gotenberg/issues/1043
- **@react-pdf/renderer and pdfkit:** fast and need no browser, but have their own layout engine rather than CSS parity. PDFKit's `tagged: true` has reportedly failed Acrobat's accessibility check. https://github.com/foliojs/pdfkit/issues/1260 · https://react-pdf.org/advanced
- **Hosting Chromium:**
  - `@sparticuz/chromium` fits in serverless. `chromium-min` downloads the binary at runtime. https://github.com/Sparticuz/chromium
  - Vercel now allows **functions up to 5 GB** on Fluid compute (public beta, changelog 29 Jun 2026; opt in with `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`). https://vercel.com/changelog/vercel-functions-can-now-be-up-to-5-gb-in-package-size
  - Recommendation: for Capital Q, a **worker** (apps/workers on Railway) running full Playwright avoids cold starts and bundle limits, and keeps long jobs out of the web tier.

---

## 3. Image generation and editing APIs (as of Sep 2026)

**OpenAI**
- **Models:**
  - gpt-image-1, gpt-image-1-mini, gpt-image-1.5 and gpt-image-2 exist.
  - OpenAI's data-controls page also lists `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` (snapshots dated 2026-09-08).
  - All of them are **Zero Data Retention-compatible**. Without ZDR, `/v1/images/generations` and `/v1/images/edits` keep **30-day abuse-monitoring** logs. Images flagged as possible CSAM are retained for manual review even under ZDR.
  - https://developers.openai.com/api/docs/guides/your-data
- **Provenance:** outputs carry a C2PA manifest and a SynthID watermark. There is a verification API (`POST /v1/content_provenance_checks`) and a web tool at openai.com/verify. https://developers.openai.com/api/docs/guides/content-provenance · https://help.openai.com/en/articles/8912793-c2pa-in-chatgpt-images
- **Pricing (secondary):**
  - gpt-image-1.5 at 1024²: about $0.009 (low), $0.034 (medium), $0.133 (high).
  - gpt-image-2 at 1024²: about $0.006, $0.053, $0.211. Token rates: $8/M image-input tokens, $30/M image-output tokens.
  - Sources disagree on gpt-image-2's release date (April vs 24 June 2026).
  - https://pricepertoken.com/gpt-image-pricing · https://costgoat.com/pricing/openai-images · https://openrouter.ai/openai/gpt-image-2 · https://developers.openai.com/api/docs/models/gpt-image-1.5
- **Policy:**
  - No use of someone's likeness without consent where it could confuse people about authenticity.
  - Avoid infringing trademarks or logos.
  - Public figures can opt out.
  - https://openai.com/policies/usage-policies/ · https://musically.com/2025/03/26/public-figures-must-opt-out-of-openais-new-image-generator/

**Google (Gemini API)**
- **Current image models:** Gemini 3.1 Flash Image ("Nano Banana 2", $0.045–0.151 depending on 0.5K–4K), Gemini 3.1 Flash Lite Image ($0.0336 per 1K), and Gemini 3 Pro Image ("Nano Banana Pro", $0.134 at 1K/2K, $0.24 at 4K). Gemini 2.5 Flash Image is **deprecated**.
- **Data policy:** on the **free tier, content is used to improve Google's products**. The paid tier does not. So free keys must never see private data. https://ai.google.dev/gemini-api/docs/pricing
- **Imagen 4:** Fast $0.02, Standard $0.04, Ultra $0.06 (secondary). It always carries SynthID and cannot be turned off. https://developers.googleblog.com/imagen-4-now-available-in-the-gemini-api-and-google-ai-studio/ · https://magichour.ai/blog/imagen-4-pricing-and-api
- Nano Banana Pro launched on 20 Nov 2025. https://techcrunch.com/2025/11/20/google-releases-nano-banana-pro-its-latest-image-generation-model/

**Specialists**
- **Black Forest Labs FLUX:** Kontext Pro $0.04, Kontext Max $0.08. FLUX.2 is priced per megapixel, with [klein] from $0.014. 1 credit = $0.01. https://bfl.ai/pricing · https://docs.bfl.ai/quick_start/pricing
- **Ideogram 3.0** (best-in-class text in images): Turbo $0.0375, Default $0.075, Quality $0.1125 (secondary). https://ideogram.ai/pricing · https://apiframe.ai/guides/ideogram-api-guide
- **Recraft V4** produces **true SVG**, with style or brand consistency. Vector output costs about $0.05 per image plus $0.005 for style creation. Pro Vector costs $0.12. https://www.recraft.ai/api · https://openrouter.ai/recraft/recraft-v4-styles-vector

**Which tool for which job**
- **Deck backgrounds and illustrative visuals:** gpt-image or Nano Banana (edits, keeping style consistent).
- **Text-heavy graphics:** Ideogram.
- **Logo variations and icon sets:** Recraft (SVG), starting from the user's real logo.
- **Charts:** never generate them with an image model. Render from data with pptxgenjs native charts, or SVG or a chart library, so the numbers stay traceable to evidence.
- **Real people and real company logos:** do not synthesise them. Use uploaded assets.

**Provenance law**
- The EU AI Act Art. 50 transparency duties apply from **2 Aug 2026**.
  - Providers must mark output in a machine-readable, detectable way.
  - Deployers must label deepfakes and AI text on matters of public interest.
  - https://artificialintelligenceact.eu/article/50/ · https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act
- The Commission confirmed the Transparency Code of Practice as adequate (Jul 2026).
  - The Code requires **both signed metadata and imperceptible watermarking**.
  - Systems already on the market get until **2 Dec 2026** (AI Omnibus).
  - Translation counts as standard editing, but summaries and substantive rewrites need marking.
  - Fines go up to €15M or 3%.
  - https://www.faegredrinker.com/en/insights/publications/2026/7/eu-ai-act-commission-confirms-transparency-code-of-practice-as-adequate-and-publishes-final-version-of-its-guidelines-on-transparency-obligations · https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content
- **Practical rule:** keep the C2PA metadata the providers emit. Don't strip it when resizing through Cloudflare Images. Show an "AI-generated" label on generated visuals.

---

## 4. Research-first investor onboarding

**Commercial data sources**
- **Crunchbase:**
  - No free API tier in 2026 (secondary). Full API access needs an Enterprise or Applications licence.
  - The licence **forbids redistributing raw data to third parties**. Only analysis and aggregate statistics may be shared.
  - Data must be expunged within 10 days of termination.
  - Attribution must read "Powered by Crunchbase" with a visible, followed link.
  - https://data.crunchbase.com/docs/license-agreement · https://dev.to/agenthustler/crunchbase-api-in-2026-free-tier-gone-what-startup-data-hunters-do-now-1177
  - For Capital Q, that makes it a poor fit for showing third-party profiles to users.
- **PitchBook:** a REST API exists only through a separately contracted "Direct Data" product. No self-serve access and no public pricing. https://pitchbook.com/products/direct-access-data/api · https://pitchbook.com/help/PitchBook-api
- **Dealroom:** REST API, hosted MCP server and bulk feeds, covering 3M+ companies and 100K+ investors. Priced through sales. https://dealroom.co/products/dealroom-api/ · https://developers.beta.dealroom.co/
- **Harmonic:** REST and GraphQL, 30M+ companies and 190M+ people. https://harmonic.ai/ · https://console.harmonic.ai/docs/api-reference/financing
- **Specter:** REST API with access by approval only. Enrichment is charged per matched result, so misses are free. https://www.tryspecter.com/api · https://api.tryspecter.com/api-ref/introduction
- **Tracxn:** the API and data-dump packs are add-ons to Premium. Plans reportedly start around $550/mo (secondary). https://tracxn.com/pricing
- **CB Insights:** API through an enterprise account. https://api-docs.cbinsights.com/
- **OpenVC** (about 16k investors, free) and **Signal by NFX** (100k+ users): I found no official APIs. The Apify scrapers for them would breach their terms, so don't use them. https://www.openvc.app/investor-database

**Free public-record sources (the best fit for "evidence before opinion")**
- **SEC EDGAR:**
  - `data.sec.gov/submissions/CIK##########.json`, with the CIK zero-padded to 10 digits.
  - Fair access: **10 requests per second** across all SEC hosts, and a **declared User-Agent** in the form "Company admin@email". Breaking either gets a 403 or 429 and a temporary IP block.
  - https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data · https://tldrfiling.com/blog/sec-edgar-api-rate-limits-best-practices
- **Form D data sets:** published quarterly and flattened from the XML. OFFERING rows give offering amounts, and RELATEDPERSONS rows give executives, directors and promoters. https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets · https://www.sec.gov/files/Form_D.pdf
- **Form ADV / IAPD:**
  - Most VC firms file as **Exempt Reporting Advisers** and complete only Items 1, 2, 3, 6, 7, 10 and 11.
  - The SEC publishes monthly rosters of RIAs and ERAs.
  - https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers · https://adviserinfo.sec.gov/ · https://www.angellist.com/learn/form-adv
- **UK Companies House:**
  - Free, and commercial use is allowed. **600 requests per 5 minutes** across all endpoints combined.
  - Endpoints for officers, PSC (persons with significant control) and filing history.
  - Since the ECCTA reforms, officer and PSC records carry `identity_verification_details`, including `identity_verified_on`. That is a useful KYB signal.
  - https://developer-specs.company-information.service.gov.uk/guides/rateLimiting · https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference/officers/list · https://forum.companieshouse.gov.uk/t/more-information-on-the-new-elements-in-the-officers-and-psc-apis/12142
- Mandatory Companies House identity verification for directors and PSCs started 18 Nov 2025, with a 12-month transition. https://www.hilldickinson.com/our-view/articles/mandatory-identity-verification-for-directors-llp-members-and-pscs-from-18-november-2025/

**LinkedIn: avoid**
- **hiQ v. LinkedIn:** the Nov 2022 ruling found LinkedIn's anti-scraping and fake-profile terms **enforceable in contract**. The case ended in a consent judgment: $500k against hiQ plus a permanent injunction. https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/ · https://www.proskauer.com/blog/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case
- **Proxycurl (Nubela):**
  - LinkedIn sued in Jan 2025 over fake accounts and scraping.
  - The service shut on 4 Jul 2025 and judgment followed on 25 Jul. It had to delete all LinkedIn data.
  - https://nubela.co/blog/goodbye-proxycurl/ · https://linkedapi.io/guides/proxycurl-alternatives
- **Use instead:** LinkedIn sign-in (OIDC) for self-declared identity, and let users paste their own URL as a *declared* link.

**Web research APIs for agents**
- **Exa:** $7 per 1k searches (10 results included), $1 per 1k pages of contents, $12–15 per 1k for research calls. https://exa.ai/pricing · https://exa.ai/docs/reference/pricing
- **Tavily:** basic search is 1 credit, advanced is 2. Pay-as-you-go $0.008 per credit. 1,000 free credits. https://docs.tavily.com/documentation/api-credits
- **Firecrawl:** Free 1k credits, Hobby $19, Standard $99. 1 credit per scraped page, 2 credits per 10 search results. https://www.firecrawl.dev/pricing · https://docs.firecrawl.dev/billing
- **Parallel:** Search costs $1 per 1k (Fast) to $5 per 1k (Basic/Advanced). The Task API costs $5 to $2,400 per 1k runs by tier. https://docs.parallel.ai/getting-started/pricing
- **Perplexity Sonar:** $5–12 per 1k requests plus tokens. Sonar Pro costs $6–14 per 1k plus $3/$15 per million tokens. https://docs.perplexity.ai/docs/getting-started/pricing
- **Brave Search API:** the free tier was removed in Feb 2026. It now gives $5 of monthly credit and bills about $5 per 1k after that. https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/ · https://api-dashboard.search.brave.com/documentation/pricing

**GDPR when profiling people from public data**
- **Art. 14:** when data is not collected from the person, you must tell them within a reasonable period (**at most one month**), or at first communication. https://gdpr-info.eu/art-14-gdpr/
- **Bisnode (Poland):**
  - The Polish regulator fined Bisnode for relying on a website notice after scraping about 7.5M records from public registers. It rejected the "disproportionate effort" argument, because the cost of contacting people is part of the cost of using the data.
  - The fine was partly overturned, and **the Supreme Administrative Court upheld the regulator in Jan 2026**. That last point comes from a secondary summary; verify it before relying on it.
  - https://www.privacy-advice.com/en/news/polish-supervisory-authority-imposes-fine-for-breach-of-information-obligation-under-art-14-gdpr/ · https://iapp.org/news/a/polish-court-overturns-dpas-first-gdpr-fine
- **Legitimate interest:** EDPB Guidelines 1/2024 require an interest that is lawful, clearly stated and real and present, plus a necessity and balancing test. https://www.edpb.europa.eu/our-work-tools/documents/public-consultations/2024/guidelines-12024-processing-personal-data-based_en

**UX pattern: "We found this about you — confirm"**
- Research runs *when the person starts onboarding*, so they are the data subject and receive the notice in context.
- Each field shows its source link, its date, and whether it is a found fact or Q's inference.
- The person can confirm, correct or reject each field. Nothing becomes authoritative until confirmed, which is already a Capital Q rule.
- Data brokers such as Apollo stress that data can be "found" without being "verified", and use confidence tiers. https://docs.apollo.io/docs/enrich-people-data
- **Map to ADR-001:**
  - Scraped fact: `truth_class=USER_CLAIM` or `Q_INFERENCE` with `evidence_status=DOCUMENT_SUPPORTED`.
  - SEC or Companies House record: `EXTERNALLY_VERIFIED` for the registry fact only.
  - Stated mandate: declared, never overwritten by what the person is observed doing.

---

## 5. Operator and admin dashboards for trust and safety / KYB

- **Stripe Identity:** $1.50 per document-and-selfie verification, first 50 free, $0.50 per US ID-number lookup. https://stripe.com/pricing · https://docs.stripe.com/identity
- **Persona:** configurable "Dynamic Flow" plus **Case Management**, a manual-review hub with audit trails and routing across review stages. https://withpersona.com/product/cases · https://withpersona.com/product/dynamic-flow/
- **Onfido:** now **Entrust IDV** (acquisition closed 9 Apr 2024). https://www.entrust.com/company/onfido-is-now-entrust
- **Middesk:** US KYB from all 50 Secretary of State offices plus the IRS. Pricing through sales. https://www.middesk.com/solutions/verification
- **UK KYB:** the Companies House `identity_verification_details` field plus the PSC chain (Section 4).
- **Review-queue design:**
  - Each case holds its subject, evidence items, the automated check results, a reason-coded decision (approve, reject, request more, escalate) and the reviewer's identity.
  - For consequential actions (verify an organisation, suspend, change a badge), **four-eyes**: a second reviewer approves the exact same payload.
  - Append-only audit rows kept separate from domain events.
  - OWASP ASVS asks for step-up or adaptive auth, and/or separation of duties, on high-value functions. https://github.com/OWASP/ASVS/blob/master/4.0/en/0x12-V4-Access-Control.md
- **Step-up for admins:**
  - Re-authenticate with WebAuthn before each sensitive action.
  - Check freshness on the server against the actual authentication event, not a client-side flag.
  - https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html · https://github.com/jmanico/reporTool/issues/36
- **Impersonation ("view as"):**
  - Default to read-only.
  - Limit it to a small role.
  - Short sessions with a visible banner.
  - Mask sensitive fields.
  - Carry the impersonator's identity through every service and audit it at the start.
  - https://engineering.pigment.com/2026/04/08/safe-user-impersonation/ · https://workos.com/blog/support-impersonation-delegated-sessions · https://authress.io/knowledge-base/academy/topics/user-impersonation-risks
  - For Capital Q, "view as" must not bypass the Context Firewall: it renders exactly what that user's scope allows.
- **Retool vs building in-app:**
  - Retool's audit logs and SAML SSO start on the Business tier (about $50–65 per builder); self-hosting is Enterprise. https://retool.com/pricing · https://uibakery.io/blog/retool-pricing
  - Retool usually needs broad database credentials, which conflicts with the "privileged access isolated and named" rule.
  - Recommendation: an **in-app `/ops` surface** built on the same authorised API.

---

## 6. Keeping the GUI and the agent in step

- **Core principle ("agent-native"):** anything the UI can do, the agent can do, and the reverse must be visible and controllable in the UI. Duplicated implementations drift apart. https://every.to/guides/agent-native · https://www.builder.io/blog/agent-native-architecture
- **Shopify Sidekick app extensions** (live 17 Jun 2026):
  - *Data* extensions and *action* extensions.
  - Actions **stage changes for merchant confirmation**.
  - Needs API version 2026-04 or later.
  - https://shopify.dev/docs/apps/build/sidekick · https://shopify.dev/docs/apps/build/sidekick/build-app-actions
- **Salesforce Agentforce:**
  - Actions are `@InvocableMethod` Apex or Flows, the same building blocks the rest of the platform uses, grouped by topic.
  - https://developer.salesforce.com/docs/ai/agentforce/guide/agent-invocablemethod.html · https://developer.salesforce.com/blogs/2025/07/best-practices-for-building-agentforce-apex-actions
- **Microsoft:**
  - Semantic Kernel plugins can be imported from OpenAPI specs.
  - Agent Framework 1.0 (3 Apr 2026) merges Semantic Kernel and AutoGen.
  - https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/adding-openapi-plugins · https://devblogs.microsoft.com/foundry/introducing-microsoft-agent-framework-the-open-source-engine-for-agentic-ai-apps/
- **OpenAPI to tools:** Stainless and Speakeasy both generate MCP servers from an OpenAPI spec. Speakeasy's own guidance warns that one tool per endpoint needs curating. https://www.stainless.com/docs/mcp/ · https://www.speakeasy.com/mcp/tool-design/generate-mcp-tools-from-openapi
- **Vercel AI SDK 6 and approvals:**
  - Human-in-the-loop approval is built in. Tool parts move through `approval-requested`, `approval-responded` and `output-available`, and the client answers with `addToolApprovalResponse`.
  - With `experimental_toolApprovalSecret`, **the signature binds approval to the exact tool name, call ID and input**. That matches Capital Q's rule that approval binds to the exact payload.
  - Draft previews render as generative-UI tool parts in the chat.
  - https://ai-sdk.dev/docs/agents/tool-approvals · https://vercel.com/blog/ai-sdk-6 · https://ai-sdk.dev/cookbook/next/human-in-the-loop
- **Testing parity:**
  - (a) One **action registry**: name, Zod input and output schemas, authorise function, consequence class and idempotency.
  - (b) A contract test that lists every registered action and asserts it has an HTTP route and/or a Q tool, or an explicit `uiOnly` / `agentOnly` exemption with a reason.
  - (c) Keep evals for model behaviour separate. Do not ask an LLM to judge parity.

---

## 7. In-app messaging (for a later packet)

- **Vendors:**
  - Stream Chat: free up to 1k MAU; paid from about $399–499/mo for 10k MAU.
  - Sendbird: about $400+/mo (secondary).
  - TalkJS: from about $279/mo for 10k MAU.
  - https://getstream.io/chat/pricing/ · https://sendbird.com/pricing/chat · https://talkjs.com/pricing/
- **Supabase Realtime:**
  - Postgres Changes respect RLS.
  - Broadcast and Presence use RLS on `realtime.messages`, plus "private channels" with public access turned off. Authorisation is re-checked on connect and on token refresh.
  - Billed on messages and peak connections.
  - https://supabase.com/docs/guides/realtime/authorization · https://supabase.com/docs/guides/realtime/limits · https://supabase.com/docs/guides/realtime/pricing
  - This fits the stack you already run: messages stay in Postgres with tenant RLS, and Realtime is only the delivery pipe.
- **End-to-end encryption:** it blocks server-side retention, eDiscovery, investigations and moderation. Microsoft Teams notes E2EE disables records management. https://learn.microsoft.com/en-us/microsoftteams/teams-encryption · https://www.consilio.com/de/blog/encrypted-ephemeral-messaging-the-ediscovery-risk-youre-underestimating
  - Given Capital Q's audit and integrity authority, use TLS plus encryption at rest, with retention rules, rather than E2EE.
- **How other platforms handle it:**
  - **Upwork** confines pre-contract talk to its own messaging and treats sharing contact details as circumvention. https://support.upwork.com/hc/en-us/articles/360052511133-Circumvention-and-why-it-s-against-the-rules
  - **AngelList** members mostly block messages from people they don't follow and prefer warm intros. https://www.emergingprairie.com/angellist-what-is-it-who-is-it-for/
  - **DocSend** tracks per-page viewing and forwarding in its data rooms. https://www.docsend.com/
  - **Visible** handles investor updates. https://visible.vc/investor-updates/
- **Implication:** tie messaging to the canonical company–investor relationship. Messages become relationship events, which fits the event projector. Opening a thread requires a mutual-interest or intro state.
  - A read receipt is not a signal of interest ("viewing is not interest").
  - Attachments go through the evidence and disclosure path, not the chat.

---

## Recommendations for the demo (smallest real implementation)

1. **Public identity page:**
   - `apps/web` route `/@{handle}`, **`noindex` by default** with an owner opt-in to indexing.
   - `ProfilePage` JSON-LD and an `opengraph-image.tsx` built with `next/og`.
   - Show only fields scoped `public_external`. `network_visible` fields render only for signed-in participants.
2. **Handles:**
   - A reference table of reserved names (brands, staff roles, "admin", "q", "support"), case-insensitive and unique.
   - On rename, keep the old handle as a redirect with a **hold of 30–90 days** during which no one else can take it.
   - Never recycle the handle of a verified organisation, following GitHub's retirement model.
   - Verified badges come only from `verification_claims`, never from payment.
3. **Contact card:**
   - A vCard **3.0** download route with `X-Robots-Tag: noindex`.
   - QR codes pointing at a short first-party redirect like `/c/{code}`, with first-party scan counts and no pixels.
   - **Leave Apple and Google Wallet out of the demo.** Apple needs the $99/yr programme plus certificates and an APNs web service. Google needs publishing approval; Demo Mode works for test accounts only.
4. **Brand kit:**
   - Extract logo, palette and fonts from the company website and deck with Firecrawl or Parallel. Treat the result as `Q_INFERENCE` and require confirmation.
   - Store as structured data (palette roles, font pair, tone).
   - **PPTX via pptxgenjs with native charts drawn from data.**
   - **PDF via Playwright in `apps/workers`** with `tagged: true, outline: true`.
5. **Images:**
   - One adapter behind the Q Model Gateway: OpenAI gpt-image (ZDR-eligible) first and Gemini **paid tier** second, which matches your demo model policy.
   - Keep the C2PA metadata and show an "AI-generated" label.
   - No charts, real faces or third-party logos. For logo work, only compose around the uploaded logo, or use Recraft for vector variations later.
6. **Investor research onboarding:**
   - Sources: SEC `submissions` plus Form D and Form ADV rosters, Companies House (with the IDV field), and the firm's website through one web-research API (Exa or Parallel).
   - Every field records its source URL and date and goes through a confirm screen.
   - No LinkedIn scraping. No Crunchbase or PitchBook data shown to users under their licences.
   - Show an Art. 14-style notice at the point of research.
7. **Ops console:**
   - `/ops` surface: role-gated, WebAuthn step-up, reason codes, four-eyes approval on verify or suspend, append-only audit.
   - "View as" is read-only and runs through the Context Firewall.
   - Stripe Identity only if a live identity check is needed.
8. **Parity:**
   - A single Zod action registry that generates the `/v1` routes and the Q tools.
   - Approval payloads signed with AI SDK approval binding, or your own HMAC over the canonical payload.
   - A contract test listing registry entries against routes and tools.
9. **Messaging (later packet):** Postgres tables with RLS plus Supabase Realtime private channels, gated on relationship state. No E2EE.

## Accounts and keys needed

**Demo-critical**
- OpenAI API key, with ZDR requested for the organisation.
- Google AI Studio / Gemini **paid** key.
- An SEC-compliant User-Agent string. No key is needed; use a real contact email.
- Companies House API key (free).
- One web-research key: Exa, Parallel, Firecrawl or Tavily.

**Optional or later**
- Apple Developer Program ($99/yr), Pass Type ID certificate, APNs key.
- Google Wallet Issuer account and service account (Demo Mode until approved).
- Stripe Identity (the existing Stripe account works).
- Persona or Middesk (sales contract).
- Recraft, Ideogram and BFL keys.
- Gamma API (Pro plan or above).
- Dealroom, Harmonic or Specter (sales, approval-gated).
- Stream, TalkJS or Sendbird only if you decide to buy chat rather than build it.