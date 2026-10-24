import type { QaEntry } from "./qa-bank.js";

/**
 * Q Story S3: the product questions an investor asks after Q tells Capital
 * Q's story (docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt). The questions
 * come from research into what investors ask AI deal-flow, investment
 * intelligence and two-sided founder/investor platforms; the answers come
 * only from the product sources and the certified tour.
 *
 * Same rules as the rest of the bank, plus one: plain words. An answer
 * claims no traction, customers, revenue, investors or team size, says what
 * is live and what is not, names its sources, and uses no engineering
 * vocabulary (the bank's tests read all three). Where the sources hold no
 * honest answer, the entry says so and hands the question to the founders;
 * those questions are listed in docs/specs/q-pitch/story/INVESTOR-QA.md.
 */

const PADL =
  "docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt";
const SPEC =
  "docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt";
const GATEQ =
  "docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt";
const STORY = "docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt";
const LANDING = "docs/ai-handoff/LANDING-PROMISES.md";
const COVERAGE = "docs/ai-handoff/PROMISE-COVERAGE.md";
const INVESTIQ = "docs/ai-handoff/INVESTIQ-METHODOLOGY.md";
const CERT = "docs/specs/q-pitch/CERTIFICATION_MANIFEST.md";
const INVESTOR_TOUR = "packages/q-pitch/src/investor-v6.ts";
const FOUNDER_TOUR = "packages/q-pitch/src/founder-v6.ts";
const SECURITY = "docs/architecture/15_Capital_Q_Security_Architecture.md";
const OWNER_FACTS =
  "docs/specs/q-pitch/story/INVESTOR-QA.md questions Q cannot answer";

export const PRODUCT_QA_ENTRIES: readonly QaEntry[] = [
  // ── What it is and who it is for ────────────────────────────────────
  {
    id: "qa.who-for",
    side: "BOTH",
    question: "Who is Capital Q built for?",
    paraphrases: [
      "who is the target user",
      "who is the intended audience",
      "which investors is it built for",
      "is it for angels or venture funds",
      "does it work for family offices and private equity",
      "who is the day one user",
      "who is it for",
    ],
    answer:
      "Both sides of private capital. On one side, investors of every kind, from angels investing their own money to funds answering to their own backers. On the other, businesses raising capital: a first raise, a later round, a difficult round, or an established company looking for growth capital. Q learns each investor's thesis and each business's story, and connects the two.",
    sources: [`${STORY} opening`, `${LANDING} LP-14, LP-15`, `${SPEC} 3.1`],
  },
  {
    id: "qa.business-types",
    side: "BOTH",
    question: "Is it only for startups?",
    paraphrases: [
      "does it work for established businesses",
      "can a growth stage company use it",
      "what about later stage rounds like series b",
      "can a company in a down round use it",
      "is it only for early stage companies",
    ],
    answer:
      "No. A first raise, a Series B, a down round, or an established business financing expansion or an acquisition: different stage, same problem, finding the right capital from the right investor at the right time. The assessment adjusts what it expects by stage, so a young company is never judged against a later one.",
    sources: [
      `${STORY} the other side of the table`,
      `${INVESTIQ} Stage handling`,
    ],
  },
  {
    id: "qa.what-is-q",
    side: "BOTH",
    question: "What is Q?",
    paraphrases: ["what does q do", "who is q", "so what is q exactly"],
    answer:
      "I'm Q, the investment analyst inside Capital Q. I learn each investor's mandate and each business's story, assess companies on their evidence, match the two, answer questions and do the work you approve. I'm an analyst, not the source of truth, and the decisions stay with you.",
    sources: [`${PADL} Decision #9`, `${INVESTOR_TOUR} opening`],
  },
  {
    id: "qa.tiktok-jarvis",
    side: "BOTH",
    question: "What do you mean by TikTok plus Jarvis?",
    paraphrases: [
      "why compare it to tiktok",
      "what does jarvis from iron man mean here",
      "is it really a swipe app for investing",
      "what is the tiktok for investment discovery idea",
    ],
    answer:
      "TikTok for discovery: short pitches, one company at a time, chosen for your mandate, which you swipe through and save or pass. Jarvis for everything after: an analyst you can simply ask, who compares companies, challenges assumptions, prepares your meetings and does the work you approve. One is how you find; the other is how you decide.",
    sources: [`${LANDING} LP-02, LP-09, LP-11`, `${STORY} CapitalQ`],
  },
  {
    id: "qa.q-card",
    side: "BOTH",
    question: "What is a Q Card?",
    paraphrases: [
      "what's your q card",
      "what does a q card contain",
      "can a founder share their company outside the platform",
      "is the q card replacing the deck",
    ],
    answer:
      "The Q Card is a company's shareable identity: its story, numbers, raise and intelligence in one living record, shared by a link or a code, so someone outside Capital Q can open it without an account first. It is a locked product concept whose final name is still to be decided, so treat it as the direction rather than a finished feature.",
    sources: [`${PADL} Decision #121`, `${COVERAGE} naming conflict`],
  },
  {
    id: "qa.geography",
    side: "BOTH",
    question: "Which markets and regions do you cover?",
    paraphrases: [
      "what geographies are you in",
      "is this for africa or the middle east",
      "do you work outside your home market",
      "which countries are companies from",
      "does it work in nigeria",
    ],
    answer:
      "Capital Q is offered by FDN Capital Partners, which works from Lagos and Dubai. Inside the product, geography is part of every investor's mandate, so matching respects where you invest. Which markets the company will launch in first is a question for the founders; I won't guess at it.",
    sources: [`${LANDING} LP-46 footer`, `${STORY} I learn how you invest`],
  },

  // ── How it works for investors ──────────────────────────────────────
  {
    id: "qa.mandate",
    side: "BOTH",
    question: "What do you capture about my investment thesis?",
    paraphrases: [
      "what goes into my mandate",
      "what preferences can i set",
      "can i set minimum criteria",
      "do i have to fill in a mandate questionnaire",
      "how detailed is the thesis setup",
    ],
    answer:
      "Your thesis, stage, sectors, geography, cheque size, preferences and minimum criteria. I learn them in a conversation, not a long questionnaire, and then shape what you discover around them. What you declare stays yours: what you happen to view never quietly rewrites it.",
    sources: [`${STORY} I learn how you invest`, `${LANDING} LP-15, LP-32`],
  },
  {
    id: "qa.discover",
    side: "BOTH",
    question: "How does the Discover feed work?",
    paraphrases: [
      "what is the discovery feed",
      "how do i swipe through companies",
      "what happens when i save or pass a company",
      "how do i browse opportunities",
      "can i search instead of swiping",
    ],
    answer:
      "Discover shows pitches one company at a time, chosen for your mandate, with why each one is there and the key facts beside it, in the same structure for every company. You save or pass with a swipe, or search for exactly what you want. Saving is instant; expressing interest is a deliberate step, because viewing is never interest. This is in the product today.",
    sources: [`${INVESTOR_TOUR} Discover step`, `${CERT} Investor track`],
  },
  {
    id: "qa.behaviour",
    side: "BOTH",
    question: "Does my feed change based on what I swipe?",
    paraphrases: [
      "does it learn from my clicks",
      "will my browsing change my mandate",
      "are you optimising for engagement",
      "does watching a video count as interest",
    ],
    answer:
      "It can bring forward companies like the ones you saved, and it says so on the card. But what you browse never rewrites the mandate you declared, nothing excludes a company except a rule you set, and the feed is never tuned for watch time or clicks. A view is not interest; only you decide that.",
    sources: [`${LANDING} LP-32`, `${INVESTOR_TOUR} Explore step`],
  },
  {
    id: "qa.profile",
    side: "BOTH",
    question: "What do I see on a company's profile?",
    paraphrases: [
      "what is on a company page",
      "what is in the investor briefing",
      "how is each company presented",
      "what information does a company profile show",
    ],
    answer:
      "The same sections for every company: an overview built from the founder's own material, diligence with the key claims and what isn't known yet, risks in words, the elevator video, the documents the founder has shared with you, my reading of their deck, and the team. Every claim is labelled as the founder's until evidence says otherwise. This is in the product today.",
    sources: [`${INVESTOR_TOUR} profile steps`, `${CERT} Investor track`],
  },
  {
    id: "qa.compare",
    side: "BOTH",
    question: "Can I compare companies side by side?",
    paraphrases: [
      "can i put two companies beside each other",
      "how do i compare opportunities",
      "can q compare businesses for me",
      "side by side comparison",
    ],
    answer:
      "Yes. Because every company sits in the same structure, you can compare like with like, either side by side on screen or by asking me to compare them, and I'll say where one is stronger, where the evidence is thin, and what is unknown for each.",
    sources: [`${LANDING} LP-24`, `${CERT} INV-COMPARE-TABLE`],
  },
  {
    id: "qa.ask-before-meeting",
    side: "BOTH",
    question: "Can I ask Q about a company before I talk to the founder?",
    paraphrases: [
      "can i interrogate a company without contacting them",
      "can i question the founder's answers before a call",
      "do i need to engage the founder to ask questions",
      "can q answer questions about a business for me",
    ],
    answer:
      "Yes. You can ask me about any company you may see, and I answer from what the founder told me in their onboarding interview and from what they've shared, saying plainly when something isn't known. The founder isn't contacted until you choose to express interest.",
    sources: [`${PADL} Decision #123`, `${LANDING} LP-19, LP-42`],
  },
  {
    id: "qa.due-diligence",
    side: "BOTH",
    question: "Does Q do due diligence for me?",
    paraphrases: [
      "does this replace due diligence",
      "will q certify a company",
      "can i rely on q instead of my own diligence",
      "does it replace my analysts",
    ],
    answer:
      "No, and it never claims to. I organise the evidence, find what's missing, highlight what deserves attention and suggest the questions worth asking, so your diligence starts further along. The judgement, and the responsibility, stay with you and your advisers.",
    sources: [`${PADL} Decision #75`, `${INVESTOR_TOUR} Diligence step`],
  },
  {
    id: "qa.documents",
    side: "BOTH",
    question: "How do I get a company's documents?",
    paraphrases: [
      "who controls access to the files",
      "can i request more documents from a founder",
      "what happens if a founder revokes my access",
      "can i see the financial model",
    ],
    answer:
      "You see only what the founder has shared with you, organised in folders. What isn't open yet you can request, and the founder decides. Access can be withdrawn later, and everything I tell you respects the same permissions. This is in the product today.",
    sources: [`${INVESTOR_TOUR} data room step`, `${PADL} Decision #124`],
  },
  {
    id: "qa.gateq-setup",
    side: "BOTH",
    question: "How do I put GateQ on my website?",
    paraphrases: [
      "where can i plug gateq in",
      "how do i set up gateq",
      "can gateq handle applications from my accelerator",
      "how do inbound applications reach me",
      "can i use gateq on social media",
    ],
    answer:
      "GateQ gives you a front door you can link from anywhere businesses already come to you: your website, an application page, social media, an accelerator or an investment programme. Every application lands in one place, in one structure, already interviewed by me and matched against your criteria.",
    sources: [`${STORY} And for inbound`, `${GATEQ} overview`],
  },
  {
    id: "qa.gateq-volume",
    side: "BOTH",
    question: "Can it handle hundreds of inbound applications?",
    paraphrases: [
      "how do i get through a huge inbox of applications",
      "how are applications ranked",
      "will i still have to read every application",
      "what about the haystack of inbound",
    ],
    answer:
      "That is exactly what it's for. I interview each applicant, check them against your criteria, and order them by how well they suit you and how investable they are, so the most relevant rise to the top and you don't dig through the whole haystack. The decision on each one stays with your team.",
    sources: [`${STORY} GateQ`, `${LANDING} LP-40, LP-43`],
  },
  {
    id: "qa.unqualified-contact",
    side: "BOTH",
    question: "Can founders who don't meet my criteria still reach me?",
    paraphrases: [
      "how do i stop spam from founders",
      "can anyone message me",
      "control who can approach me",
      "is it an open messaging network",
    ],
    answer:
      "You control your inbound. You set the criteria, and a minimum score if you want one, and that is checked on our side, not just hidden on screen. Capital Q is deliberately not an open messaging network: outreach is structured through your gate, so you get qualified approaches rather than volume.",
    sources: [`${LANDING} LP-43`, `${PADL} Decision #152`],
  },
  {
    id: "qa.interest-match",
    side: "BOTH",
    question: "What is the difference between interest and a match?",
    paraphrases: [
      "how does a match happen",
      "what does expressing interest do",
      "when does a founder find out i'm interested",
      "is a match two way",
    ],
    answer:
      "Interest is one-sided: you express it from a company's profile, deliberately. A match is two-sided: it happens when the founder accepts, and then the relationship appears in both your records. Viewing alone never tells the founder anything.",
    sources: [`${PADL} Decision #117`, `${INVESTOR_TOUR} Explore step`],
  },
  {
    id: "qa.viewing-privacy",
    side: "BOTH",
    question: "Will a founder know I looked at their company?",
    paraphrases: [
      "can i browse anonymously",
      "do founders get notified when i view them",
      "is my viewing visible",
      "can i research without the founder knowing",
    ],
    answer:
      "Looking is not an invitation. Investors control how they appear when they browse, and a founder hears from you only when you deliberately express interest, ask to connect, request documents or a meeting. Founders get relationship signals that matter, not surveillance.",
    sources: [`${PADL} Decision #129`, `${PADL} Decision #128`],
  },
  {
    id: "qa.pass",
    side: "BOTH",
    question: "What happens when I pass on a company?",
    paraphrases: [
      "do i have to give a reason when i pass",
      "does the founder see that i passed",
      "is passing a rejection",
      "will you keep asking me why i passed",
    ],
    answer:
      "Passing is one swipe, with no reason required each time. Now and then I may ask, briefly, for feedback such as stage or sector, so the feed gets better without interrupting you. A pass is neutral, not a judgement on the company.",
    sources: [`${PADL} Decision #122`, "CLAUDE.md Design: Pass is neutral"],
  },
  {
    id: "qa.crm",
    side: "BOTH",
    question: "Does this replace my CRM?",
    paraphrases: [
      "do i still need a separate deal tracking tool",
      "how do you track my pipeline",
      "where do my relationships live",
      "what happens after a founder accepts",
    ],
    answer:
      "For the relationships made here, yes: each one has a single record that both sides share, where it stands, everything that happened in order with who can see each entry, your private notes, chat, calls and commitments, plus a pipeline by stage. It is built on the evidence of what actually happened, not on someone updating a field. This is in the product today.",
    sources: [
      `${INVESTOR_TOUR} relationship and CRM steps`,
      `${PADL} Decision #63`,
    ],
  },
  {
    id: "qa.integrations",
    side: "BOTH",
    question: "Does it integrate with my existing tools?",
    paraphrases: [
      "does it connect to my calendar",
      "can it sync with salesforce or hubspot or affinity",
      "does it work with my email",
      "can i import my current pipeline",
      "is there an integration with my other software",
    ],
    answer:
      "Calls are booked on your calendar through Google Calendar and Meet, and with your approval I can send a message from your own Gmail. Two-way syncing with other relationship tools, or importing an existing pipeline, is not something I can confirm today, so I won't promise it; the founders can tell you what is planned.",
    sources: [
      "docs/specs/2026-10/auto.md booking",
      "docs/adr/0043-standing-instructions.md email",
    ],
  },
  {
    id: "qa.meetings",
    side: "BOTH",
    question: "Does Q join my meetings?",
    paraphrases: [
      "can q attend a meeting with a founder",
      "does q record meetings",
      "what does q do in a call",
      "who sees the meeting notes",
    ],
    answer:
      "You can have me join a call booked on Capital Q, with that stated at booking. I take notes for both sides and answer when asked; afterwards I ask you to confirm any commitment before it's recorded. Booking and having me join are in the product today; the full live-meeting journey is still being verified end to end.",
    sources: [`${INVESTOR_TOUR} Calls and meetings step`, `${COVERAGE} LP-20`],
  },
  {
    id: "qa.q-acts",
    side: "BOTH",
    question: "Can Q act on my behalf?",
    paraphrases: [
      "can q handle tasks for me",
      "will q send things without asking me",
      "can q follow up with founders for me",
      "can q book meetings automatically",
    ],
    answer:
      "Yes, within the approval rules you set. I can watch your mandate, express interest, reply, book meetings and prepare documents. Anything consequential waits for you exactly as I prepared it, and if it changes it needs your approval again. You see what needs you and what I've done this week. This is in the product today.",
    sources: [`${INVESTOR_TOUR} Q Work step`, `${PADL} Decision #120`],
  },
  {
    id: "qa.one-q",
    side: "BOTH",
    question: "Is Q one AI or many?",
    paraphrases: [
      "are there multiple ai agents behind q",
      "who checks q's work",
      "how does q's team work",
      "is it just a chatbot",
    ],
    answer:
      "You talk to one Q. Behind me there is a team: a planner sets the steps, specialists research and draft, and a reviewer checks the work before it reaches you. You never have to choose between them, and each job's plan can be shown step by step. This is in the product today.",
    sources: [`${INVESTOR_TOUR} Q's team step`, `${PADL} Decision #137`],
  },
  {
    id: "qa.q-daily",
    side: "BOTH",
    question: "What is the Q Daily?",
    paraphrases: [
      "do you send news",
      "what is the newspaper q writes",
      "how do i keep up with my sector",
      "can i turn off the daily",
    ],
    answer:
      "A newspaper written for you: stories chosen for your mandate or your raise, with my take on what matters and every source named. It comes on the schedule you choose, and you can switch it off. This is in the product today.",
    sources: [`${INVESTOR_TOUR} Q Daily step`, `${FOUNDER_TOUR} Q Daily step`],
  },
  {
    id: "qa.voice",
    side: "BOTH",
    question: "Can I talk to Q by voice?",
    paraphrases: [
      "can i speak to q",
      "does q answer out loud",
      "is there a voice mode",
      "can i ask questions by speaking",
    ],
    answer:
      "Speaking to me and hearing answers is part of the product. Be aware that this presentation runs with captions, and the spoken version of it hasn't been certified yet, so I'm only claiming what you've seen working.",
    sources: [`${CERT} Short of the v6 definition of done`, `${LANDING} LP-11`],
  },
  {
    id: "qa.languages",
    side: "BOTH",
    question: "What languages does Q speak?",
    paraphrases: [
      "does it work in french",
      "can i use it in arabic or spanish",
      "is it english only",
      "do you support other languages",
    ],
    answer:
      "In this demonstration I've been verified starting the presentation from requests in English, French and Spanish; the narration itself is in English. Beyond that, I won't promise a list of languages.",
    sources: [`${CERT} Natural-language trigger`],
  },
  {
    id: "qa.team-collab",
    side: "BOTH",
    question: "Can my partners and team use it together?",
    paraphrases: [
      "can i invite colleagues",
      "does it support a whole firm",
      "who in my firm sees my notes",
      "can several people share one account",
    ],
    answer:
      "Yes. A firm or a company is a team on Capital Q: you invite colleagues as owners, admins or members, and private notes are seen only by your own firm. When someone leaves, the firm's information stays with the firm.",
    sources: [
      "docs/adr/0057-organisations-as-teams.md",
      `${PADL} Decision #145`,
    ],
  },
  {
    id: "qa.memory",
    side: "BOTH",
    question: "Does Q remember our previous conversations?",
    paraphrases: [
      "does q have memory",
      "will i have to repeat myself",
      "does q keep context over time",
      "what does q remember about me",
    ],
    answer:
      "Yes. I keep memory about you, your companies and your relationships over time, with where each thing came from, so you don't start from scratch each time. That memory is still bound by permissions: remembering something never means I may show it to someone else.",
    sources: [
      `${PADL} Decision #138`,
      "docs/adr/0012-memory-and-conversations.md",
    ],
  },

  // ── Founders, seen by an investor ───────────────────────────────────
  {
    id: "qa.founder-effort",
    side: "BOTH",
    question: "How much work is it for a founder to get on?",
    paraphrases: [
      "what does a founder have to do before getting anything back",
      "how long does founder onboarding take",
      "do founders have to upload everything",
      "is there a long form for companies",
    ],
    answer:
      "Very little to start. A founder uploads what they already have, I work first and return useful intelligence, then we fill the gaps together in conversation. They can skip anything, and nothing I extract becomes part of their record until they confirm it.",
    sources: [`${PADL} Decision #56`, `${PADL} Decision #103`],
  },
  {
    id: "qa.adverse-selection",
    side: "BOTH",
    question: "Why would the best founders join?",
    paraphrases: [
      "won't you only get companies nobody else wants",
      "great founders raise through warm intros so why use this",
      "why would top companies list here",
      "isn't the supply adversely selected",
    ],
    answer:
      "Because the value comes before the raise: a free, full diagnosis of what investors will see, what could block them, and which investors genuinely fit, plus rehearsal against those investors. A strong founder saves months by talking only to investors whose bar they meet. Whether that draws the best founders is the bet Capital Q has to prove, and I won't claim it already has.",
    sources: [`${PADL} Decision #106`, `${STORY} For businesses`],
  },
  {
    id: "qa.cold-start",
    side: "BOTH",
    question: "How do you solve the chicken and egg problem?",
    paraphrases: [
      "which side do you bring on first",
      "how do you get both founders and investors",
      "is it useful before the network exists",
      "does one side work without the other",
    ],
    answer:
      "Each side gets value alone. An investor can point their existing inbound through GateQ and have it interviewed and ranked on day one. A founder gets a diagnosis and an improvement plan before any investor is involved. The network makes both better, but neither has to wait for it. How quickly both sides grow is for the founders to speak to.",
    sources: [`${GATEQ} overview`, `${PADL} Decision #106`],
  },
  {
    id: "qa.founder-score-gaming",
    side: "BOTH",
    question: "Can founders game their score?",
    paraphrases: [
      "can a founder see their score while answering",
      "what stops founders from exaggerating",
      "can a company edit its own assessment",
      "can founders manipulate the scoring",
    ],
    answer:
      "Founders don't see interim scores while the assessment is underway, so they can't tune their answers to it. They can't edit the assessment either; they can only add evidence. And a claim counts for less than evidence: something the founder says moves the picture less than something a document or verification supports.",
    sources: [`${PADL} Decision #104`, `${PADL} Decision #107`],
  },
  {
    id: "qa.appeal",
    side: "BOTH",
    question: "What if a founder disagrees with their assessment?",
    paraphrases: [
      "can a score be challenged",
      "how do you correct a mistake in an assessment",
      "what if q gets something wrong about a company",
      "is there an appeals process",
    ],
    answer:
      "They can challenge it, not edit it. I first explain the conclusion and the evidence behind it; they can then add new or corrected evidence, and I reassess. If nothing changes, I explain why. Where it's warranted, they can ask for a human review by FDN.",
    sources: [`${PADL} Decision #50`, `${PADL} Decision #107`],
  },
  {
    id: "qa.verification",
    side: "BOTH",
    question: "Are the companies and investors verified?",
    paraphrases: [
      "how do you stop fake investors",
      "how do you prevent scams and fraud",
      "is identity checked",
      "can anyone claim to be an investor",
    ],
    answer:
      "Verification grows with what someone tries to do. Anyone can explore and get value first, but a company is not shown to investors, and cannot request meetings, until it has been verified. Contact between the two sides runs through gates and permissions, with reporting and human review behind it, rather than open messaging.",
    sources: [`${PADL} Decision #57`, `${PADL} Decision #147`],
  },
  {
    id: "qa.ai-presenter",
    side: "BOTH",
    question: "Are the pitch videos made with AI?",
    paraphrases: [
      "can founders use an ai avatar",
      "is that a real person in the video",
      "how do i know a video is genuine",
      "are avatars allowed",
    ],
    answer:
      "The elevator pitch is the founder's own video. Where a founder uses an AI presenter, it is always labelled as one, so you always know what you're watching. This is in the product today.",
    sources: [`${INVESTOR_TOUR} elevator step`, `${CERT} Investor track`],
  },

  // ── Scores and the AI ───────────────────────────────────────────────
  {
    id: "qa.score-areas",
    side: "BOTH",
    question: "What does the assessment look at?",
    paraphrases: [
      "which factors go into investability",
      "what dimensions do you assess",
      "what does investability iq measure",
      "what areas are graded",
    ],
    answer:
      "Eight areas from FDN's framework: the team, the business fundamentals, commercial strength, financial readiness, governance, legal and corporate, the investment case, and how ready the company is for diligence. How much each area counts depends on the company's stage. Fit with your mandate is measured separately, as Suitability.",
    sources: [`${INVESTIQ} Dimensions and stage weights`, `${LANDING} LP-25`],
  },
  {
    id: "qa.stage-fairness",
    side: "BOTH",
    question: "Do you judge a pre-seed company like a Series B?",
    paraphrases: [
      "is a company penalised for having no revenue",
      "how does stage change the assessment",
      "are early companies compared fairly",
      "what if the company is pre revenue",
    ],
    answer:
      "No. At the earliest stages the team and the fundamentals count most; commercial results, finances, governance and diligence count more as a company matures. A pre-seed company is never read as weak for having no revenue yet, and if the stage isn't stated there's no number rather than a guess.",
    sources: [`${INVESTIQ} Stage handling`, `${PADL} Decision #64`],
  },
  {
    id: "qa.why-this-score",
    side: "BOTH",
    question: "Can I see why a company got its score?",
    paraphrases: [
      "show me every input behind the score",
      "is the score explained",
      "what raised or lowered the number",
      "where does each factor come from",
    ],
    answer:
      "Yes. Each score shows what raised it, what lowered or held it back, and what would make it more complete, each with its source and how well it's supported. Behind that sits the full record of how it was worked out, kept with every revision.",
    sources: [`${INVESTIQ} Explainability`, `${PADL} Decision #69`],
  },
  {
    id: "qa.self-reported",
    side: "BOTH",
    question: "Isn't it all just what founders claim?",
    paraphrases: [
      "how do you verify the numbers",
      "can i trust self reported figures",
      "what is evidence status",
      "how do you know a founder is telling the truth",
    ],
    answer:
      "Much of it starts as the founder's claim, and it is labelled that way. Every fact carries how well it's supported, from the founder's own word, through documents and several sources, to verification. Claims count for less than evidence, and today most scores show low confidence for exactly that reason. I'd rather tell you that than dress a claim up as fact.",
    sources: [`${INVESTIQ} Content grading`, `${PADL} Decision #105`],
  },
  {
    id: "qa.contradictions",
    side: "BOTH",
    question: "What happens when the numbers don't match?",
    paraphrases: [
      "what if two sources disagree",
      "how do you handle contradictory information",
      "which figure do you show when they conflict",
      "do conflicts lower the score",
    ],
    answer:
      "Both stay visible, side by side, until they're reconciled. I never quietly pick the more flattering number. A contradiction triggers a question rather than a penalty: that part is held back as unresolved, and confidence drops until it's settled.",
    sources: [`${PADL} Decision #67`, `${INVESTIQ} Anchors and evidence`],
  },
  {
    id: "qa.bias",
    side: "BOTH",
    question: "Is the scoring biased?",
    paraphrases: [
      "are you just automating pattern matching",
      "do you use proxies like schools or networks",
      "is it fair to founders from emerging markets",
      "how do you avoid bias in the ai",
    ],
    answer:
      "The scores follow written rules, the same for every company at the same stage, and no AI model sets the number. They read what the evidence says about the business and the team's experience, never browsing behaviour, and every factor is shown. Missing information lowers confidence, never the score, which matters for founders with less public coverage. A formal audit of outcomes hasn't been published, and I won't claim one.",
    sources: [`${INVESTIQ} Investor-eligible inputs`, `${PADL} Decision #68`],
  },
  {
    id: "qa.ai-decides",
    side: "BOTH",
    question: "Does the AI decide who gets funded?",
    paraphrases: [
      "does q make investment decisions",
      "can a low score stop a company raising",
      "who has the final say",
      "is q a gatekeeper",
    ],
    answer:
      "No. I present evidence, trade-offs and recommendations; you decide. A low assessment never stops a legitimate company from raising, and you're free to look at companies I didn't recommend. My firm authority is over permissions, privacy and integrity, not over your commercial judgement.",
    sources: [`${PADL} Decision #90`, `${PADL} Decision #154`],
  },
  {
    id: "qa.prediction",
    side: "BOTH",
    question: "Can Q predict which startups will succeed?",
    paraphrases: [
      "do you forecast returns",
      "what is unicorn potential",
      "is the score a probability of success",
      "can it tell me which company will be a winner",
    ],
    answer:
      "No, deliberately. Capital Q analyses the evidence that exists today; it doesn't forecast outcomes. There is a separate, provisional Unicorn Potential indicator, but it measures present evidence against a set of criteria and is explicitly not a probability or a forecast.",
    sources: [
      `${PADL} Decision #46`,
      "docs/adr/0076-unicorn-potential-provisional-indicator.md",
    ],
  },
  {
    id: "qa.validation",
    side: "BOTH",
    question: "Have the scores been validated against real outcomes?",
    paraphrases: [
      "how do you know the score works",
      "what is your measured error rate",
      "have you back tested the methodology",
      "does a high score lead to funding",
    ],
    answer:
      "Not yet, and I won't pretend otherwise. The method rests on published research on what investors weigh at each stage, and its weights are product choices, not proven from outcomes. Changes to it are versioned and reviewed, never drift on their own. Validating it against real outcomes needs the outcomes first.",
    sources: [
      `${INVESTIQ} Dimensions and stage weights`,
      `${PADL} Decision #76`,
    ],
  },
  {
    id: "qa.learning",
    side: "BOTH",
    question: "Does Q get smarter over time?",
    paraphrases: [
      "how does the product improve with use",
      "is there a data flywheel",
      "does it learn from outcomes",
      "what gets better as more people join",
    ],
    answer:
      "In two ways. I build memory for each person and firm, so the work compounds. Over time Capital Q is designed to learn from real outcomes, such as which improvements and introductions actually lead to raises, using protected patterns, never one party's private information. The scoring method itself changes only through reviewed, versioned updates.",
    sources: [`${PADL} Decision #87`, `${PADL} Decision #150`],
  },
  {
    id: "qa.outside-sources",
    side: "BOTH",
    question: "Does Q use information from outside the platform?",
    paraphrases: [
      "do you search the web about companies",
      "where does your data come from",
      "do you scrape public sources",
      "is it only what founders upload",
    ],
    answer:
      "Mostly it uses what founders and investors bring, labelled by where it came from. When asked, I can do controlled public research, and the Q Daily reads the news with every source named. Something found on the web is never treated as truth about a company on its own; it's a lead, labelled as such.",
    sources: [
      "docs/adr/0009-controlled-public-web-research.md",
      `${PADL} Decision #146`,
    ],
  },
  {
    id: "qa.q-limits",
    side: "BOTH",
    question: "What are Q's limits?",
    paraphrases: [
      "what should i never rely on q for",
      "what is q not allowed to do",
      "what can't q do",
      "is there anything q refuses to do",
      "where does q stop",
    ],
    answer:
      "I don't make investment decisions, give legal, tax or investment advice, certify due diligence, or predict winners. I won't send anything consequential without your approval, and no instruction can make me show you something you're not permitted to see. When I don't know, I say so.",
    sources: [`${PADL} Decision #90`, `${PADL} Decision #75`],
  },
  {
    id: "qa.advice",
    side: "BOTH",
    question: "Is this investment advice? Are you regulated?",
    paraphrases: [
      "are you a broker dealer",
      "do you need a licence to do this",
      "is a recommendation from q financial advice",
      "what is your regulatory position",
    ],
    answer:
      "Capital Q is built never to give investment, legal, tax or accounting advice: I inform, and the decisions and terms are between you and the founder. Questions of licensing and regulation in particular markets are for the founders and their counsel; I won't state a position I don't have a source for.",
    sources: [`${PADL} Decision #75`, `${PADL} Decision #154`],
  },

  // ── Trust, data and security ────────────────────────────────────────
  {
    id: "qa.data-ownership",
    side: "BOTH",
    question: "Who owns the data?",
    paraphrases: [
      "do founders own what they upload",
      "can i export my records when i leave",
      "can i export my data",
      "who owns the assessments",
      "does capital q own my documents",
    ],
    answer:
      "Users own what they bring: profiles, documents, financials, videos and evidence. Capital Q owns the intelligence it produces, such as assessments and briefs, which is why nobody can simply edit them. People keep control of their own information and can take it with them.",
    sources: [`${PADL} Decision #49`, `${PADL} Decision #151`],
  },
  {
    id: "qa.deletion",
    side: "BOTH",
    question: "Can I delete my data?",
    paraphrases: [
      "what if i leave the platform",
      "can i close my account",
      "can i withdraw access i gave",
      "how long do you keep records",
    ],
    answer:
      "Yes, with care for context. You can withdraw sharing and archive what you've added. Closing your whole account isn't something you can do yourself in the product yet. Your personal private information can be forgotten, but you can't erase another party's legitimate record of a relationship, and withdrawing access can't recall a copy someone already downloaded.",
    sources: [`${PADL} Decision #151`],
  },
  {
    id: "qa.training",
    side: "BOTH",
    question: "Is my data used to train AI models?",
    paraphrases: [
      "do you send my information to ai companies",
      "which ai providers see my data",
      "does my confidential material train someone else's model",
      "is my deck fed into chatgpt",
    ],
    answer:
      "Private Capital Q information does not automatically become training material for outside AI models. Using information to serve you, learning privately for your firm, learning protected patterns across the network, and training outside models are treated as four separate things, and the AI services we use must keep to the same commitments.",
    sources: [`${PADL} Decision #150`],
  },
  {
    id: "qa.security",
    side: "BOTH",
    question: "How do you keep data safe?",
    paraphrases: [
      "how are my files protected",
      "could another fund see my notes or pipeline",
      "can capital q staff read my files",
      "is it encrypted",
    ],
    answer:
      "Information is encrypted in transit and at rest. Every request is checked against permissions on our side, not just hidden on screen, so one firm can never see another's notes or pipeline. Sensitive actions are logged with who did what, and Capital Q staff access works through named roles that are themselves recorded.",
    sources: [
      `${SECURITY} encryption`,
      "docs/adr/0033-platform-operator-roles-step-up-break-glass.md",
    ],
  },
  {
    id: "qa.certification",
    side: "BOTH",
    question: "Do you have SOC 2 or a security certification?",
    paraphrases: [
      "are you iso certified",
      "has the platform been penetration tested",
      "what compliance certifications do you have",
      "do you have a security audit report",
      "are you compliant with recognised standards",
    ],
    answer:
      "I have no certification or audit report to tell you about, so I won't claim one. The founders can tell you where that stands and what is planned.",
    sources: [`${SECURITY} scope`],
  },
  {
    id: "qa.manipulation",
    side: "BOTH",
    question: "Could a document trick Q into saying something false?",
    paraphrases: [
      "what if a deck contains hidden instructions",
      "can someone manipulate q with an upload",
      "how do you stop prompt injection",
      "can a founder fool the ai",
    ],
    answer:
      "Anything I read, whether a document, a web page or a message, is treated as material to analyse, never as instructions to follow. It can't change my rules, my permissions or what I'm allowed to show you, and what it claims stays labelled as a claim.",
    sources: [
      "docs/adr/0008-document-processing-and-parser-isolation.md",
      `${PADL} Decision #154`,
    ],
  },

  // ── Against the alternatives (product only) ─────────────────────────
  {
    id: "qa.vs-databases",
    side: "BOTH",
    question: "How are you different from PitchBook or Dealroom?",
    paraphrases: [
      "why use this if i already pay for pitchbook",
      "how do you compare with crunchbase or tracxn",
      "harmonic already finds early companies so what do you add",
      "do you compete on coverage of companies",
    ],
    answer:
      "Those are about coverage: what can be found about many companies from the outside. Capital Q works from the inside: the founder's own material, interviewed and labelled by how well it's supported, assessed the same way for every company, and matched to your declared mandate. And it carries on past discovery, into the relationship, meetings and commitments.",
    sources: [`${PADL} Decision #001`, `${LANDING} LP-10, LP-19`],
  },
  {
    id: "qa.vs-relationship-tools",
    side: "BOTH",
    question: "How are you different from Affinity?",
    paraphrases: [
      "isn't relationship intelligence just a feature of affinity",
      "why not just use my relationship management tool",
      "how is this different from a deal flow tracker",
      "do you compete with affinity or dealcloud",
    ],
    answer:
      "A relationship tool tracks your activity around companies. Capital Q starts earlier, with discovery and an evidence-based view of each company, and its relationship record is shared by both sides and built from what actually happened, with each entry marked with who can see it. Your private notes stay private to your firm.",
    sources: [`${PADL} Decision #63`, `${INVESTOR_TOUR} relationship step`],
  },
  {
    id: "qa.vs-angellist",
    side: "BOTH",
    question: "How are you different from AngelList or Carta?",
    paraphrases: [
      "is this like angellist syndicates",
      "why not carta for this",
      "are you an investing platform",
      "do you handle the investment transaction",
    ],
    answer:
      "Capital Q isn't where money is pooled or ownership is recorded. It's where investors and businesses find, understand and qualify each other before that, and where the relationship is run. Commitments are recorded once both sides confirm them, but the terms and the transaction stay between the parties.",
    sources: [`${PADL} Decision #001`, `${INVESTOR_TOUR} Capital step`],
  },
  {
    id: "qa.vs-chatgpt",
    side: "BOTH",
    question: "Why not just use ChatGPT?",
    paraphrases: [
      "what stops openai from doing this",
      "can't a general ai assistant do the same",
      "why not chatgpt with a crm plugin",
      "isn't this a wrapper around a chatbot",
    ],
    answer:
      "A general assistant can summarise a deck you hand it. It doesn't hold one trusted record per company that both sides rely on, label every fact by how well it's supported, keep each party's private information separate, apply one assessment method to every company, or act within your approvals on a live relationship. Those are what Capital Q is built around.",
    sources: [`${PADL} Decision #85`, `${PADL} Decision #144`],
  },

  // ── Holding answers: facts the owner has not supplied ───────────────
  // The knowledge pack's UNKNOWN business entries, folded in: Q says it does not know and
  // will not estimate, and offers a human follow-up.
  {
    id: "qa.valuation",
    side: "BOTH",
    question: "What is Capital Q's valuation?",
    paraphrases: [
      "what valuation are you raising at",
      "how much have you raised so far",
      "who has invested in capital q",
      "what is your funding history",
    ],
    answer:
      "Capital Q's funding history and valuation haven't been given to me as approved company material, so I don't know them and won't estimate them. The raise is stated as USD 2 million, as the founders' own claim. The founders can answer the rest directly.",
    sources: [OWNER_FACTS, "Capital Q company record (raise: founder claim)"],
  },
  {
    id: "qa.market-size",
    side: "BOTH",
    question: "How big is the market?",
    paraphrases: [
      "what is your market size",
      "what is the total addressable market",
      "how large is the opportunity",
      "what is the tam",
    ],
    answer:
      "Capital Q's market size hasn't been given to me as approved company material, so I won't put a number on it. I'd rather leave it to the founders than invent one.",
    sources: [OWNER_FACTS],
  },
  {
    id: "qa.unit-economics",
    side: "BOTH",
    question: "What are your unit economics?",
    paraphrases: [
      "what are your margins",
      "what is your gross margin",
      "how much does each workflow cost you to run",
      "what is your cost per user",
      "are the ai running costs sustainable",
    ],
    answer:
      "Unit economics and margins haven't been given to me as approved company material, so I don't know them and won't estimate them. The founders can take you through them.",
    sources: [OWNER_FACTS],
  },
  {
    id: "qa.data-location",
    side: "BOTH",
    question: "Where is my data stored?",
    paraphrases: [
      "where is the data hosted",
      "which country are the servers in",
      "do you keep data in europe",
      "what about data residency",
      "is my data stored in the eu",
    ],
    answer:
      "Your records are stored in the European Union: they are kept in Frankfurt and the app runs in the Netherlands, and keeping data in the EU is a requirement of the architecture. When Q uses an AI model, that request is processed by the model provider under its own terms. Which providers and regions are used, and formal commitments for particular countries, are for the founders to confirm.",
    sources: [
      "docs/adr/0014-railway-replaces-render-for-node-services.md region",
    ],
  },
  {
    id: "qa.mobile",
    side: "BOTH",
    question: "Is there a mobile app?",
    paraphrases: [
      "can i use it on my phone",
      "is there an ios or android app",
      "does it work on mobile",
      "is it a web app",
    ],
    answer:
      "Capital Q runs in the web browser. Whether there will be a dedicated phone app isn't in my sources, so I won't promise one; the founders can tell you.",
    sources: ["CLAUDE.md Repository Architecture (apps/web)"],
  },

  // ── Live, roadmap and the company ───────────────────────────────────
  {
    id: "qa.whats-live",
    side: "BOTH",
    question: "What is live today and what is still planned?",
    paraphrases: [
      "which parts of the demo are real",
      "what works right now",
      "is this a mockup",
      "what have you actually built that works today",
      "what is still in development",
    ],
    answer:
      "Each part of the product is marked in our certification record as live or not yet, and I describe it only that way. Recorded as live and verified on the product: matching, Discover, company profiles, diligence, documents, the CRM and pipeline, GateQ, my work for you and the Q Daily. Not yet certified: the spoken presentation, live video rehearsals and the full live-meeting journey. Illustrative moments in a story are illustrations, not product claims, and a rehearsal shown in a tour is a prepared exchange.",
    sources: [
      `${CERT} Q Pitch v6 certification`,
      `${CERT} Short of the v6 definition of done`,
    ],
  },
  {
    id: "qa.demo-data",
    side: "BOTH",
    question: "Are these real companies?",
    paraphrases: [
      "is the demo data real",
      "are the demo accounts fictional",
      "what is seeded in this demo",
      "are the companies fictional",
    ],
    answer:
      "No. The companies and investors in this demonstration are fictional and labelled as demonstration data. The product they run on is real.",
    sources: [`${INVESTOR_TOUR} opening`, `${FOUNDER_TOUR} opening`],
  },
  {
    id: "qa.roadmap",
    side: "BOTH",
    question: "What is on the roadmap?",
    paraphrases: [
      "what are you building after this",
      "what is the riskiest unbuilt piece",
      "what will the product look like in a year",
      "what features are planned",
    ],
    answer:
      "From the product record: certifying the spoken experience, verifying the full live-meeting journey, and a deeper paid Capital Readiness Blueprint on top of the free diagnosis. The order and timing are the founders' to set, so I'll leave dates to them.",
    sources: [
      `${CERT} Short of the v6 definition of done`,
      "docs/adr/0036-readiness-blueprint-and-plan-values.md",
    ],
  },
  {
    id: "qa.time-saved",
    side: "BOTH",
    question: "How much time does it actually save?",
    paraphrases: [
      "have you measured time saved",
      "how fast is the first useful result",
      "how many hours a week will i get back",
      "is it really minutes instead of months",
    ],
    answer:
      "The aim is minutes instead of months to find the right opportunity, but that hasn't been measured with real users yet, so I won't give you a number.",
    sources: [`${COVERAGE} LP-01`, `${LANDING} LP-01`],
  },
  {
    id: "qa.free",
    side: "BOTH",
    question: "Is Capital Q free to use?",
    paraphrases: [
      "what is free",
      "is the diagnosis free for founders",
      "which parts are paid",
      "what is the paid layer",
    ],
    answer:
      "The full diagnosis is free: the assessment, strengths, gaps, risks and what investors will be concerned about. The paid layer is deeper strategy and execution, such as a Capital Readiness Blueprint, with specialist human help optional on top. Price levels aren't set yet.",
    sources: [`${PADL} Decision #106`, `${PADL} Decision #85`],
  },
  {
    id: "qa.success-fee",
    side: "BOTH",
    question: "Do you take a fee when a round closes?",
    paraphrases: [
      "do you charge a success fee",
      "do you take a cut of deals",
      "are you paid on transactions",
      "is there a commission on investments",
    ],
    answer:
      "That isn't settled in my sources, so I won't state it. What is fixed is that no one can pay to rank higher, and the diagnosis stays free. The founders can speak to how FDN's own services are charged.",
    sources: [`${PADL} Decision #85`, `${PADL} Decision #106`],
  },
  {
    id: "qa.fdn",
    side: "BOTH",
    question: "What is FDN Capital Partners' role?",
    paraphrases: [
      "who is behind capital q",
      "how does fdn relate to the platform",
      "is there a human team behind q",
      "can i get human help",
    ],
    answer:
      "Capital Q comes from FDN Capital Partners, and its assessment framework is FDN's. FDN is also the optional human layer: specialist support where a company needs it, and human review when someone challenges an assessment. The founders can speak to FDN itself.",
    sources: [`${LANDING} LP-25, LP-33`, `${PADL} Decision #50`],
  },
  {
    id: "qa.off-platform",
    side: "BOTH",
    question: "What stops people taking the relationship off the platform?",
    paraphrases: [
      "won't they just exchange emails and leave",
      "why stay on capital q after a match",
      "do you need to keep both sides on the platform",
      "what keeps users coming back",
    ],
    answer:
      "Nothing forces them to stay, and Capital Q doesn't try to trap anyone. The reason to stay is that the relationship record, the documents, the meetings with my notes and the commitments live in one place both sides trust, and I keep the next step moving.",
    sources: [`${PADL} Decision #26`, `${INVESTOR_TOUR} relationship steps`],
  },
];
