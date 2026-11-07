import type { QNavSide, QNavSplit, QNavTarget } from "./contracts.js";
import {
  boardItem,
  type CaseSet,
  context,
  dataRoomDoc,
  deck,
  decide,
  dest,
  investorProfile,
  pick,
  profile,
  relationshipWithCompany,
  relationshipWithInvestor,
  section,
  thing,
  threadWithCompany,
  threadWithInvestor,
  turn,
  typo,
} from "./build.js";
import { Q_NAV_DESTINATIONS, sidesOf } from "./vocabulary.js";
import {
  company,
  Q_NAV_COMPANIES,
  Q_NAV_FOUNDER_COMPANY_KEY,
  investor,
  Q_NAV_INVESTORS,
  Q_NAV_THINGS,
} from "./world.js";

/**
 * The whole site, generated from vocabulary.ts (the contracts' every
 * destination and record page): each place, for each side that may open
 * it, by name and by an ask whose answer lives there; its sections; each
 * record page, tab, document, slide and thread; and, for the side that
 * may not, an honest STAY. The dev and held-out splits run the same
 * generator over different phrasing banks and sentence forms, written
 * separately (vocabulary `dev` / `heldout`, FORMS below).
 */

const FORMS: Readonly<Record<QNavSplit, readonly ((n: string) => string)[]>> = {
  dev: [
    (n) => `Open ${n}.`,
    (n) => `Take me to ${n}.`,
    (n) => `Show me ${n}.`,
    (n) => `Go to ${n}.`,
    (n) => `Pull up ${n}.`,
  ],
  heldout: [
    (n) => `Could you bring up ${n}?`,
    (n) => `I need ${n} on screen.`,
    (n) => `Let's look at ${n}.`,
    (n) => `Jump to ${n}, please.`,
    (n) => `Put ${n} up for me.`,
  ],
};

const form = (split: QNavSplit, seed: string, name: string): string => {
  const forms = FORMS[split];
  return (forms[pick(seed, forms.length)] ?? forms[0] ?? ((n) => n))(name);
};

/** Asks whose answer is one section of a page. */
const SECTION_ASKS: readonly {
  readonly page: string;
  readonly sectionId: string;
  readonly side: QNavSide;
  readonly dev: readonly string[];
  readonly heldout: readonly string[];
}[] = [
  {
    page: "CAPITAL",
    sectionId: "commitments",
    side: "INVESTOR",
    dev: [
      "How much have I invested so far?",
      "What have I committed this year?",
    ],
    heldout: ["What's my total cheque count so far?"],
  },
  {
    page: "COMPANY_INTEREST",
    sectionId: "deck-views",
    side: "FOUNDER",
    dev: [
      "Who's looked at my deck this week?",
      "Which investors opened my deck?",
    ],
    heldout: ["Has anybody been reading our deck?"],
  },
  {
    page: "OWN_DATA_ROOM",
    sectionId: "missing",
    side: "FOUNDER",
    dev: [
      "Is my data room ready for diligence?",
      "What's missing from my data room?",
    ],
    heldout: ["What would a diligence team find missing in our files?"],
  },
  {
    page: "WORK",
    sectionId: "approvals",
    side: "INVESTOR",
    dev: ["What's waiting for my approval?"],
    heldout: ["Anything I need to sign off on?"],
  },
  {
    page: "WORK",
    sectionId: "approvals",
    side: "FOUNDER",
    dev: ["What do I need to approve?"],
    heldout: ["Is anything blocked on my yes?"],
  },
  {
    page: "CAPITAL_RAISE",
    sectionId: "rounds",
    side: "FOUNDER",
    dev: ["Show me all my rounds."],
    heldout: ["List every round we've done, on screen."],
  },
];

/**
 * The settings sections in plain words (W2's site map). Usage, memory and
 * plan are their own routes; `settings` and `profile` are the page's top
 * and the profile summary, asked for as the page itself.
 */
const SETTINGS_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  account: ["account settings", "my account details"],
  team: ["team settings", "the people on my account"],
  appearance: ["appearance settings", "the dark mode setting"],
  q: ["Q settings", "how Q behaves"],
  speaking: ["voice settings", "Q's speaking voice"],
  notifications: ["notification settings", "my alerts"],
  connections: ["connections", "my connected accounts"],
  billing: ["billing", "my payment details"],
  privacy: ["privacy settings", "my privacy controls"],
  security: ["security settings", "my two-step sign-in"],
};

/**
 * Closed by the contract, yet the side has a page there: a founder's
 * Discover is its founders' videos tab, which has no destination (a W3
 * gap), so "open Discover" is no access question for them.
 */
const NO_ACCESS_CASE: readonly string[] = ["DISCOVER:FOUNDER"];

function destinations(cases: CaseSet): void {
  const split = cases.split;
  for (const def of Q_NAV_DESTINATIONS) {
    // A place the decision cannot name (a redirect-only page) is no MOVE.
    if (def.unreachable !== null) continue;
    const bank = def[split];
    for (const side of def.sides) {
      const { move } = decide(side);
      const target = dest(def.page);
      // Asked from somewhere else (from HOME, unless it is HOME).
      const from = {
        context: context({
          at: def.page === "HOME" ? dest("WORK") : dest("HOME"),
        }),
      };
      bank.names.forEach((name) => {
        cases.add("COVERAGE", side, [
          turn(
            form(split, `${def.page}${side}${name}`, name),
            move(target, `${def.page}, asked for by name.`),
            from,
          ),
        ]);
      });
      bank.asks.forEach((ask) => {
        cases.add("COVERAGE", side, [
          turn(ask, move(target, `The answer lives on ${def.page}.`), from),
        ]);
      });
      const [first] = bank.names;
      if (split === "dev" && first !== undefined) {
        cases.add("TYPO", side, [
          turn(
            typo(form(split, `typo${def.page}${side}`, first)),
            move(target, "A typo changes nothing."),
            from,
          ),
        ]);
      }
    }
    // The side that may not open it.
    for (const side of ["INVESTOR", "FOUNDER"] as const) {
      if (
        def.sides.includes(side) ||
        NO_ACCESS_CASE.includes(`${def.page}:${side}`)
      )
        continue;
      const [name] = bank.names;
      if (name === undefined) continue;
      const { stay } = decide(side);
      cases.add("ACCESS", side, [
        turn(
          form(split, `access${def.page}${side}`, name),
          stay(`${def.page} is not this person's page: say so, move nowhere.`),
        ),
      ]);
    }
  }
  // Sections.
  for (const s of SECTION_ASKS) {
    const { move } = decide(s.side);
    for (const ask of s[split]) {
      cases.add("COVERAGE", s.side, [
        turn(
          ask,
          move(
            section(s.page, s.sectionId),
            `The answer is a section of ${s.page}.`,
          ),
        ),
      ]);
    }
  }
  const words = Object.entries(SETTINGS_WORDS);
  words.forEach(([id, phrases], i) => {
    const side: QNavSide = i % 2 === 0 ? "INVESTOR" : "FOUNDER";
    const { move } = decide(side);
    const phrase = split === "dev" ? phrases[0] : phrases[1];
    cases.add("COVERAGE", side, [
      turn(
        form(split, `settings${id}`, phrase),
        move(section("SETTINGS", id), "A settings section, by name."),
      ),
    ]);
  });
}

type RecordAsk = {
  readonly side: QNavSide;
  readonly dev: (name: string) => string;
  readonly heldout: (name: string) => string;
  readonly target: (key: string) => QNavTarget;
  readonly why: string;
};

/** Company record asks; companies rotate so each ask meets several. */
const COMPANY_ASKS: readonly RecordAsk[] = [
  {
    side: "INVESTOR",
    dev: (n) => `Tell me about ${n}.`,
    heldout: (n) => `What's the story with ${n}?`,
    target: (k) => profile(k, "overview"),
    why: "About one company: its profile overview.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Show me ${n}'s pitch deck.`,
    heldout: (n) => `Can I flip through ${n}'s slides?`,
    target: (k) => deck(k),
    why: "A company's deck: profile, deck tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Open ${n}'s data room.`,
    heldout: (n) => `What documents has ${n} shared?`,
    target: (k) => profile(k, "dataroom"),
    why: "A company's data room tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Who's on ${n}'s team?`,
    heldout: (n) => `Who are the people behind ${n}?`,
    target: (k) => profile(k, "team"),
    why: "A company's team tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Open ${n}'s diligence tab.`,
    heldout: (n) => `Where's the diligence checklist for ${n}?`,
    target: (k) => profile(k, "diligence"),
    why: "A company's diligence tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Show me ${n}'s elevator pitch.`,
    heldout: (n) => `What's ${n}'s pitch in a sentence, on its profile?`,
    target: (k) => profile(k, "elevator"),
    why: "A company's elevator tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `What's ${n}'s ARR?`,
    heldout: (n) => `How much revenue is ${n} doing?`,
    target: (k) => profile(k, "overview"),
    // The site map has no financials section: the overview tab.
    why: "A company's figure lives on its overview tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `What is ${n} raising?`,
    heldout: (n) => `How big a round is ${n} after?`,
    target: (k) => profile(k, "overview"),
    why: "A company's raise lives on its overview tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `What evidence backs ${n}'s numbers?`,
    heldout: (n) => `What's ${n}'s proof for its figures?`,
    target: (k) => profile(k, "overview"),
    why: "A company's evidence lives on its overview tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Open ${n}'s cap table.`,
    heldout: (n) => `I'd like to read ${n}'s cap table.`,
    target: (k) => dataRoomDoc(k, "cap-table"),
    why: "A named data-room document.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Show me slide 4 of ${n}'s deck.`,
    heldout: (n) => `Go to the fourth slide in ${n}'s deck.`,
    target: (k) => deck(k, 4),
    why: "A deck slide.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Has ${n} replied?`,
    heldout: (n) => `Did ${n} get back to me?`,
    target: (k) => threadWithCompany(k),
    why: "The conversation: the thread, latest.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Show me my calls with ${n}.`,
    heldout: (n) => `When did I last speak to ${n}?`,
    target: (k) => relationshipWithCompany(k, "calls"),
    why: "The relationship's calls tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Open my diligence on ${n}.`,
    heldout: (n) => `Where am I on diligence with ${n}?`,
    target: (k) => relationshipWithCompany(k, "diligence"),
    why: "The relationship's diligence tab.",
  },
  {
    side: "INVESTOR",
    dev: (n) => `Rehearse a meeting with ${n}.`,
    heldout: (n) => `Let me practise my call with ${n}.`,
    target: (k) => ({ page: "COMPANY_REHEARSAL", recordId: company(k).id }),
    why: "A rehearsal with that company.",
  },
];

function records(cases: CaseSet): void {
  const split = cases.split;
  // Dev meets each ask with two companies, held-out with a third.
  const offsets = split === "dev" ? [0, 4] : [7];
  COMPANY_ASKS.forEach((ask, i) => {
    for (const offset of offsets) {
      const c = Q_NAV_COMPANIES[(i + offset) % Q_NAV_COMPANIES.length];
      if (c === undefined) continue;
      const { move } = decide(ask.side);
      cases.add(ask.why.includes("thread") ? "THREAD" : "RECORD", ask.side, [
        turn(ask[split](c.name), move(ask.target(c.key), ask.why)),
      ]);
    }
  });
  // A founder's records.
  const founder = decide("FOUNDER");
  const own = Q_NAV_FOUNDER_COMPANY_KEY;
  const investors =
    split === "dev" ? Q_NAV_INVESTORS.slice(0, 3) : Q_NAV_INVESTORS.slice(3);
  for (const inv of investors) {
    type Row = readonly [string, QNavTarget, string];
    const said: readonly Row[] =
      split === "dev"
        ? [
            [
              `Show me ${inv.name}'s profile.`,
              investorProfile(inv.key),
              "An investor's profile.",
            ],
            [
              `What did ${inv.short} ask me?`,
              threadWithInvestor(inv.key),
              "The conversation: the thread, latest.",
            ],
            [
              `Open my calls with ${inv.short}.`,
              relationshipWithInvestor(inv.key, "calls"),
              "The relationship's calls tab.",
            ],
            [
              `Rehearse my pitch to ${inv.short}.`,
              { page: "INVESTOR_REHEARSAL", recordId: inv.id },
              "A rehearsal with that investor.",
            ],
          ]
        : [
            [
              `Who exactly is ${inv.name}?`,
              investorProfile(inv.key),
              "An investor's profile.",
            ],
            [
              `Any word from ${inv.short}?`,
              threadWithInvestor(inv.key),
              "The conversation: the thread, latest.",
            ],
            [
              `Where's our diligence with ${inv.short} at?`,
              relationshipWithInvestor(inv.key, "diligence"),
              "The relationship's diligence tab.",
            ],
          ];
    for (const [user, target, why] of said) {
      cases.add(why.includes("thread") ? "THREAD" : "RECORD", "FOUNDER", [
        turn(user, founder.move(target, why)),
      ]);
    }
  }
  // An investor's profile is open to both sides (W2): a co-investor.
  const investorSide = decide("INVESTOR");
  const peers: readonly (readonly [string, string])[] =
    split === "dev"
      ? [
          ["inv-kestrel-lane", "Pull up Kestrel Lane's investor profile."],
          ["inv-baobab-ridge", "Who are Baobab Ridge, as a fund?"],
        ]
      : [
          [
            "inv-harbour-angels",
            "I'd like to size up Harbour Angels as a co-investor.",
          ],
        ];
  for (const [key, user] of peers) {
    cases.add("RECORD", "INVESTOR", [
      turn(
        user,
        investorSide.move(investorProfile(key), "Another investor's profile."),
      ),
    ]);
  }
  const ownAsks: readonly (readonly [string, QNavTarget, string])[] =
    split === "dev"
      ? [
          [
            "Show me my company profile as investors see it.",
            profile(own, "overview"),
            "Their own profile, as others see it.",
          ],
          [
            "Open the team tab on my public profile.",
            profile(own, "team"),
            "Their own profile's team tab.",
          ],
        ]
      : [
          [
            "How does our profile look from the outside?",
            profile(own, "overview"),
            "Their own profile, as others see it.",
          ],
          [
            "What do investors see in our data room tab?",
            profile(own, "dataroom"),
            "Their own profile's data room tab.",
          ],
        ];
  for (const [user, target, why] of ownAsks) {
    cases.add("RECORD", "FOUNDER", [turn(user, founder.move(target, why))]);
  }
  // Things of both sides: Q's documents, Daily editions, work, the board.
  const things: readonly (readonly [
    QNavSide,
    string,
    string,
    QNavTarget,
    string,
  ])[] = [
    [
      "INVESTOR",
      "Open the Silo Credit memo you wrote.",
      "Bring up that investment memo on Silo Credit.",
      thing("DOCUMENT", "memoSilo"),
      "One of Q's documents.",
    ],
    [
      "INVESTOR",
      "Open yesterday's Daily.",
      "What did the 5 November Daily say?",
      thing("DAILY_EDITION", "dailyYesterday"),
      "One Daily edition.",
    ],
    [
      "INVESTOR",
      "Open the Ledgerline diligence job.",
      "How's the Ledgerline diligence work going?",
      thing("WORK_ITEM", "workDiligence"),
      "One piece of Q's work.",
    ],
    [
      "INVESTOR",
      "Show me the 'call Tunde' card on my board.",
      "Where's my reminder to call Tunde on the board?",
      boardItem("boardCallTunde"),
      "One Board item.",
    ],
    [
      "INVESTOR",
      "Open the Brightwell Energy pitch video.",
      "Play me Brightwell Energy's pitch.",
      thing("COMPANY_PITCH", "pitchBrightwell"),
      "One pitch video.",
    ],
    [
      "FOUNDER",
      "Open the Ledgerline diligence brief.",
      "Bring up that brief on Ledgerline.",
      thing("DOCUMENT", "briefLedgerline"),
      "One of Q's documents.",
    ],
    [
      "FOUNDER",
      "Open my seed outreach job.",
      "How's the investor outreach going?",
      thing("WORK_ITEM", "workOutreach"),
      "One piece of Q's work.",
    ],
    [
      "FOUNDER",
      "Show me the 'chase legal' card on my board.",
      "Where's my legal reminder on the board?",
      boardItem("boardChaseLegal"),
      "One Board item.",
    ],
    [
      "FOUNDER",
      "Open today's Daily.",
      "What's in this morning's briefing?",
      thing("DAILY_EDITION", "dailyToday"),
      "One Daily edition.",
    ],
    [
      "FOUNDER",
      "Open my rehearsal with Dr Ifeoma Okoye.",
      "Let me redo the practice session with Dr Okoye.",
      thing("EXTERNAL_REHEARSAL", "rehearsalExternal"),
      "One external rehearsal.",
    ],
    [
      "INVESTOR",
      "Open my practice session with Dr Ifeoma Okoye.",
      "Re-run the rehearsal with Dr Okoye.",
      thing("EXTERNAL_REHEARSAL", "rehearsalExternal"),
      "One external rehearsal.",
    ],
    [
      "FOUNDER",
      "Watch the Brightwell Energy pitch video.",
      "Let me see how Brightwell Energy pitches on video.",
      thing("COMPANY_PITCH", "pitchBrightwell"),
      "One pitch video.",
    ],
    [
      "INVESTOR",
      "Open Tamarind Pay's application to my gate.",
      "Show me what Tamarind Pay submitted through GateQ.",
      thing("GATEQ_APPLICATION", "applicationTamarind"),
      "One GateQ application.",
    ],
    [
      "FOUNDER",
      "Open our application to Kestrel Lane's gate.",
      "Where's the application we sent through Kestrel Lane's GateQ?",
      thing("GATEQ_APPLICATION", "applicationOwn"),
      "One GateQ application.",
    ],
    [
      "FOUNDER",
      "Open our seed round.",
      "Bring up the seed round page.",
      // /capital only redirects, so the round has no page of its own to
      // name: it is a row of the raise tab's rounds (reported to W3).
      section("CAPITAL_RAISE", "rounds"),
      "Their round is listed on the raise tab's rounds.",
    ],
    [
      "FOUNDER",
      "Rehearse my pitch to Harbour Angels.",
      "I'd like to practise pitching Harbour Angels.",
      {
        page: "INVESTOR_REHEARSAL",
        recordId: investor("inv-harbour-angels").id,
      },
      "A rehearsal with that investor.",
    ],
  ];
  for (const [side, devSaid, heldSaid, target, why] of things) {
    if (!sidesOf(target.page).includes(side))
      throw new Error(`${target.page} closed to ${side}`);
    cases.add("RECORD", side, [
      turn(
        split === "dev" ? devSaid : heldSaid,
        decide(side).move(target, why),
      ),
    ]);
  }
  void Q_NAV_THINGS;
}

export function coverage(cases: CaseSet): void {
  destinations(cases);
  records(cases);
}
