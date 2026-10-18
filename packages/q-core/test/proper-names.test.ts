import { describe, expect, it } from "vitest";

import {
  decide,
  isVerifiedPronunciation,
  nameKeyOf,
  parseMention,
  parseNameCorrection,
  pronunciationHintLines,
  rankCandidates,
  repairTranscript,
  romanizeArabic,
  scoreOrgNames,
  scorePersonNames,
  type NameCandidate,
} from "../src/names/public.js";

const same = (a: string, b: string, floor = 0.85): void => {
  expect(scorePersonNames(a, b).score, `${a} ~ ${b}`).toBeGreaterThanOrEqual(
    floor,
  );
};
const different = (a: string, b: string, ceiling = 0.6): void => {
  expect(scorePersonNames(a, b).score, `${a} !~ ${b}`).toBeLessThan(ceiling);
};

describe("alternate romanisations", () => {
  it.each([
    ["Shadi Qishta", "Shadi Kishta"],
    ["Shadi Qishta", "Shadi Qeshta"],
    ["Shadi Qishta", "Shady Qishtah"],
    ["Shadi Qishta", "Chadi Kishta", 0.8],
    ["Mohammed Hassan", "Muhammad Hassan"],
    ["Mohammed Hassan", "Mohamed Hasan"],
    ["Muhammad", "Mohammad"],
    ["Ahmed", "Ahmad"],
    ["Khalid Al-Thani", "Khaled El Thani"],
    ["Khalid", "Kalid", 0.8],
    ["Al-Rashid", "El Rashid"],
    ["Al Rashid", "Rashid"],
    ["Mustafa", "Moustafa"],
    ["Yusuf", "Youssef", 0.8],
    ["Nour", "Noor"],
    ["Fatima", "Fatimah"],
    ["Abdul Rahman", "Abdulrahman"],
    ["Abdul Rahman", "Abd al-Rahman"],
    ["Abdelrahman", "Abd Al Rahman"],
    ["Abdullah", "Abd Allah"],
    ["Abdulaziz", "Abd al-Aziz"],
    ["Abu Bakr", "Abubakar", 0.85],
    ["Hassan", "Alhassan", 0.9],
  ] as [string, string, number?][])("%s ~ %s", (a, b, floor) => {
    same(a, b, floor);
  });

  it("ignores honorifics, kinship particles and word order marks", () => {
    same("Sheikh Hamad bin Jassim Al Thani", "Hamad Jassim Al-Thani");
    same("Dr. Fatima bint Ahmed", "Fatima Ahmad");
    same("Alhaji Musa Bello", "Musa Bello");
    same("Engr. Shadi Qishta", "Shadi Kishta");
  });

  it("a lone title-like word is still a name", () => {
    expect(scorePersonNames("Chief", "Chief").score).toBeGreaterThan(0);
  });
});

describe("Arabic script and Latin meet", () => {
  it("romanises without inventing vowels", () => {
    expect(romanizeArabic("محمد")).toBe("mhmd");
    expect(romanizeArabic("قشطة")).toBe("qshta");
    expect(romanizeArabic("وائل")).toBe("wail");
  });

  it.each([
    ["محمد", "Mohammed"],
    ["محمد", "Muhammad"],
    ["شادي قشطة", "Shadi Qishta"],
    ["شادي قشطة", "Shadi Kishta"],
    ["أحمد", "Ahmed"],
    ["خالد", "Khalid"],
    ["يوسف", "Yusuf"],
    ["فاطمة", "Fatima"],
    ["عبد الرحمن", "Abdulrahman"],
    ["عبدالله", "Abdullah"],
    ["الشيخ حمد آل ثاني", "Sheikh Hamad Al Thani"],
  ] as const)("%s ~ %s (round trip)", (arabic, latin) => {
    same(arabic, latin, 0.8);
    same(latin, arabic, 0.8);
  });

  it("Arabic harakat and tatweel do not matter", () => {
    same("مُحَمَّد", "محمد", 0.99);
    same("شـادي", "شادي", 0.99);
  });
});

describe("false-positive guards", () => {
  it("different given names with the same family are different", () => {
    different("Shadi Qishta", "Samer Qishta");
    different("Mohammed Hassan", "Mahmoud Hassan");
    different("Ahmed Khalil", "Ali Khalil");
  });

  it("different family names are different", () => {
    different("Shadi Qishta", "Shadi Karam");
    different("Fatima Ahmed", "Fatima Ali");
  });

  it("a single shared word is only a partial, capped below a likely match", () => {
    const one = scorePersonNames("Shadi", "Shadi Qishta");
    expect(one.partial).toBe(true);
    expect(one.score).toBeLessThanOrEqual(0.6);
    expect(
      scorePersonNames("Qishta", "Shadi Qishta").score,
    ).toBeLessThanOrEqual(0.6);
  });

  it("similar-looking but distinct names stay apart", () => {
    different("Hamad", "Hamid", 0.85);
    different("Salim", "Salem Ahmed", 0.61);
    different("Mahmoud", "Muhammad");
  });
});

describe("organisation names", () => {
  it.each([
    ["Midmac", "Midmac Contracting Company W.L.L."],
    ["Midmac", "Midmac Contracting Co. WLL"],
    ["Midmac Contracting", "MIDMAC CONTRACTING COMPANY (W.L.L)"],
    ["Zino Aviation Ltd", "Zino Aviation Limited"],
    ["Al Jaber Engineering LLC", "Jaber Engineering L.L.C."],
    ["ميدماك", "Midmac", 0.8],
    ["ميدماك للمقاولات ذ.م.م", "Midmac Contracting WLL", 0.8],
    ["Qatar Gas Q.P.J.S.C.", "Qatar Gas"],
  ] as [string, string, number?][])("%s ~ %s", (a, b, floor) => {
    expect(scoreOrgNames(a, b).score, `${a} ~ ${b}`).toBeGreaterThanOrEqual(
      floor ?? 0.85,
    );
  });

  it("same brand, different business is lower but not a different brand", () => {
    const trading = scoreOrgNames("Midmac Trading", "Midmac Contracting");
    const same = scoreOrgNames("Midmac Contracting", "Midmac Contracting WLL");
    expect(trading.score).toBeLessThan(same.score);
    expect(trading.score).toBeGreaterThan(0.7);
  });

  it("different brands do not match on the legal form or descriptor alone", () => {
    expect(
      scoreOrgNames("Midmac Contracting Company", "Nakilat Contracting Company")
        .score,
    ).toBeLessThan(0.5);
    expect(scoreOrgNames("Contracting Company", "Midmac").score).toBeLessThan(
      0.5,
    );
  });
});

describe("clues disambiguate; a name match alone is never the same person", () => {
  const candidates: NameCandidate[] = [
    {
      id: "doha-midmac",
      name: "Shadi Qishta",
      city: "Doha",
      country: "Qatar",
      employer: "Midmac Contracting Company W.L.L.",
    },
    {
      id: "lagos",
      name: "Shady Kishta",
      city: "Lagos",
      country: "Nigeria",
      employer: "Dangote Group",
    },
    { id: "other", name: "Samer Qishta", city: "Doha", employer: "Midmac" },
  ];

  it("parses name, city and employer from one phrase", () => {
    expect(parseMention("Shadi Qishta, Doha, from Midmac")).toEqual({
      name: "Shadi Qishta",
      clues: { city: "doha", country: "qatar", employer: "Midmac" },
    });
    expect(parseMention("Shadi Qishta from Midmac in Doha").clues).toEqual({
      city: "doha",
      country: "qatar",
      employer: "Midmac",
    });
    expect(parseMention("Shadi Qishta").clues).toEqual({});
    // An unlabelled, unknown segment is not guessed to be anything.
    expect(parseMention("Shadi Qishta, the tall one").clues).toEqual({});
  });

  it("the employer and city pick the right Shadi", () => {
    const ranked = rankCandidates(
      parseMention("Shadi Qishta, Doha, from Midmac"),
      candidates,
      { kind: "person" },
    );
    expect(ranked[0]?.id).toBe("doha-midmac");
    expect(ranked[0]?.corroborated).toBe(true);
    const lagos = ranked.find((r) => r.id === "lagos");
    expect(lagos?.conflicts).toContain("EMPLOYER");
    expect(lagos?.corroborated).toBe(false);
    // Samer is a different given name: not even a candidate.
    expect(ranked.some((r) => r.id === "other")).toBe(false);
    expect(decide(ranked).kind).toBe("ONE");
  });

  it("a name alone is never enough outside the asker's own records", () => {
    const ranked = rankCandidates(parseMention("Shadi Qishta"), candidates, {
      kind: "person",
    });
    expect(ranked.every((r) => !r.corroborated)).toBe(true);
    expect(decide(ranked).kind).toBe("SEVERAL");
    // Two plausible candidates: even their own records need a clear margin.
    expect(decide(ranked, { withinOwnRecords: true }).kind).toBe("SEVERAL");
  });

  it("a conflicting clue blocks a decision", () => {
    const ranked = rankCandidates(
      parseMention("Shadi Qishta, Lagos, from Midmac"),
      candidates,
      { kind: "person" },
    );
    expect(decide(ranked).kind).not.toBe("ONE");
  });

  it("unknown clues are neither support nor conflict", () => {
    const ranked = rankCandidates(
      parseMention("Shadi Qishta, Doha"),
      [{ id: "x", name: "Shadi Qishta" }],
      { kind: "person" },
    );
    expect(ranked[0]?.conflicts).toEqual([]);
    expect(ranked[0]?.corroborated).toBe(false);
  });
});

describe("ASR repair with context", () => {
  const lexicon = [
    {
      kind: "person" as const,
      name: "Shadi Qishta",
      employer: "Midmac Contracting",
      city: "Doha",
    },
    { kind: "organisation" as const, name: "Midmac Contracting Company" },
    { kind: "person" as const, name: "Samer Qishta" },
  ];

  it("repairs a full-name mishearing and the split organisation", () => {
    const result = repairTranscript(
      "open Chadi Kishta from Mid Mack in Doha",
      lexicon,
    );
    expect(result.original).toBe("open Chadi Kishta from Mid Mack in Doha");
    expect(result.text).toBe(
      "open Shadi Qishta from Midmac Contracting Company in Doha",
    );
  });

  it("does not rewrite a different real person", () => {
    const result = repairTranscript("call Samer Qishta now", lexicon);
    expect(result.text).toBe("call Samer Qishta now");
    expect(repairTranscript("call Sami Karam now", lexicon).text).toBe(
      "call Sami Karam now",
    );
  });

  it("leaves a name already correct, and a stranger's name, alone", () => {
    expect(repairTranscript("open Shadi Qishta", lexicon).repairs).toEqual([]);
    expect(repairTranscript("meet Shaun Quigley", lexicon).text).toBe(
      "meet Shaun Quigley",
    );
  });

  it("only suggests a one-word repair that has no supporting context", () => {
    const result = repairTranscript("what about Kishta", [
      { kind: "person", name: "Qishta" },
    ]);
    expect(result.text).toBe("what about Kishta");
    expect(result.repairs[0]?.applied).toBe(false);
    expect(result.repairs[0]?.reason).toBe("NEEDS_CONTEXT");
  });

  it("refuses to pick between two near entries", () => {
    const result = repairTranscript("ask Kishta Samir", [
      { kind: "person", name: "Qishta Samir" },
      { kind: "person", name: "Kishta Samer" },
    ]);
    expect(
      result.repairs.every((r) => !r.applied || r.reason !== "AMBIGUOUS"),
    ).toBe(true);
  });
});

describe("pronunciation", () => {
  it("one key serves every romanisation of a name", () => {
    expect(nameKeyOf("Shadi Qishta")).toBe(nameKeyOf("Shady Kishtah"));
    expect(nameKeyOf("Qishta")).toBe(nameKeyOf("Kishta"));
    expect(nameKeyOf("Mohammed")).toBe(nameKeyOf("Muhammad"));
    expect(nameKeyOf("Qishta")).not.toBe(nameKeyOf("Karam"));
  });

  it("parses corrections", () => {
    expect(parseNameCorrection("It's pronounced KISH-ta")).toEqual({
      kind: "pronunciation",
      name: null,
      value: "KISH-ta",
    });
    expect(parseNameCorrection("Qishta is pronounced like kish-tah.")).toEqual({
      kind: "pronunciation",
      name: "Qishta",
      value: "kish-tah",
    });
    expect(parseNameCorrection("The name is spelled Q-I-S-H-T-A")).toEqual({
      kind: "spelling",
      name: null,
      value: "QISHTA",
    });
    expect(parseNameCorrection("say Shadi like SHAH-dee")?.name).toBe("Shadi");
    expect(parseNameCorrection("what is the weather")).toBeNull();
    expect(parseNameCorrection("it's pronounced wrong")).toBeNull();
  });

  it("only a sourced guide is verified; a user's word is labelled theirs", () => {
    const base = {
      nameKey: "k",
      displayName: "Shadi Qishta",
      kind: "pronunciation" as const,
      value: "SHAH-dee KISH-tah",
    };
    const user = {
      ...base,
      source: "USER_CORRECTION" as const,
      sourceRef: null,
    };
    const guide = {
      ...base,
      source: "VERIFIED_GUIDE" as const,
      sourceRef: "profile-recording:42",
    };
    const unsourced = {
      ...base,
      source: "VERIFIED_GUIDE" as const,
      sourceRef: null,
    };
    expect(isVerifiedPronunciation(user)).toBe(false);
    expect(isVerifiedPronunciation(guide)).toBe(true);
    expect(isVerifiedPronunciation(unsourced)).toBe(false);
    const lines = pronunciationHintLines([user, guide]);
    expect(lines[0]).toContain("(verified)");
    expect(lines[1]).toContain("as the user told Q");
  });
});
