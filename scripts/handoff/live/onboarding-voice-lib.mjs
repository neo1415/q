// Pure parts of the voice onboarding e2e (onboarding-voice-e2e.mjs): which
// spoken answer a line of Q's gets, and what the stored conversation shows.
// No network, no browser: checked offline with CQ_VOICE_E2E_SELFTEST=1.

/** The question Q put: its last sentence ending "?", else the line. */
export const questionOf = (line) => {
  const asks = String(line).match(/[^.?!]*\?/gu);
  return asks === null ? String(line) : asks[asks.length - 1];
};

/**
 * Investor answers, spoken. Most specific first; a confirmation first of
 * all (owner 9 Nov: any agreement is a yes). The firm is in Doha (the
 * owner's client), so the country must save as Qatar from a city.
 */
export const INVESTOR_ANSWERS = [
  [
    /(\bis that right|\bshall i keep\b[^?]*|\bcorrect|\bright)\?\s*$/i,
    "Yep, that's very correct.",
  ],
  [/\bwhy\b/i, "Mostly speed. They move faster."],
  [
    /\bactively\b|writing cheques|writing checks|\bdeploying\b/i,
    "Yes, we're actively investing.",
  ],
  [
    /smallest|minimum|typical|largest|maximum|cheque|check size|ticket/i,
    "Our smallest cheque is 250 thousand dollars, typically 500 thousand, and at most 1 million.",
  ],
  [
    /based|headquarter|where is (the|your) firm|which country|located/i,
    "We're based in Doha.",
  ],
  [
    /what kind of investor|type of investor|angel|family office|fund\b/i,
    "We're a venture capital fund.",
  ],
  [
    /name of (the|your) firm|firm called|firm's name|what's the firm/i,
    "Kestrel Bay Capital.",
  ],
  [/website|web address|site\b/i, "kestrelbay dot example."],
  [/your role|title|position/i, "I'm a partner."],
  [/currency/i, "US dollars."],
  [/lead|co-?invest|follow/i, "We lead and co-invest."],
  [/how firm|must|strong preference|nice to have/i, "A strong preference."],
  [/stage/i, "Pre-seed and seed."],
  [/where do you invest|geograph|region|markets/i, "West Africa and the Gulf."],
  [/sector|industr/i, "Fintech and climate."],
  [/off the table|rather not see|avoid|exclu|never/i, "Nothing really, none."],
  [
    /company fits|business model|customer|revenue|capital|regulat/i,
    "No preference.",
  ],
  [
    /lean in|founder|green flag|look for/i,
    "Repeat founders and capital efficiency.",
  ],
  [/portfolio/i, "None yet."],
  [/inbound|reach out|approach/i, "Only well-matched founders."],
  [
    /describe|own words|thesis|in a line/i,
    "We back early fintech and climate companies in West Africa and the Gulf.",
  ],
  [
    /anything else|anything more|finish|wrap up/i,
    "No, that's everything. Please finish.",
  ],
];

export const answerFor = (line) => {
  const q = questionOf(line);
  const hit = INVESTOR_ANSWERS.find(([re]) => re.test(q));
  return hit === undefined ? null : hit[1];
};

/** Topics whose question must not be asked more than twice (D77). */
export const TOPICS = {
  country:
    /based|headquarter|which country|located|in the (us|uk)|united states/i,
  deployment: /actively|deploying|writing (cheques|checks)/i,
  cheques: /smallest|minimum|typical|largest|maximum|cheque size|check size/i,
};

/** A stored Q line cut mid-sentence: no closing punctuation. */
export const cutOff = (text) => !/[.?!…"')\]]\s*$/u.test(String(text).trim());

/** What the stored thread shows: cut Q lines and topics asked too often. */
export function analyse(turns) {
  const q = turns.filter((t) => t.role === "Q").map((t) => String(t.text));
  const cut = q.filter(cutOff);
  const asked = Object.fromEntries(
    Object.entries(TOPICS).map(([topic, re]) => [
      topic,
      q.filter((line) => re.test(questionOf(line)) && /\?/u.test(line)).length,
    ]),
  );
  return { qLines: q.length, cut, asked };
}

/** Offline self-check against session 12a0275a's own lines. */
export function selfTest() {
  const cases = [
    ["And the firm is based where?", "We're based in Doha."],
    ["Are you actively investing right now?", "Yes, we're actively investing."],
    [
      "And on cheque sizes, what's the smallest you'd write?",
      "Our smallest cheque",
    ],
    [
      "Just to place you, you're in the United States, right?",
      "Yep, that's very correct.",
    ],
    [
      "So 500 thousand smallest and 3 million typical, is that right?",
      "Yep, that's very correct.",
    ],
  ];
  const failed = cases.filter(
    ([line, want]) => !(answerFor(line) ?? "").startsWith(want),
  );
  const a = analyse([
    { role: "Q", text: "Are you more" },
    { role: "Q", text: "And on cheque sizes," },
    { role: "Q", text: "Where is the firm based?" },
    {
      role: "Q",
      text: "Just to place you, you're in the United States, right?",
    },
    { role: "Q", text: "You're in the US, right?" },
  ]);
  if (a.cut.length !== 2) failed.push(["cutOff", String(a.cut.length)]);
  if (a.asked.country !== 3)
    failed.push(["asked.country", String(a.asked.country)]);
  return failed;
}
