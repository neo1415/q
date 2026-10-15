/**
 * The Meeting Context Snapshot (founder ask P3, 2026-10-11).
 *
 * Prepared before Q joins, versioned, and built only from ports that sit
 * behind the Context Firewall and the existing read services (the sources
 * here are functions the composition root backs with them; this module
 * reads no table). Four separate layers:
 *
 *   SHARED            what both sides already see (booking, agenda, the
 *                     company as an investor may see it, published mandate)
 *   DISCLOSED         explicitly disclosed to this relationship (documents,
 *                     terms both sides have seen)
 *   FOUNDER_PRIVATE   the founder's own record -- founder side only
 *   INVESTOR_PRIVATE  the investor's own record -- investor side only
 *
 * Live conversation state is NOT here: it is the meeting memory.
 *
 * The room is the INTERSECTION of who is in it. A private layer is usable
 * only when every person present is on that side; an unidentified person
 * makes the room unknown, and unknown fails closed. In a two-party call
 * neither private layer is ever offered to the model or spoken. Q knowing
 * something never means the room may hear it.
 */

export const MEETING_SNAPSHOT_VERSION = 1;

export type SnapshotSide = "FOUNDER" | "INVESTOR";
export type SnapshotLayer =
  "SHARED" | "DISCLOSED" | "FOUNDER_PRIVATE" | "INVESTOR_PRIVATE";

export const SNAPSHOT_LAYERS: readonly SnapshotLayer[] = [
  "SHARED",
  "DISCLOSED",
  "FOUNDER_PRIVATE",
  "INVESTOR_PRIVATE",
];

export type SnapshotTopic =
  | "AGENDA"
  | "PARTICIPANT"
  | "RELATIONSHIP"
  | "COMPANY"
  | "DECK"
  | "DOCUMENT"
  | "MANDATE"
  | "TERMS"
  | "MEETING"
  | "OPEN_POINT"
  | "APPROVAL";

/** ADR-001 truth class, kept on the fact: a deck claim is a USER_CLAIM, not verified. */
export type SnapshotTruth =
  "VERIFIED" | "USER_CLAIM" | "ESTIMATE" | "Q_INFERENCE" | "UNKNOWN";

export type SnapshotFact = {
  readonly id: string;
  readonly topic: SnapshotTopic;
  readonly text: string;
  /** Where it came from, e.g. "deck:slide 4", "mandate v7", "booking". */
  readonly source: string;
  readonly truth?: SnapshotTruth;
};

export type SnapshotParticipant = {
  readonly userId: string | null;
  readonly name: string;
  readonly role: string | null;
  readonly side: SnapshotSide;
  readonly organisation: string;
};

export type MeetingContextSnapshot = {
  readonly version: typeof MEETING_SNAPSHOT_VERSION;
  /** Raised each time the snapshot is rebuilt for the same meeting. */
  readonly revision: number;
  readonly meetingId: string;
  readonly preparedAt: string;
  readonly agenda: string;
  readonly participants: readonly SnapshotParticipant[];
  readonly layers: Readonly<Record<SnapshotLayer, readonly SnapshotFact[]>>;
  /** Sources that failed to read: unknown stays unknown, never zero. */
  readonly gaps: readonly string[];
};

// ---------------------------------------------------------------------------
// The room: who may hear what.
// ---------------------------------------------------------------------------

export type RoomMember = { readonly side: SnapshotSide | null };

export type Audience = {
  readonly sides: ReadonlySet<SnapshotSide>;
  /** Someone present could not be identified to a side. */
  readonly unidentified: boolean;
  readonly size: number;
};

export function audienceOf(present: readonly RoomMember[]): Audience {
  const sides = new Set<SnapshotSide>();
  let unidentified = false;
  for (const member of present) {
    if (member.side === null) unidentified = true;
    else sides.add(member.side);
  }
  return { sides, unidentified, size: present.length };
}

/**
 * The layers this room may use. A private layer needs a room made only of
 * that side; an empty or partly unidentified room gets shared layers only.
 */
export function layersPermittedFor(audience: Audience): SnapshotLayer[] {
  const out: SnapshotLayer[] = ["SHARED", "DISCLOSED"];
  if (audience.unidentified || audience.size === 0) return out;
  if (audience.sides.size === 1) {
    out.push(
      audience.sides.has("FOUNDER") ? "FOUNDER_PRIVATE" : "INVESTOR_PRIVATE",
    );
  }
  return out;
}

export function factsFor(
  snapshot: MeetingContextSnapshot,
  audience: Audience,
): SnapshotFact[] {
  return layersPermittedFor(audience).flatMap((layer) => [
    ...snapshot.layers[layer],
  ]);
}

// ---------------------------------------------------------------------------
// Building it, from ports.
// ---------------------------------------------------------------------------

export type SnapshotSources = {
  /** Booking, agenda, participants, relationship history as both see it. */
  readonly shared: () => Promise<{
    readonly agenda: string;
    readonly participants: readonly SnapshotParticipant[];
    readonly facts: readonly SnapshotFact[];
  }>;
  /** Documents, terms and deck claims explicitly disclosed to this relationship. */
  readonly disclosed: () => Promise<readonly SnapshotFact[]>;
  /** The founder's own record, read as the founder (Context Firewall plan). */
  readonly founderPrivate: () => Promise<readonly SnapshotFact[]>;
  /** The investor's own record, read as the investor (Context Firewall plan). */
  readonly investorPrivate: () => Promise<readonly SnapshotFact[]>;
};

const FACT_CHARS = 600;
const FACTS_PER_LAYER = 40;

function cleaned(
  facts: readonly SnapshotFact[],
  prefix: string,
): SnapshotFact[] {
  const seen = new Set<string>();
  const out: SnapshotFact[] = [];
  for (const fact of facts) {
    const text = fact.text.trim().slice(0, FACT_CHARS);
    const id = `${prefix}:${fact.id}`;
    if (text.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...fact, id, text });
    if (out.length >= FACTS_PER_LAYER) break;
  }
  return out;
}

/**
 * Each source is read independently: one that fails leaves a named gap, not
 * an invented empty. A private layer is never merged into a shared one --
 * the arrays are kept apart by construction and by the id prefix.
 */
export async function buildMeetingSnapshot(input: {
  readonly meetingId: string;
  readonly sources: SnapshotSources;
  readonly revision?: number;
  readonly now?: () => Date;
}): Promise<MeetingContextSnapshot> {
  const gaps: string[] = [];
  const guarded = async <T>(
    name: string,
    read: () => Promise<T>,
    empty: T,
  ): Promise<T> => {
    try {
      return await read();
    } catch {
      gaps.push(name);
      return empty;
    }
  };
  const none: readonly SnapshotFact[] = [];
  const [shared, disclosed, founder, investor] = await Promise.all([
    guarded("shared", input.sources.shared, {
      agenda: "",
      participants: [] as readonly SnapshotParticipant[],
      facts: none,
    }),
    guarded("disclosed", input.sources.disclosed, none),
    guarded("founder_private", input.sources.founderPrivate, none),
    guarded("investor_private", input.sources.investorPrivate, none),
  ]);
  return {
    version: MEETING_SNAPSHOT_VERSION,
    revision: input.revision ?? 1,
    meetingId: input.meetingId,
    preparedAt: (input.now ?? (() => new Date()))().toISOString(),
    agenda: shared.agenda.trim().slice(0, 1_000),
    participants: shared.participants,
    layers: {
      SHARED: cleaned(shared.facts, "s"),
      DISCLOSED: cleaned(disclosed, "d"),
      FOUNDER_PRIVATE: cleaned(founder, "f"),
      INVESTOR_PRIVATE: cleaned(investor, "i"),
    },
    gaps,
  };
}

/**
 * The compact working context for the model: only what the room may use,
 * grouped by topic. A private layer is not merely marked -- it is absent.
 */
export function renderSnapshot(
  snapshot: MeetingContextSnapshot,
  audience: Audience,
  maxChars = 4_500,
): string {
  const lines: string[] = [];
  if (snapshot.agenda.length > 0) lines.push(`Agenda: ${snapshot.agenda}`);
  for (const fact of factsFor(snapshot, audience)) {
    const mark =
      fact.truth === undefined || fact.truth === "VERIFIED"
        ? ""
        : ` [${fact.truth.toLowerCase().replace("_", " ")}]`;
    lines.push(`- (${fact.topic.toLowerCase()}) ${fact.text}${mark}`);
  }
  if (snapshot.gaps.length > 0) {
    lines.push(`Not available: ${snapshot.gaps.join(", ")}`);
  }
  return lines.join("\n").slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// Prepared answers: common questions answered by code, zero extra reads.
// ---------------------------------------------------------------------------

type Intent = {
  readonly topic: SnapshotTopic | "WHO_HERE";
  readonly test: RegExp;
  readonly lead: string;
};

// Order matters: the first match wins.
const INTENTS: readonly Intent[] = [
  {
    topic: "WHO_HERE",
    test: /\b(who(?:'s| is| are)? (?:here|on (?:the|this) (?:call|meeting)|in (?:the|this) (?:call|meeting)|joining)|who are we (?:meeting|speaking)|introduce (?:everyone|us))\b/i,
    lead: "",
  },
  {
    topic: "AGENDA",
    test: /\b(agenda|what are we (?:here )?(?:to )?(?:discuss|cover|talking about)|purpose of (?:the|this) (?:call|meeting)|why are we (?:here|meeting)|what(?:'s| is) (?:this|the) (?:call|meeting) about)\b/i,
    lead: "",
  },
  {
    topic: "MANDATE",
    test: /\b(mandate|what (?:does|do) (?:the )?(?:investor|they|your fund|the fund) (?:invest|back|look for|focus)|investment (?:focus|thesis|criteria)|cheque|check size|ticket size)\b/i,
    lead: "On the published mandate: ",
  },
  {
    topic: "DECK",
    test: /\b(deck|pitch(?: deck)?|key claims?|slide \d+|traction|what (?:does|did) the (?:deck|pitch) say)\b/i,
    lead: "From the deck: ",
  },
  {
    topic: "DOCUMENT",
    test: /\b(documents?|data ?room|what (?:has|have) been shared|which files?|shared files?)\b/i,
    lead: "Shared so far: ",
  },
  {
    topic: "TERMS",
    test: /\b(terms?|valuation|round size|what are we raising|raising|term sheet|instrument)\b/i,
    lead: "On terms: ",
  },
  {
    topic: "OPEN_POINT",
    test: /\b(open (?:points?|items?|questions?)|outstanding|what(?:'s| is) left|still to (?:cover|discuss))\b/i,
    lead: "Open points: ",
  },
  {
    topic: "COMPANY",
    test: /\b(what (?:does|do) (?:the |your )?(?:company|they|you|\w+) do|tell (?:me|us) about (?:the |your )?(?:company|business)|company (?:summary|overview)|about (?:the )?company)\b/i,
    lead: "",
  },
  {
    topic: "RELATIONSHIP",
    test: /\b(history|previous(?:ly)?|last time|last (?:call|meeting)|how (?:long )?have we|where did we leave)\b/i,
    lead: "",
  },
  {
    topic: "APPROVAL",
    test: /\b(approv(?:al|e)s?|sign[- ]?off|who has to (?:approve|agree))\b/i,
    lead: "Needs approval: ",
  },
];

export type PreparedAnswer = {
  readonly topic: string;
  readonly line: string;
  /** Fact ids used, so the record can cite them. */
  readonly sourceRefs: readonly string[];
};

/**
 * Null when the question is not a prepared one, or nothing the ROOM may
 * hear is prepared for it (the model then answers from the permitted
 * context, or says it does not know). Never reads anything.
 */
export function answerFromSnapshot(
  snapshot: MeetingContextSnapshot,
  audience: Audience,
  utterance: string,
): PreparedAnswer | null {
  const intent = INTENTS.find((candidate) => candidate.test.test(utterance));
  if (intent === undefined) return null;
  if (intent.topic === "WHO_HERE") {
    if (snapshot.participants.length === 0) return null;
    const line = snapshot.participants
      .slice(0, 8)
      .map(
        (p) =>
          `${p.name}${p.role === null ? "" : `, ${p.role}`}, ${p.organisation}`,
      )
      .join("; ");
    return {
      topic: intent.topic,
      line: `On the booking: ${line}.`,
      sourceRefs: [],
    };
  }
  if (intent.topic === "AGENDA" && snapshot.agenda.length > 0) {
    return {
      topic: intent.topic,
      line: snapshot.agenda.slice(0, 500),
      sourceRefs: [],
    };
  }
  const usable = factsFor(snapshot, audience).filter(
    (f) => f.topic === intent.topic,
  );
  if (usable.length === 0) return null;
  const used = usable.slice(0, 3);
  const body = used.map((f) => f.text.replace(/[.\s]+$/, "")).join(". ");
  return {
    topic: intent.topic,
    line: `${intent.lead}${body}.`.slice(0, 520),
    sourceRefs: used.map((f) => f.id),
  };
}
