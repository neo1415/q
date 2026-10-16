import { describe, expect, it } from "vitest";

import {
  ARABIC_QUIET_PREFIX,
  arabicArrivalGreeting,
  arabicCardLine,
  arabicJobsDoneWords,
  arabicList,
  arabicLowdownOf,
  arabicMatchesWords,
  arabicQuestionsWords,
  arabicQuietDayNewsWords,
  arabicSummaryOfCards,
  arabicUnreadWords,
  arabicWaitingWords,
  type DecisionCardFacts,
} from "../src/speech/public.js";

/** Latin letters that would mean an English fragment leaked in. */
const ENGLISH_WORD =
  /\b(the|and|you|your|is|are|to|of|with|for|sent|replied)\b/iu;

const DUBAI = "Asia/Dubai";
const at = (iso: string): Date => new Date(iso);

const approval = (
  over: Partial<DecisionCardFacts> = {},
): DecisionCardFacts => ({
  kind: "APPROVAL",
  counterpart: "Zino Aviation",
  theySaid: "Can we do a call on Thursday?",
  message: "Thursday at 10 works.",
  summary: "Reply to Zino Aviation about a call.",
  ...over,
});

describe("Arabic arrival greeting", () => {
  it("greets by their clock with the first name kept as written", () => {
    expect(
      arabicArrivalGreeting({
        firstName: "Kathryn Smith",
        now: at("2026-10-16T05:00:00Z"),
        timeZone: DUBAI,
      }),
    ).toBe("صباح الخير، Kathryn.");
    expect(
      arabicArrivalGreeting({
        firstName: "Kathryn",
        now: at("2026-10-16T14:00:00Z"),
        timeZone: DUBAI,
      }),
    ).toBe("مساء الخير، Kathryn.");
  });

  it("has a late-hours hello and works without a name", () => {
    const late = arabicArrivalGreeting({
      firstName: null,
      now: at("2026-10-16T20:30:00Z"),
      timeZone: DUBAI,
    });
    expect(late).toBe("مرحباً، ما زلت مستيقظاً.");
  });
});

describe("Arabic number agreement", () => {
  const sent = (n: number) =>
    arabicLowdownOf({
      activity: { sent: { n, names: [] } },
      decisions: 0,
      hoursAway: null,
    }).text;

  it("uses the singular, dual, 3-10 plural and 11+ forms", () => {
    expect(sent(1)).toBe("أرسلتُ رسالة واحدة.");
    expect(sent(2)).toBe("أرسلتُ رسالتين.");
    expect(sent(3)).toBe("أرسلتُ 3 رسائل.");
    expect(sent(10)).toBe("أرسلتُ 10 رسائل.");
    expect(sent(11)).toBe("أرسلتُ 11 رسالة.");
    expect(sent(25)).toBe("أرسلتُ 25 رسالة.");
  });

  it("counts decisions with the same agreement", () => {
    const decisions = (n: number) =>
      arabicLowdownOf({ activity: {}, decisions: n, hoursAway: null }).text;
    expect(decisions(1)).toMatch(/أمر واحد/u);
    expect(decisions(2)).toMatch(/أمران/u);
    expect(decisions(4)).toMatch(/4 أمور/u);
    expect(decisions(12)).toMatch(/12 أمراً/u);
  });

  it("joins lists with و and Arabic commas", () => {
    expect(arabicList(["A"])).toBe("A");
    expect(arabicList(["A", "B"])).toBe("A وB");
    expect(arabicList(["A", "B", "C"])).toBe("A، B وC");
  });
});

describe("Arabic lowdown from facts", () => {
  it("is quiet, with no words, when nothing happened and nothing waits", () => {
    expect(
      arabicLowdownOf({ activity: {}, decisions: 0, hoursAway: 30 }),
    ).toEqual({ quiet: true, text: "", mustSay: [] });
  });

  it("an unread source says nothing, never zero", () => {
    const read = arabicLowdownOf({
      activity: { replies: undefined, sent: undefined },
      decisions: 0,
      hoursAway: 5,
    });
    expect(read.quiet).toBe(true);
    expect(read.text).not.toMatch(/0|صفر/u);
  });

  it("names people exactly as recorded and carries mustSay", () => {
    const read = arabicLowdownOf({
      activity: {
        sent: { n: 2, names: ["Zino Aviation", "Spheros"] },
        booked: { n: 1, names: ["Gulf Capital"] },
        replies: { n: 1, names: ["Noor Ventures"] },
      },
      decisions: 1,
      hoursAway: 30,
    });
    expect(read.quiet).toBe(false);
    expect(read.text).toContain("رددتُ على Zino Aviation وSpheros");
    expect(read.text).toContain("حجزتُ مكالمتك مع Gulf Capital");
    expect(read.text).toContain("ردّ Noor Ventures");
    expect(read.text).toMatch(/^(أثناء غيابك،|منذ زيارتك الأخيرة،)/u);
    expect(read.mustSay).toEqual([
      "Zino Aviation",
      "Spheros",
      "Gulf Capital",
      "Noor Ventures",
    ]);
    expect(read.text).not.toMatch(ENGLISH_WORD);
  });

  it("counts instead of naming when the names are incomplete", () => {
    const read = arabicLowdownOf({
      activity: { held: { n: 3, names: ["Spheros"] } },
      decisions: 0,
      hoursAway: null,
    });
    expect(read.text).toBe("احتفظتُ بـ3 رسائل لتقرأها.");
  });
});

describe("Arabic decision cards", () => {
  it("puts one card with their words quoted as written", () => {
    const line = arabicCardLine(approval(), 1, 1);
    expect(line).toMatch(
      /^كتب Zino Aviation: «Can we do a call on Thursday\?» وصغتُ ردّاً\. /u,
    );
    expect(line).toMatch(/(هل أرسله؟|هل تريدني أن أرسله؟|أأرسله؟)$/u);
  });

  it("orders cards with Arabic ordinals", () => {
    expect(arabicCardLine(approval(), 1, 3)).toMatch(/^أولاً، /u);
    expect(arabicCardLine(approval(), 3, 3)).toMatch(/^والأخير: /u);
  });

  it("asks about a held draft and a non-message card", () => {
    expect(arabicCardLine(approval({ kind: "HELD" }), 1, 1)).toContain(
      "احتفظتُ برسالة إلى Zino Aviation",
    );
    expect(
      arabicCardLine(
        approval({ message: null, summary: "Share the deck with Spheros." }),
        1,
        1,
      ),
    ).toBe("«Share the deck with Spheros.» هل أمضي في ذلك؟");
  });

  it("summarises every card in one sentence, the day said in Arabic", () => {
    const summary = arabicSummaryOfCards([
      approval(),
      approval({
        counterpart: "Spheros",
        theySaid: "Attached is our pitch deck.",
      }),
      approval({ kind: "HELD", counterpart: "Noor" }),
    ]);
    expect(summary).toBe(
      "3 أمور: Zino Aviation يريد مكالمة يوم الخميس، أرسل Spheros عرضه التقديمي وردّ Noor محتجز.",
    );
    expect(arabicSummaryOfCards([])).toBeNull();
  });
});

describe("the rest of the Arabic arrival", () => {
  it("questions, jobs and who is waiting", () => {
    expect(arabicQuestionsWords(0)).toBeNull();
    expect(arabicQuestionsWords(1)).toContain("سؤال واحد");
    expect(arabicQuestionsWords(3)).toContain("وعددها 3");
    expect(arabicJobsDoneWords({ n: 0, names: [] })).toBeNull();
    expect(arabicJobsDoneWords({ n: 4, names: [] })).toBe(
      "أنهى وكلائي 4 مهام.",
    );
    expect(arabicWaitingWords([])).toBeNull();
    expect(arabicWaitingWords(["Zino", "Zino"])).toBe("Zino بانتظار ردّك.");
    expect(arabicWaitingWords(["Zino", "Noor"])).toBe(
      "Zino وNoor بانتظار ردودك.",
    );
  });

  it("says what could not be checked, never that nothing waits", () => {
    expect(arabicUnreadWords([])).toBeNull();
    expect(arabicUnreadWords(["MEETING"])).toBe(
      "تعذّر عليّ التحقق من الاجتماعات الآن.",
    );
    expect(arabicUnreadWords(["NOTICE", "APPROVAL", "MEETING"])).toBe(
      "تعذّر عليّ التحقق من رسائلك وطلباتك والموافقات الآن، لذا لا أستطيع القول إن لا شيء ينتظرك هناك.",
    );
    expect(ARABIC_QUIET_PREFIX.length).toBeGreaterThan(0);
  });

  it("matches for one, two and many, the best fit named only with several", () => {
    expect(
      arabicMatchesWords({
        total: 1,
        sinceLastVisit: true,
        names: ["Spheros"],
        best: "Spheros",
      }),
    ).toBe("شركة جديدة تطابق تفويضك: Spheros.");
    expect(
      arabicMatchesWords({
        total: 2,
        sinceLastVisit: true,
        names: ["Spheros", "Zino"],
        best: null,
      }),
    ).toBe("شركتان جديدتان في خلاصتك تطابقان تفويضك: Spheros وZino.");
    expect(
      arabicMatchesWords({
        total: 14,
        sinceLastVisit: false,
        names: ["A", "B", "C"],
        best: "B",
      }),
    ).toBe("14 شركة في خلاصتك تطابق تفويضك: A، B وC وغيرها. B هي الأنسب.");
    expect(
      arabicMatchesWords({
        total: 0,
        sinceLastVisit: false,
        names: [],
        best: null,
      }),
    ).toBeNull();
  });

  it("names one or two Q Daily headlines as written", () => {
    expect(arabicQuietDayNewsWords([])).toBeNull();
    expect(arabicQuietDayNewsWords([{ headline: "Gulf VC rebounds." }])).toBe(
      "لفتت انتباهي قصة في أحدث عدد من The Q Daily: «Gulf VC rebounds». هل تريد الخلاصة؟",
    );
    expect(
      arabicQuietDayNewsWords([{ headline: "One" }, { headline: "Two" }]),
    ).toContain("«One» و«Two»");
  });
});
