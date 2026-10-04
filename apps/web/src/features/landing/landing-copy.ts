/**
 * Every word on the landing page, in StoryBrand order
 * (docs/handoff/demo/landing-storybrand.md).
 *
 * Kept as data so one test can hold the whole page to the claims we may
 * make (docs/handoff/demo/industry-comparison.md): the five defensible
 * claims, labelled illustrations, and none of the "do not claim" list.
 */

export const SIGN_UP_HREF = "/auth/sign-up";
export const SIGN_IN_HREF = "/auth/sign-in";
export const GATEQ_ANCHOR = "try-gateq";
export const WATCH_ANCHOR = "watch-q-work";

export const HERO = {
  title: "Private capital, on evidence.",
  oneLiner:
    "Founders raising and investors deploying lose months to noise. Q reads the evidence, prepares the next step, and acts only when you approve, so the right relationships move forward.",
  primary: "Get started",
  primaryNote: "For founders and investors",
  secondary: "Try GateQ",
  tertiary: "See how Q works",
} as const;

export const PROBLEM = {
  title: "The way capital meets companies is noisy.",
  sides: [
    {
      who: "If you're raising",
      external:
        "Visibility follows who you know and what you can pay. Decks go out as attachments, and most of them go nowhere.",
      internal:
        "You can't tell whether anyone read it, or why the answer was silence.",
    },
    {
      who: "If you're investing",
      external:
        "Claims, opinions and numbers arrive mixed together, and every tool keeps its own version of where things stand.",
      internal:
        "You can't tell what's supported, what's claimed, and what you're missing.",
    },
  ],
  philosophical:
    "A good company shouldn't have to buy its way to the top of a list. A capital decision deserves evidence before opinion.",
} as const;

export const GUIDE = {
  title: "Meet Q. An analyst on your side, not an autopilot.",
  empathy:
    "We built Capital Q because both sides deserve better than warm intros and spreadsheets. Q works for you, and it shows its working.",
  claims: [
    {
      title: "Ranking can't be bought.",
      body: "Companies are ordered by declared mandate, fit, evidence and freshness, in a versioned ranking. There is no paid placement, and views or watch time are never ranking inputs.",
    },
    {
      title: "Evidence before opinion.",
      body: "Every fact shows who stated it and how well it is supported. Unknown stays unknown, never zero, and Q's inferences are labelled as inferences.",
    },
    {
      title: "Prepare, approve, act.",
      body: "Q prepares the action and shows exactly what will be sent, and to whom. Nothing happens until you approve that exact payload. Change it, and it comes back to you.",
    },
    {
      title: "One shared record.",
      body: "Exactly one record for each company and investor. Both sides read the same history, and its stage is computed from what happened, never edited by hand or decided by a model.",
    },
    {
      title: "A firewall on founder-private data.",
      body: "What a founder keeps private is filtered out before Q or the ranking sees it for an investor. It never silently changes what an investor is shown.",
    },
  ],
} as const;

export const PLAN = {
  title: "Three steps. Q does the heavy lifting.",
  steps: [
    {
      title: "Tell Q what you have",
      founder: "Upload the deck and documents you already have.",
      investor: "Describe your mandate in a few minutes.",
    },
    {
      title: "Q works first",
      founder:
        "See what's known about your company and how well it's supported, then fill the gaps that matter.",
      investor:
        "See companies ordered by fit and evidence, each with the reasons it's there.",
    },
    {
      title: "You approve, Q acts",
      founder:
        "Introductions and follow-ups arrive as cards. Approve the exact message, and only then is it sent.",
      investor:
        "Replies, passes and next steps are prepared for you. Nothing goes out until you approve it.",
    },
  ],
} as const;

export const WATCH = {
  title: "Watch Q work",
  intro:
    "A standing instruction, in plain words. Q prepares every step and brings each one back to you.",
  label: "Illustration. A scripted example, not a live session.",
  ask: "Handle it for me, except Nixo.",
  working: "Preparing your introductions. Nixo is left out, as you asked.",
  card: {
    heading: "Approve this message",
    to: "To: Adaeze Bello, Partner, Harbour Lane Ventures",
    subject: "Introduction: Fennel Pay, seed round",
    body: "Hi Adaeze, Fennel Pay is raising a $1.2M seed to expand merchant payments in Lagos and Nairobi. It matches the payments focus in your mandate. Would a 20-minute call next week be useful?",
    note: "You approve this exact message. If it changes, it comes back for approval.",
    approve: "Approve and send",
    edit: "Edit",
  },
  done: "Sent, and recorded once on the shared relationship history.",
  replay: "Replay",
  names: "Names in this illustration are fictional.",
} as const;

export const GATEQ = {
  title: "Try GateQ: am I a fit?",
  intro:
    "GateQ is an investor's front door. Answer four questions and the same engine Capital Q runs checks them against a published policy. It's deterministic: the same answers always give the same result.",
  privacy:
    "Runs entirely in your browser. Nothing you enter is sent or saved, and no AI model is involved.",
  unknownNote:
    "Skip any question. A skipped answer is unknown, and unknown is not a no.",
  submit: "Check my fit",
  reset: "Start again",
  cta: "Get your own Q",
  ctaNote:
    "Inside Capital Q, the same single Q runs GateQ for every investor you approach.",
} as const;

export const SUCCESS = {
  title: "What it looks like when it works",
  stories: [
    {
      who: "A founder",
      body: "You know which investors fit before you write to them. Your profile shows what's supported and what's still open. Every introduction went out because you approved it, and each conversation lives on one record you and the investor both read.",
    },
    {
      who: "An investor",
      body: "Your feed is ordered by your mandate and the evidence, never by who paid. You see why each company is there and what's unknown. Passes and replies are prepared for you, and your private notes stay with your organisation.",
    },
  ],
  label: "Illustrative outcomes, not customer quotes.",
} as const;

export const FAILURE = {
  title: "What it costs to keep doing it the old way",
  items: [
    "Months of outreach to investors who were never going to fit.",
    "Good companies missed because they didn't have a warm introduction.",
    "Absent data read as a bad sign, when nobody had asked.",
    "An assistant sending something you never saw.",
    "Three versions of where a relationship stands, none of them right.",
  ],
} as const;

export const REHEARSAL = {
  title: "Rehearse the call before it counts.",
  body: "Practise a first investor conversation out loud with Q, whenever you want, and get a scored review of how it went. Better a hard question in rehearsal than in the room.",
  cta: "Get started",
} as const;

export const FAQ = {
  title: "Questions",
  items: [
    {
      q: "Is Capital Q a marketplace or a CRM?",
      a: "Neither. It's investment intelligence: Q helps founders and investors reach a capital objective, with evidence, and keeps one shared record of each relationship.",
    },
    {
      q: "Can anyone pay to rank higher?",
      a: "No. The order is set by a deterministic, versioned ranking of declared mandate, fit, evidence and freshness. There's no paid placement, and views or clicks are never ranking inputs.",
    },
    {
      q: "Will Q send things without asking me?",
      a: "No. Q prepares the action and shows you exactly what will be sent and to whom. It happens only after you approve that exact version, and any change needs a fresh approval.",
    },
    {
      q: "Who sees what I keep private?",
      a: "Only the people you choose. Founder-private information is filtered out before Q or the ranking sees it for an investor, and each side's private notes stay private unless that side shares them.",
    },
    {
      q: "What does 'unknown' mean?",
      a: "That nobody has said yet. Capital Q never turns a missing answer into a zero or a black mark; it lowers confidence and stays visible as an open question.",
    },
    {
      q: "Is GateQ a separate product?",
      a: "No. GateQ is how an investor publishes what they're open to. It runs on the same deterministic engine and the same single Q as the rest of Capital Q.",
    },
    {
      q: "Does Capital Q verify identities?",
      a: "Capital Q checks organisation and domain claims. It doesn't perform regulated identity checks such as KYC or AML.",
    },
  ],
} as const;

export const FINAL = {
  title: "Bring the evidence. Q will do the rest, with your approval.",
  primary: "Get started",
  secondary: "Sign in",
} as const;

export const FOOTER = {
  line: "Investment intelligence for private capital.",
  copyright: "© 2026 Capital Q",
} as const;
