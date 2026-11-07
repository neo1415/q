import {
  type CaseSet,
  context,
  dataRoomDoc,
  deck,
  decide,
  dest,
  HOME,
  investorProfile,
  ownMissing,
  profile,
  relationshipWithCompany,
  relationshipWithInvestor,
  team,
  threadWithCompany,
  threadWithInvestor,
  turn,
  type ExpectOptions,
  type TurnOptions,
} from "./build.js";
import type {
  QNavCategory,
  QNavExpect,
  QNavSide,
  QNavTarget,
} from "./contracts.js";
import { Q_NAV_FOUNDER_COMPANY_KEY } from "./world.js";

/**
 * Q-NAV fourth held-out split (batch 8, owner via integration, 7 Nov 2026).
 * Written after NAVIGATION_DECISION v10 by a separate author from the app
 * code only (what each page and tab lets a person see), never from the dev
 * phrasing, the prompt or an earlier held-out set. Its focus: placement
 * driven by the conversation (a record talked about, then a part of it;
 * follow-ups like "can I see it?"; pointing words) and tabs. Sealed
 * (heldout-seal.ts) before it is run; measured once.
 */

const I: QNavSide = "INVESTOR";
const F: QNavSide = "FOUNDER";

type Row = readonly [
  side: QNavSide,
  user: string,
  target: QNavTarget,
  why: string,
  options?: TurnOptions,
];

export function heldoutFourth(cases: CaseSet): void {
  const one = (
    category: QNavCategory,
    side: QNavSide,
    user: string,
    expect: QNavExpect,
    options: TurnOptions = {},
  ): void => {
    cases.add(category, side, [turn(user, expect, options)]);
  };
  const moves = (category: QNavCategory, rows: readonly Row[]): void => {
    for (const [side, user, target, why, options] of rows)
      one(category, side, user, decide(side).move(target, why), options);
  };
  const stays = (
    category: QNavCategory,
    rows: readonly (readonly [
      QNavSide,
      string,
      string,
      (TurnOptions & { readonly o?: ExpectOptions })?,
    ])[],
  ): void => {
    for (const [side, user, why, options] of rows)
      one(
        category,
        side,
        user,
        decide(side).stay(why, options?.o ?? {}),
        options,
      );
  };

  // --- The world, by short names --------------------------------------
  const SC = "co-silo-credit";
  const SH = "co-silo-health";
  const LL = "co-ledgerline";
  const BW = "co-brightwell";
  const BP = "co-brightpath";
  const KF = "co-kora-farms";
  const TP = "co-tamarind-pay";
  const QW = "co-quaywise";
  const NL = "co-nyota-learn";
  const OWN = Q_NAV_FOUNDER_COMPANY_KEY;
  const SS = "inv-savanna-seed";
  const KL = "inv-kestrel-lane";
  const BR = "inv-baobab-ridge";
  const HA = "inv-harbour-angels";

  const iv = decide(I);
  const fd = decide(F);
  const ov = (key: string): QNavTarget => profile(key, "overview");
  const doc = (key: string, kind: string): QNavTarget => dataRoomDoc(key, kind);
  /** The pane at a place (and, optionally, where it was before). */
  const at = (
    place: QNavTarget,
    over: Partial<Parameters<typeof context>[0]> = {},
  ) => ({ context: context({ at: place, ...over }) });
  const collapsed = (place: QNavTarget = HOME) =>
    at(place, { pane: "COLLAPSED" });

  type Step = readonly [
    user: string,
    expect: QNavExpect,
    options?: TurnOptions,
  ];
  const talk = (
    category: QNavCategory,
    side: QNavSide,
    steps: readonly Step[],
  ): void => {
    cases.add(
      category,
      side,
      steps.map(([user, expect, options]) => turn(user, expect, options)),
    );
  };

  // --- FOLLOW_UP: a record talked about, then a part of it ---------------
  talk("FOLLOW_UP", I, [
    [
      "tell me about kora farms",
      iv.move(ov(KF), "a record talked about opens on its overview"),
      { q: "Kora Farms works with smallholder growers. Their page is open." },
    ],
    [
      "who's on their team",
      iv.move(team(KF), "their = the company just discussed: its team tab"),
      { ...at(ov(KF), { previous: HOME }), q: "Here's the Kora Farms team." },
    ],
    [
      "and what about their deck?",
      iv.move(profile(KF, "deck"), "a follow-up part of the same record"),
      at(team(KF), { previous: ov(KF) }),
    ],
  ]);
  talk("FOLLOW_UP", I, [
    [
      "what does tamarind pay actually do",
      iv.stay("the record asked about is already on screen: answer in chat"),
      {
        ...at(ov(TP)),
        q: "Tamarind Pay runs merchant payments. It's on screen.",
      },
    ],
    [
      "ok can i see the elevator pitch",
      iv.move(
        profile(TP, "elevator"),
        "the elevator tab of the record on screen",
      ),
      at(ov(TP)),
    ],
  ]);
  talk("FOLLOW_UP", I, [
    [
      "how's quaywise freight doing these days",
      iv.move(ov(QW), "how a record is doing: its page, unasked"),
      { q: "Quaywise Freight's page is up; here's the short version." },
    ],
    [
      "do they have a cap table in there",
      iv.move(doc(QW, "cap-table"), "their = Quaywise: the cap table document"),
      at(ov(QW), { previous: HOME }),
    ],
    [
      "and the management accounts?",
      iv.move(doc(QW, "financials"), "the next document of the same data room"),
      at(doc(QW, "cap-table"), { previous: ov(QW) }),
    ],
  ]);
  talk("FOLLOW_UP", I, [
    [
      "remind me what nyota learn is about",
      iv.move(ov(NL), "a different record talked about: its overview"),
      { ...at(dest("SAVED")), q: "Nyota Learn builds tutoring for schools." },
    ],
    [
      "what's the diligence look like on them",
      iv.move(
        profile(NL, "diligence"),
        "them = Nyota Learn: its diligence tab",
      ),
      at(ov(NL), { previous: dest("SAVED") }),
    ],
  ]);
  talk("FOLLOW_UP", I, [
    [
      "anything new with ledgerline?",
      iv.move(ov(LL), "news about a record: its page"),
      { q: "A few updates on Ledgerline; their page is open." },
    ],
    [
      "can i see their data room",
      iv.move(profile(LL, "dataroom"), "their = Ledgerline: data room tab"),
      at(ov(LL), { previous: HOME }),
    ],
    [
      "open the customer contracts",
      iv.move(doc(LL, "contracts"), "a document in the data room just opened"),
      at(profile(LL, "dataroom"), { previous: ov(LL) }),
    ],
  ]);
  talk("FOLLOW_UP", I, [
    [
      "what's the story with brightpath logistics",
      iv.move(ov(BP), "a record talked about opens on its overview"),
      { q: "Brightpath Logistics runs last-mile delivery. Page is open." },
    ],
    [
      "who runs it",
      iv.move(team(BP), "who runs the company: its team tab"),
      at(ov(BP), { previous: HOME }),
    ],
    [
      "ok and slide 5 of their deck",
      iv.move(deck(BP, 5), "a slide of the same record's deck"),
      at(team(BP), { previous: ov(BP) }),
    ],
  ]);
  talk("FOLLOW_UP", I, [
    [
      "when did we last message kora farms",
      iv.move(threadWithCompany(KF), "our messages with a company: the thread"),
      { ...at(ov(KF)), q: "Your last message to Kora Farms was last week." },
    ],
    [
      "and our calls with them?",
      iv.move(
        relationshipWithCompany(KF, "calls"),
        "the same relationship's calls tab",
      ),
      at(threadWithCompany(KF), { previous: ov(KF) }),
    ],
  ]);
  talk("FOLLOW_UP", F, [
    [
      "tell me about kestrel lane",
      fd.move(investorProfile(KL), "an investor talked about: their page"),
      { q: "Kestrel Lane Ventures backs seed fintech. Their page is open." },
    ],
    [
      "have we messaged them yet",
      fd.move(threadWithInvestor(KL), "them = Kestrel Lane: our thread"),
      at(investorProfile(KL), { previous: HOME }),
    ],
    [
      "and what did they ask for in diligence",
      fd.move(
        relationshipWithInvestor(KL, "diligence"),
        "what they asked for: the relationship's diligence tab",
      ),
      at(threadWithInvestor(KL), { previous: investorProfile(KL) }),
    ],
  ]);
  talk("FOLLOW_UP", F, [
    [
      "what's baobab ridge like as an investor",
      fd.move(investorProfile(BR), "an investor talked about: their page"),
      { q: "Baobab Ridge Capital writes larger seed cheques." },
    ],
    [
      "where's the deal at with them",
      fd.move(
        relationshipWithInvestor(BR, "deal"),
        "the deal with the investor just discussed",
      ),
      at(investorProfile(BR), { previous: HOME }),
    ],
  ]);
  talk("FOLLOW_UP", F, [
    [
      "do we have a call booked with them",
      fd.move(
        relationshipWithInvestor(SS, "calls"),
        "them = the investor on screen: calls with them",
      ),
      {
        ...at(investorProfile(SS)),
        q: "Nothing booked with Savanna Seed yet.",
      },
    ],
    [
      "show me my deck before i book one",
      fd.move(profile(OWN, "deck"), "my = the founder's own company deck"),
      at(relationshipWithInvestor(SS, "calls"), {
        previous: investorProfile(SS),
      }),
    ],
  ]);
  talk("FOLLOW_UP", F, [
    [
      "tell me about them",
      fd.stay("the investor asked about is already on screen"),
      { ...at(investorProfile(SS)), q: "Savanna Seed Partners invest early." },
    ],
    [
      "now open my data room",
      fd.move(profile(OWN, "dataroom"), "my = own company, never the screen"),
      at(investorProfile(SS)),
    ],
  ]);
  talk("FOLLOW_UP", F, [
    [
      "anything new from harbour angels",
      fd.move(investorProfile(HA), "news about an investor: their page"),
      { q: "Harbour Angels posted a new focus note. Their page is open." },
    ],
    [
      "did they reply to my last message",
      fd.move(threadWithInvestor(HA), "their reply: the thread with them"),
      at(investorProfile(HA), { previous: HOME }),
    ],
    [
      "and the deal side, did they send terms",
      fd.move(
        relationshipWithInvestor(HA, "deal"),
        "terms with the same investor: the deal tab",
      ),
      at(threadWithInvestor(HA), { previous: investorProfile(HA) }),
    ],
  ]);
  talk("FOLLOW_UP", I, [
    [
      "how do kora's numbers compare with brightwell's",
      iv.stay("a comparison made for the question: answered in chat"),
      { ...at(ov(KF)), q: "Kora grows faster; Brightwell has better margins." },
    ],
    [
      "ok show me brightwell then",
      iv.move(ov(BW), "the other record of the comparison, asked for"),
      at(ov(KF)),
    ],
  ]);
  moves("FOLLOW_UP", [
    [
      I,
      "open the deck",
      profile(BW, "deck"),
      "no record named: the one on screen",
      at(ov(BW)),
    ],
    [
      F,
      "open the team tab",
      team(OWN),
      "the tab of the founder's own page on screen",
      at(ov(OWN)),
    ],
  ]);

  // --- LOOKALIKE_MOVE: sounds like chat, is about a record --------------
  moves("LOOKALIKE_MOVE", [
    [
      I,
      "been meaning to ask, how is silo health getting on?",
      ov(SH),
      "how a record is doing: its page",
      at(HOME),
    ],
    [
      I,
      "curious who actually runs tamarind pay",
      team(TP),
      "another record's people: its team tab",
      at(ov(KF)),
    ],
    [
      F,
      "wonder what harbour angels are all about",
      investorProfile(HA),
      "musing about an investor: their page",
      at(HOME),
    ],
    [
      I,
      "hmm what's going on with kora farms",
      ov(KF),
      "the conversation turns to another record",
      at(ov(BW)),
    ],
    [
      F,
      "tell me about savanna seed partners",
      investorProfile(SS),
      "a different investor than the one on screen",
      at(investorProfile(KL)),
    ],
    [
      F,
      "remind me who's at baobab ridge",
      investorProfile(BR),
      "who's at an investor: their page",
      at(profile(OWN, "deck")),
    ],
  ]);
  talk("LOOKALIKE_MOVE", I, [
    [
      "is their burn worrying?",
      iv.stay("a judgement on the record on screen: answered in chat"),
      {
        ...at(ov(TP)),
        q: "It's high for their stage, but they raised recently.",
      },
    ],
    [
      "fine. how's nyota learn doing anyway",
      iv.move(ov(NL), "the conversation moves to another record"),
      at(ov(TP)),
    ],
  ]);

  // --- RECORD: a record's tab named outright ------------------------------
  moves("RECORD", [
    [
      I,
      "pull up silo credit's data room",
      profile(SC, "dataroom"),
      "a record's data room tab",
      at(HOME),
    ],
    [
      I,
      "brightwell's elevator pitch pls",
      profile(BW, "elevator"),
      "a record's elevator tab",
      at(HOME),
    ],
    [
      I,
      "kora farms team page",
      team(KF),
      "another record's team tab",
      at(ov(QW)),
    ],
    [
      I,
      "slide 2 of nyota's deck",
      deck(NL, 2),
      "a slide of a record's deck",
      at(dest("SAVED")),
    ],
    [
      F,
      "take me to the ledgerfold deck so i can check slide order",
      profile(OWN, "deck"),
      "own company by name: deck tab",
      at(HOME),
    ],
    [
      F,
      "let me see the diligence brief on my own company",
      profile(OWN, "diligence"),
      "my own company's diligence tab, not the investor on screen",
      at(investorProfile(BR)),
    ],
    [
      F,
      "show me my team",
      team(OWN),
      "my = the founder, never the investor on screen",
      at(investorProfile(BR)),
    ],
  ]);

  // --- NOT_THAT_ONE ---------------------------------------------------------
  talk("NOT_THAT_ONE", I, [
    [
      "open silo credit's deck",
      iv.move(profile(SC, "deck"), "a record's deck by name"),
    ],
    [
      "no sorry, silo health's",
      iv.move(profile(SH, "deck"), "the other record, same tab"),
      at(profile(SC, "deck"), { previous: HOME }),
    ],
  ]);
  talk("NOT_THAT_ONE", I, [
    [
      "their documents",
      iv.move(profile(KF, "dataroom"), "documents of the record on screen"),
      at(ov(KF)),
    ],
    [
      "not the files, the people",
      iv.move(team(KF), "same record, the other tab meant"),
      at(profile(KF, "dataroom"), { previous: ov(KF) }),
    ],
  ]);
  talk("NOT_THAT_ONE", F, [
    ["open kestrel lane", fd.move(investorProfile(KL), "an investor by name")],
    [
      "wrong one, i meant baobab",
      fd.move(investorProfile(BR), "the other investor meant"),
      at(investorProfile(KL), { previous: HOME }),
    ],
  ]);
  talk("NOT_THAT_ONE", I, [
    ["tell me about brightwell", iv.move(ov(BW), "a record talked about")],
    [
      "not brightwell, brightpath. the logistics one",
      iv.move(ov(BP), "the lookalike name corrected"),
      at(ov(BW), { previous: HOME }),
    ],
  ]);
  talk("NOT_THAT_ONE", I, [
    ["open quaywise's team", iv.move(team(QW), "a record's team tab")],
    [
      "actually the deck not the team",
      iv.move(profile(QW, "deck"), "same record, the tab corrected"),
      at(team(QW), { previous: HOME }),
    ],
  ]);

  // --- STALE_CONTEXT: they moved the pane themselves ----------------------
  talk("STALE_CONTEXT", I, [
    ["how's kora farms", iv.move(ov(KF), "how a record is doing")],
    [
      "ok and their deck?",
      iv.move(
        profile(KF, "deck"),
        "their = Kora (the conversation); the pane shows no record",
      ),
      at(dest("SAVED"), { previous: ov(KF) }),
    ],
  ]);
  talk("STALE_CONTEXT", F, [
    [
      "tell me about harbour angels",
      fd.move(investorProfile(HA), "an investor talked about"),
    ],
    [
      "what did they want in diligence",
      fd.move(
        relationshipWithInvestor(HA, "diligence"),
        "they = Harbour Angels from the conversation, not the own page they moved to",
      ),
      at(ov(OWN), { previous: investorProfile(HA) }),
    ],
  ]);
  talk("STALE_CONTEXT", I, [
    ["open tamarind's team", iv.move(team(TP), "a record's team tab")],
    [
      "show me the elevator thing too",
      iv.move(
        profile(TP, "elevator"),
        "the conversation's record, after they went home",
      ),
      at(HOME, { previous: team(TP) }),
    ],
  ]);
  talk("STALE_CONTEXT", I, [
    ["tell me about silo credit", iv.move(ov(SC), "a record talked about")],
    [
      "what about silo health",
      iv.move(ov(SH), "a new record named, wherever they wandered"),
      at(ov(KF), { previous: ov(SC) }),
    ],
  ]);

  // --- AMBIGUITY: ask, never guess ---------------------------------------
  talk("AMBIGUITY", I, [
    [
      "open silo",
      iv.stay("two records called Silo: ask which"),
      { q: "Silo Credit or Silo Health?" },
    ],
    ["health", iv.move(ov(SH), "the answer to the question settles it")],
  ]);
  talk("AMBIGUITY", I, [
    [
      "compare silo credit and kora farms on revenue",
      iv.stay("a comparison: answered in chat"),
      { q: "Kora Farms is ahead on revenue; Silo Credit is growing faster." },
    ],
    [
      "show me their deck",
      iv.stay("two records in the conversation: ask which"),
    ],
  ]);
  stays("AMBIGUITY", [
    [I, "can i see it?", "a pointing word with nothing to point at"],
    [
      F,
      "open that one",
      "a pointing word on a list, nothing picked",
      at(dest("INVESTORS")),
    ],
    [
      I,
      "what's in silo's data room",
      "two records called Silo: ask which",
      at(dest("SAVED")),
    ],
  ]);

  // --- COLLAPSED_PANE -----------------------------------------------------
  talk("COLLAPSED_PANE", I, [
    [
      "how's ledgerline doing",
      iv.stay("a question with the pane collapsed: remember the place", {
        remembered: ov(LL),
      }),
      { ...collapsed(), q: "Ledgerline is steady. Want to see their page?" },
    ],
    [
      "ok show me",
      iv.move(ov(LL), "an explicit ask to see opens the pane", {
        openPane: true,
      }),
      collapsed(),
    ],
  ]);
  talk("COLLAPSED_PANE", I, [
    [
      "tell me about quaywise",
      iv.stay("a question behind a collapsed pane", { remembered: ov(QW) }),
      { ...collapsed(), q: "Quaywise Freight moves cargo inland." },
    ],
    [
      "and their cap table?",
      iv.stay("still a question: the document is remembered", {
        remembered: doc(QW, "cap-table"),
      }),
      { ...collapsed(), q: "Founders hold most of it." },
    ],
    [
      "let me see it",
      iv.move(doc(QW, "cap-table"), "it = the cap table: open the pane there", {
        openPane: true,
      }),
      collapsed(),
    ],
  ]);
  talk("COLLAPSED_PANE", F, [
    [
      "what's still missing from my data room",
      fd.stay("a question behind a collapsed pane", {
        remembered: ownMissing(),
      }),
      { ...collapsed(ov(OWN)), q: "A cap table and customer contracts." },
    ],
    [
      "pull it up",
      fd.move(ownMissing(), "an ask to see what's missing opens the pane", {
        openPane: true,
      }),
      collapsed(ov(OWN)),
    ],
  ]);
  one(
    "COLLAPSED_PANE",
    I,
    "who's on their team",
    iv.stay("a question about the record on the collapsed pane", {
      remembered: team(KF),
    }),
    collapsed(ov(KF)),
  );
  one(
    "COLLAPSED_PANE",
    F,
    "open kestrel lane's page",
    fd.move(investorProfile(KL), "an explicit ask opens the pane", {
      openPane: true,
    }),
    collapsed(),
  );
  one(
    "COLLAPSED_PANE",
    I,
    "show me their elevator pitch",
    iv.move(profile(TP, "elevator"), "an ask to see on a collapsed pane", {
      openPane: true,
    }),
    collapsed(ov(TP)),
  );

  // --- DIRTY_FORM and BUSY_PANE: offer, never pull the page away ----------
  one(
    "DIRTY_FORM",
    F,
    "tell me about baobab ridge",
    fd.offer(investorProfile(BR), "unsaved profile edits: offer the investor"),
    at(ov(OWN), { dirty: true }),
  );
  talk("DIRTY_FORM", I, [
    [
      "how's kora farms doing",
      iv.offer(ov(KF), "a draft in the thread: offer, don't move"),
      {
        ...at(threadWithCompany(TP), { dirty: true }),
        q: "Kora is on plan. Open their page?",
      },
    ],
    [
      "fine, open their data room",
      iv.offer(
        profile(KF, "dataroom"),
        "still unsaved: even an ask is an offer",
      ),
      at(threadWithCompany(TP), { dirty: true }),
    ],
  ]);
  one(
    "DIRTY_FORM",
    F,
    "show me my deck",
    fd.offer(profile(OWN, "deck"), "an unsent draft to Kestrel Lane: offer"),
    at(threadWithInvestor(KL), { dirty: true }),
  );
  one(
    "BUSY_PANE",
    I,
    "tell me about brightwell energy",
    iv.offer(ov(BW), "they're scrolling the pane: offer"),
    at(ov(NL), { busy: "SCROLLING" }),
  );
  one(
    "BUSY_PANE",
    F,
    "when's our next call with them",
    fd.offer(
      relationshipWithInvestor(SS, "calls"),
      "typing in the thread: offer the calls tab",
    ),
    at(threadWithInvestor(SS), { busy: "TYPING" }),
  );
  one(
    "BUSY_PANE",
    I,
    "and their team?",
    iv.offer(team(KF), "scrolling the data room: offer the team tab"),
    at(profile(KF, "dataroom"), { busy: "SCROLLING" }),
  );
  one(
    "BUSY_PANE",
    F,
    "tell me about savanna seed",
    fd.offer(investorProfile(SS), "typing in the data room: offer"),
    at(profile(OWN, "dataroom"), { busy: "TYPING" }),
  );

  // --- STAY_IN_CHAT and LOOKALIKE_STAY -----------------------------------
  talk("STAY_IN_CHAT", I, [
    [
      "compare their burn to tamarind's",
      iv.stay("a comparison made for the question"),
      { ...at(ov(KF)), q: "Kora burns less each month than Tamarind Pay." },
    ],
    [
      "which of the two has the stronger team",
      iv.stay("still a comparison: answered in chat"),
      at(ov(KF)),
    ],
  ]);
  stays("STAY_IN_CHAT", [
    [
      I,
      "list the companies i've saved that are in agritech",
      "a list made for the question",
    ],
    [
      F,
      "how should i pitch to them on the first call",
      "advice: answered in chat",
      at(investorProfile(KL)),
    ],
    [
      I,
      "what's a typical seed valuation in kenya right now",
      "general knowledge",
      at(ov(BW)),
    ],
    [
      F,
      "what can you dig up about me on the web",
      "research Q is asked to do: me = the founder",
      at(ov(OWN)),
    ],
    [
      I,
      "look up nyota learn's founders for me, anything in the press",
      "outside research Q does in chat",
      at(team(TP)),
    ],
    [
      F,
      "which investors are most likely to lead our seed?",
      "a shortlist made for the question",
    ],
  ]);
  stays("LOOKALIKE_STAY", [
    [
      I,
      "what makes a good team slide in a deck generally",
      "general advice about decks",
      at(ov(KF)),
    ],
    [
      F,
      "should my data room have a cap table this early",
      "advice, not a page",
      at(profile(OWN, "deck")),
    ],
    [
      I,
      "what do people usually ask for in diligence on a series a",
      "general knowledge",
    ],
  ]);

  // --- TWO_ASKS -----------------------------------------------------------
  moves("TWO_ASKS", [
    [
      I,
      "tell me what kora farms does and open their data room",
      profile(KF, "dataroom"),
      "a question plus a place: the place asked for",
    ],
    [
      F,
      "summarise kestrel lane for me and pull up our messages with them",
      threadWithInvestor(KL),
      "a summary in chat, the thread on the pane",
    ],
    [
      I,
      "compare their margins to quaywise, then open quaywise's deck",
      profile(QW, "deck"),
      "comparison in chat, the named deck on the pane",
      at(ov(LL)),
    ],
  ]);

  // --- VOICE --------------------------------------------------------------
  const voice = { modality: "VOICE" } as const;
  talk("VOICE", I, [
    [
      "um so how is brightpath doing",
      iv.move(ov(BP), "spoken: a record's page"),
      voice,
    ],
    [
      "can you show me their people",
      iv.move(team(BP), "their people: the team tab"),
      { ...voice, ...at(ov(BP), { previous: HOME }) },
    ],
  ]);
  talk("VOICE", I, [
    [
      "tell me about uh tamarind pay",
      iv.move(ov(TP), "spoken: a record talked about"),
      voice,
    ],
    [
      "yeah show me the deck",
      iv.move(profile(TP, "deck"), "the deck of the record just discussed"),
      { ...voice, ...at(ov(TP), { previous: HOME }) },
    ],
  ]);
  one(
    "VOICE",
    F,
    "open up my elevator pitch",
    fd.move(
      profile(OWN, "elevator"),
      "my = own company, not the investor on screen",
    ),
    { ...voice, ...at(investorProfile(HA)) },
  );

  // --- TYPO ---------------------------------------------------------------
  moves("TYPO", [
    [I, "how is kora frams going", ov(KF), "a misspelt record name"],
    [
      I,
      "open thier dataroom",
      profile(SC, "dataroom"),
      "misspelt pointing word: the record on screen",
      at(ov(SC)),
    ],
    [
      F,
      "tell me abt kestral lane",
      investorProfile(KL),
      "a misspelt investor name",
    ],
    [
      I,
      "whos on there teem",
      team(NL),
      "misspelt: the team of the record on screen",
      at(ov(NL)),
    ],
  ]);

  // --- ACCESS and DELETED_RECORD: nothing to open -------------------------
  stays("ACCESS", [
    [
      F,
      "show me the companies kestrel has saved",
      "another side's saved list is not the founder's to open",
      at(investorProfile(KL)),
    ],
    [
      I,
      "can i see the list of investors founders get",
      "the founders' investor list is closed to investors",
      at(ov(KF)),
    ],
  ]);
  stays("DELETED_RECORD", [
    [I, "how's harrow mills doing", "a deleted record is never a target"],
  ]);
  talk("DELETED_RECORD", I, [
    [
      "tell me about harrow mills",
      iv.stay("a deleted record: say so, don't move"),
      { ...at(ov(KF)), q: "Harrow Mills was removed from Capital Q." },
    ],
    [
      "ok then kora's deck",
      iv.move(profile(KF, "deck"), "back to a live record's deck"),
      at(ov(KF)),
    ],
  ]);
}
