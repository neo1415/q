import type {
  GateqFitBand,
  GateqInboxDto,
  GateqInboxItemDto,
  GateqInboxView,
  GateqPassReason,
  GateqDossierV1,
} from "@capital-q/contracts";

/**
 * The GateQ inbox's words and keys (F4), pure so they are tested without a
 * browser. Fit is the engine's band at submission; the reply clock is the
 * firm's own published promise. Nothing here ranks by activity.
 */

export const VIEW_CHIPS: readonly (readonly [GateqInboxView, string])[] = [
  ["INBOX", "Inbox"],
  ["STARRED", "Starred"],
  ["ASSIGNED_TO_ME", "Assigned to me"],
  ["FITS", "Fits"],
  ["PARTIAL", "Partial"],
  ["NOT_A_FIT", "Not a fit"],
  ["PASSED", "Passed"],
  ["ARCHIVED", "Archived"],
];

/** Assigned-to-me only means something in a firm of more than one. */
export function chipsFor(solo: boolean) {
  return VIEW_CHIPS.filter(([view]) => !(solo && view === "ASSIGNED_TO_ME"));
}

export const FIT_WORDS: Readonly<Record<GateqFitBand, string>> = {
  FITS: "Fits your rules",
  PARTIAL: "Partial",
  NOT_A_FIT: "Not a fit",
};

export const FIT_GLYPH: Readonly<Record<GateqFitBand, "fit" | "part" | "no">> =
  {
    FITS: "fit",
    PARTIAL: "part",
    NOT_A_FIT: "no",
  };

/**
 * F28: a gate with no published rules checked nothing, so nothing "fits":
 * a vacuous pass is never shown as a positive judgement.
 */
export function noRulesChecked(
  item: Pick<GateqInboxItemDto, "rules">,
): boolean {
  return item.rules.total === 0;
}

export function fitWordsFor(
  item: Pick<GateqInboxItemDto, "fit" | "rules">,
): string {
  return noRulesChecked(item) ? "No rules yet" : FIT_WORDS[item.fit];
}

export function fitGlyphFor(
  item: Pick<GateqInboxItemDto, "fit" | "rules">,
): "fit" | "part" | "no" | "unk" {
  return noRulesChecked(item) ? "unk" : FIT_GLYPH[item.fit];
}

export function rulesWords(rules: GateqInboxItemDto["rules"]): string {
  if (rules.total === 0) return "Nothing checked";
  const base = `${rules.met} of ${rules.total} rules`;
  return rules.unknown === 0
    ? base
    : `${base}, ${rules.unknown} needing clarification`;
}

export function replyWords(
  item: Pick<GateqInboxItemDto, "replyState" | "daysLeft" | "folder">,
): {
  readonly text: string;
  readonly warn: boolean;
} | null {
  switch (item.replyState) {
    case "NONE":
      return null;
    case "ANSWERED":
      return {
        text: item.folder === "PASSED" ? "Passed" : "Replied",
        warn: false,
      };
    case "OVERDUE":
      return { text: "Reply overdue", warn: true };
    case "DUE_SOON":
    case "ON_TRACK": {
      const days = item.daysLeft ?? 0;
      return {
        text:
          days === 0
            ? "Reply today"
            : `${days} day${days === 1 ? "" : "s"} left`,
        warn: item.replyState === "DUE_SOON",
      };
    }
  }
}

/** "Today 09:40", "Yesterday", "2 Oct": a mail client's received column. */
export function receivedWords(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) {
    return at.toISOString().slice(11, 16);
  }
  if (diff === 1) return "Yesterday";
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Q's view of an application, from the engine's band and the reply promise
 * alone: a short, labelled opinion, never presented as a verified fact.
 */
export function qView(item: GateqInboxItemDto): {
  readonly lead: string;
  readonly why: string;
} {
  if (noRulesChecked(item)) {
    return {
      lead: "Nothing checked yet",
      why: "Your gate has no published rules, so nothing was checked. Draft criteria from your mandate to sort what arrives.",
    };
  }
  if (item.fit === "NOT_A_FIT") {
    return {
      lead: "Outside your rules",
      why: "A required rule of your gate isn't met. If you pass, they get a reason.",
    };
  }
  if (item.fit === "PARTIAL" || item.rules.unknown > 0) {
    return {
      lead: "Too early to say",
      why: `${item.rules.unknown} of your rules ${item.rules.unknown === 1 ? "is" : "are"} not yet established. An unclear rule is not a rejection; clarify it with the founder.`,
    };
  }
  return {
    lead: "Worth a look",
    why:
      item.replyState === "DUE_SOON" || item.replyState === "OVERDUE"
        ? "Meets every rule of your gate, and your reply promise is close."
        : "Meets every rule of your gate.",
  };
}

export const PASS_REASONS: readonly (readonly [GateqPassReason, string])[] = [
  ["OUTSIDE_STAGE", "Outside our stage"],
  ["OUTSIDE_SECTOR", "Outside our sector"],
  ["CHEQUE_DOES_NOT_FIT", "Cheque doesn't fit"],
  ["TIMING", "Timing"],
  ["OTHER", "Other"],
];

/** A first draft, in the house's warm, specific style; theirs to change. */
export function draftPass(input: {
  readonly founderName: string | null;
  readonly companyName: string;
  readonly fund: string;
  readonly reason: GateqPassReason;
}): string {
  const hello =
    input.founderName === null
      ? "Hi,"
      : `Hi ${input.founderName.split(/\s+/)[0] ?? ""},`;
  const why: Readonly<Record<GateqPassReason, string>> = {
    OUTSIDE_STAGE: `${input.companyName} is at a different stage from where we invest, so we can't take this round.`,
    OUTSIDE_SECTOR: `${input.companyName} sits outside the sectors we back, so we can't take this round.`,
    CHEQUE_DOES_NOT_FIT:
      "the size of this round doesn't fit the cheques we write, so we can't take it.",
    TIMING:
      "the timing doesn't work for us right now, so we can't take this round.",
    OTHER: "we've decided not to take this round.",
  };
  return `${hello} thank you for applying to ${input.fund}. After looking at it carefully, ${why[input.reason]} We'd be glad to hear from you when you raise next.`;
}

export function draftReply(input: {
  readonly founderName: string | null;
  readonly fund: string;
}): string {
  const hello =
    input.founderName === null
      ? "Hi,"
      : `Hi ${input.founderName.split(/\s+/)[0] ?? ""},`;
  return `${hello} thank you for applying to ${input.fund}. We've read what you sent and would like to learn more. Could you share a time for a 30-minute call next week?`;
}

export type ShortcutCommand =
  | "NEXT"
  | "PREVIOUS"
  | "ARCHIVE"
  | "STAR"
  | "PASS"
  | "SEARCH"
  | "SELECT"
  | "OPEN"
  | "BACK"
  | "REPLY"
  | "DOWNLOAD"
  | "HELP";

/**
 * Gmail's keys, so investors already know them (j/k, e, s, #, /, x, o, u,
 * r, d, ?). Off while typing, off with a modifier, and off entirely when
 * the person turns single-key shortcuts off (WCAG 2.1.4).
 */
export function shortcutFor(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: {
    readonly tagName?: string;
    readonly isContentEditable?: boolean;
  } | null;
}): ShortcutCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const tag = event.target?.tagName?.toUpperCase() ?? "";
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    event.target?.isContentEditable === true
  ) {
    return null;
  }
  const map: Readonly<Record<string, ShortcutCommand>> = {
    j: "NEXT",
    k: "PREVIOUS",
    e: "ARCHIVE",
    s: "STAR",
    "#": "PASS",
    "/": "SEARCH",
    x: "SELECT",
    o: "OPEN",
    Enter: "OPEN",
    u: "BACK",
    r: "REPLY",
    d: "DOWNLOAD",
    "?": "HELP",
  };
  return map[event.key] ?? null;
}

/** The list a search narrows: company, one-liner, sector, labels. */
export function matchesSearch(item: GateqInboxItemDto, text: string): boolean {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return true;
  return [
    item.companyName,
    item.oneLiner ?? "",
    item.sector ?? "",
    item.country ?? "",
    ...item.labels,
  ]
    .join(" ")
    .toLowerCase()
    .includes(wanted);
}

export function unreadCount(inbox: Pick<GateqInboxDto, "counts">): number {
  return inbox.counts.INBOX;
}

// ---------------------------------------------------------------------------
// GateQ slice 1: the dossier frozen with a submission
// ---------------------------------------------------------------------------

type DossierFact = GateqDossierV1["dimensions"][number]["facts"][number];

/**
 * Where a fact stands, in an investor's words. Read from ADR-001's
 * separate axes, evidence first: nothing becomes "Document-supported"
 * without its evidence status saying so, and the v1 dossier has no
 * verified state at all, so nothing here ever reads as verified.
 */
export function factProvenanceWords(
  fact: Pick<DossierFact, "evidenceStatus" | "truthClass">,
):
  | "Document-supported"
  | "Estimated"
  | "Unknown"
  | "Founder stated"
  | "Derived by Q" {
  // A figure Q computed is never the founder's statement.
  if (fact.truthClass === "Q_INFERENCE") return "Derived by Q";
  if (fact.evidenceStatus === "DOCUMENT_SUPPORTED") return "Document-supported";
  if (fact.truthClass === "ESTIMATE") return "Estimated";
  if (fact.truthClass === "UNKNOWN") return "Unknown";
  return "Founder stated";
}

export const CRITERION_STATUS_WORDS: Readonly<
  Record<GateqDossierV1["qualification"]["criteria"][number]["status"], string>
> = {
  MATCH: "Meets",
  NO_MATCH: "Doesn't meet",
  UNKNOWN: "Unknown",
  NOT_APPLICABLE: "Not applicable",
};

export const CRITERION_STATUS_GLYPH: Readonly<
  Record<
    GateqDossierV1["qualification"]["criteria"][number]["status"],
    "fit" | "no" | "unk"
  >
> = {
  MATCH: "fit",
  NO_MATCH: "no",
  UNKNOWN: "unk",
  NOT_APPLICABLE: "unk",
};

export const OUTCOME_WORDS: Readonly<
  Record<GateqDossierV1["qualification"]["outcome"], string>
> = {
  QUALIFIED: "Qualifies under your published rules",
  NOT_QUALIFIED: "Doesn't qualify under your published rules",
  INSUFFICIENT_INFORMATION: "Not enough information to decide",
};

export const DILIGENCE_BASIS_WORDS: Readonly<
  Record<GateqDossierV1["diligenceQuestions"][number]["basis"], string>
> = {
  MISSING: "Not covered",
  UNKNOWN: "Founder didn't know",
  DECLINED: "Founder preferred not to say",
  CONTRADICTION: "Answers disagree",
};

export const MISSING_WORDS: Readonly<
  Record<GateqDossierV1["missing"][number]["reason"], string>
> = {
  REQUIRED_BY_GATEWAY: "Required by your rules",
  PREFERRED_BY_GATEWAY: "Preferred by your rules",
  CONTRADICTION: "Answers disagree",
  UNDERSTANDING: "For understanding",
};

/** "Founder" and "Q": the transcript's two voices, never a model's name. */
export function speakerWords(role: "PERSON" | "Q"): string {
  return role === "Q" ? "Q" : "Founder";
}

// ---------------------------------------------------------------------------
// Design gateq-2 (2026-10-21): three panes, saved views, list, dossier
// ---------------------------------------------------------------------------

/**
 * The saved views of the inbox folder. Each is read from the engine's band
 * at submission and the firm's own reply promise: the same rules as the
 * server's views (FITS, ASSIGNED_TO_ME, NOT_A_FIT), so a count here is the
 * count there. Nothing ranks by activity.
 */
export const PANE_VIEWS = [
  ["ALL", "All"],
  ["FIRST", "Look at first"],
  ["TODAY", "Reply today"],
  ["MINE", "Assigned to me"],
  ["OUTSIDE", "Outside your rules"],
] as const;
export type PaneView = (typeof PANE_VIEWS)[number][0];

export function inPane(
  item: GateqInboxItemDto,
  pane: PaneView,
  viewerUserId: string,
): boolean {
  if (item.folder !== "INBOX") return false;
  switch (pane) {
    case "ALL":
      return true;
    case "FIRST":
      // F28: a gate with no rules checked nothing; nothing is "first".
      return item.fit === "FITS" && item.rules.total > 0;
    case "TODAY":
      return (
        item.replyState === "OVERDUE" ||
        ((item.replyState === "DUE_SOON" || item.replyState === "ON_TRACK") &&
          item.daysLeft !== null &&
          item.daysLeft <= 0)
      );
    case "MINE":
      return item.assignee?.userId === viewerUserId;
    case "OUTSIDE":
      return item.fit === "NOT_A_FIT";
  }
}

export function paneCounts(
  items: readonly GateqInboxItemDto[],
  viewerUserId: string,
): Readonly<Record<PaneView, number>> {
  const count = (pane: PaneView) =>
    items.filter((item) => inPane(item, pane, viewerUserId)).length;
  return {
    ALL: count("ALL"),
    FIRST: count("FIRST"),
    TODAY: count("TODAY"),
    MINE: count("MINE"),
    OUTSIDE: count("OUTSIDE"),
  };
}

/** Two letters for a tile: the first two words' initials, or the name's first two. */
export function monogram(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const letters =
    words.length >= 2
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

export type Qualifies = "YES" | "NO" | "UNKNOWN" | "NO_RULES";

/** Qualifies under the published rules, in the engine's own terms. */
export function qualifiesOf(
  item: Pick<GateqInboxItemDto, "fit" | "rules">,
): Qualifies {
  if (noRulesChecked(item)) return "NO_RULES";
  if (item.fit === "FITS") return "YES";
  if (item.fit === "NOT_A_FIT") return "NO";
  return "UNKNOWN";
}

export const QUALIFIES_WORDS: Readonly<Record<Qualifies, string>> = {
  YES: "Qualifies",
  NO: "Doesn't qualify",
  UNKNOWN: "Not enough information",
  NO_RULES: "No rules yet",
};

/** One line of why, from the band, the rule counts and the promise alone. */
export function paneWhy(item: GateqInboxItemDto): string {
  switch (qualifiesOf(item)) {
    case "NO_RULES":
      return "No published rules yet, so nothing was checked.";
    case "NO":
      return "Doesn't qualify under your published rules: a required rule isn't met.";
    case "UNKNOWN": {
      const n = item.rules.unknown;
      return n === 0
        ? "Not enough information to decide."
        : `Not enough information to decide: ${String(n)} rule${n === 1 ? "" : "s"} not answered.`;
    }
    case "YES":
      return item.replyState === "DUE_SOON" || item.replyState === "OVERDUE"
        ? "Meets every rule of your gate, and your reply promise is close."
        : "Meets every rule of your gate.";
  }
}

/** "Reply today", "Reply overdue", "Reply by 24 Oct": the firm's own promise. */
export function dueWords(
  item: Pick<GateqInboxItemDto, "replyState" | "daysLeft" | "folder" | "replyBy">,
): { readonly text: string; readonly late: boolean } | null {
  switch (item.replyState) {
    case "NONE":
      return null;
    case "ANSWERED":
      return {
        text: item.folder === "PASSED" ? "Passed" : "Replied",
        late: false,
      };
    case "OVERDUE":
      return { text: "Reply overdue", late: true };
    case "DUE_SOON":
    case "ON_TRACK":
      if (item.daysLeft !== null && item.daysLeft <= 0)
        return { text: "Reply today", late: false };
      if (item.replyBy === null) return null;
      return {
        text: `Reply by ${new Date(`${item.replyBy}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`,
        late: false,
      };
  }
}

/** "18 Oct": the frozen submission's date. */
export function submittedWords(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export type SummaryRow = {
  readonly label: string;
  /** Null: not covered in what they sent; shown as such, never guessed. */
  readonly value: string | null;
};

const SUMMARY_GROUPS: readonly (readonly [
  GateqDossierV1["dimensions"][number]["group"],
  string,
])[] = [
  ["FUNDRAISING", "Round"],
  ["TRACTION", "Traction"],
  ["MARKET", "Market"],
];

/**
 * The dossier's one-page summary: the company, then the round, traction
 * and market as the founder sent them, each with where it came from. A
 * group they did not cover is "Not covered", never an empty zero.
 */
export function onePageSummary(
  item: Pick<GateqInboxItemDto, "companyName" | "raise">,
  dossier: GateqDossierV1 | null | undefined,
): readonly SummaryRow[] {
  const rows: SummaryRow[] = [
    { label: "Company", value: dossier?.company.name ?? item.companyName },
  ];
  for (const [group, label] of SUMMARY_GROUPS) {
    const facts =
      dossier?.dimensions
        .filter((dimension) => dimension.group === group)
        .flatMap((dimension) => dimension.facts)
        .filter((fact) => fact.truthClass !== "UNKNOWN") ?? [];
    // An older submission has no dossier: its raise is still their claim.
    const legacyRaise =
      group === "FUNDRAISING" && facts.length === 0 && item.raise !== null
        ? `${item.raise.currency === "USD" ? "$" : `${item.raise.currency} `}${Number(item.raise.amount).toLocaleString("en-US")}. Founder stated`
        : null;
    rows.push({
      label,
      value:
        facts.length === 0
          ? legacyRaise
          : facts
              .slice(0, 2)
              .map(
                (fact) =>
                  `${fact.summary.replace(/\.\s*$/, "")}. ${factProvenanceWords(fact)}`,
              )
              .join(" "),
    });
  }
  return rows;
}

/** The dossier's own diligence questions, a few, in the order it holds them. */
export function openQuestions(
  dossier: GateqDossierV1 | null | undefined,
  max = 3,
): readonly string[] {
  return (dossier?.diligenceQuestions ?? [])
    .map((question) => question.question)
    .slice(0, max);
}

/** "Book a call": a first draft that asks for times; sent only as approved. */
export function draftCall(input: {
  readonly founderName: string | null;
  readonly fund: string;
}): string {
  const hello =
    input.founderName === null
      ? "Hi,"
      : `Hi ${input.founderName.split(/\s+/)[0] ?? ""},`;
  return `${hello} thank you for applying to ${input.fund}. We'd like to talk. Could you send two or three times that suit you for a 30-minute call next week?`;
}

/** "Ask for more": the dossier's open questions, drafted; sent only as approved. */
export function draftAsk(input: {
  readonly founderName: string | null;
  readonly fund: string;
  readonly questions: readonly string[];
}): string {
  const hello =
    input.founderName === null
      ? "Hi,"
      : `Hi ${input.founderName.split(/\s+/)[0] ?? ""},`;
  const asks =
    input.questions.length === 0
      ? "Could you tell us a little more about your traction and your round?"
      : input.questions.map((question) => `- ${question}`).join("\n");
  return `${hello} thank you for applying to ${input.fund}. Before we go further, could you help us with a few questions?\n${asks}`;
}
