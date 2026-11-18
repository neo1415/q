import type { QAccountDigest } from "@capital-q/contracts";

import { nameKey } from "./card-subjects.js";

/**
 * Owner live 18 Nov 2026 (Zino Aviation, conversation b0719e94): "apart
 * from the companies I'm already connected to" ranked Halyard Security,
 * Clearwater Assurance and Nixo, then dropped them; a turn later Q said
 * Zino was "not connected" with Nixo, which Zino has invested in. Each path
 * had its own idea of who the person is in touch with: a relationship id
 * list, the twelve relationships the digest lists, or a model's reading.
 *
 * One function decides, and the exclusion, the answers' stage check and
 * the pipeline read it. A company is in contact when any of these holds:
 *
 *   - the canonical relationship (company x investor organisation) is at
 *     any stage beyond DISCOVERED -- interest either way, connected, a
 *     meeting, diligence, paused, passed, declined or invested. Messages,
 *     meetings, commitments and investments all hang on that one
 *     relationship row (communication.conversations, communication.meetings
 *     and network.commitments carry relationship_id), so a commitment or an
 *     investment is always contact through it;
 *   - a GateQ application from the company is in their inbox (an inbound
 *     application is contact). Applications are named by the applicant,
 *     not by a canonical company id, so these match by name.
 *
 * Nothing here calls a model or reads beyond the digest and the
 * relationships read already in hand.
 */
export type InContact = {
  /** Canonical counterpart ids (companies or investor organisations). */
  readonly ids: ReadonlySet<string>;
  /** Name keys (card-subjects `nameKey`) of GateQ applicants. */
  readonly names: ReadonlySet<string>;
};

export const NO_CONTACT: InContact = { ids: new Set(), names: new Set() };

/** Stages that are not contact: the company was only seen. */
const NOT_CONTACT: ReadonlySet<string> = new Set(["DISCOVERED"]);

type OwnRelationshipRow = {
  readonly state?: unknown;
  readonly counterpart?: {
    readonly kind?: unknown;
    readonly id?: unknown;
    readonly name?: unknown;
  };
};

/**
 * Who the person is in contact with, from the account digest and (when
 * this turn read it) their own relationships list (list_my_relationships'
 * data). Either may be missing; what is known is used, never guessed.
 */
export function inContactOf(
  digest: QAccountDigest | null,
  own?: unknown,
): InContact {
  const ids = new Set<string>();
  const names = new Set<string>();
  const stages = digest?.relationshipStages;
  if (stages !== undefined) {
    for (const row of stages) {
      if (!NOT_CONTACT.has(row.stage)) ids.add(row.counterpartId);
    }
  } else {
    // An older digest without stages: every relationship row it counted.
    for (const id of digest?.relationshipCounterpartIds ?? []) ids.add(id);
  }
  const rows =
    own !== null && typeof own === "object"
      ? (own as { readonly relationships?: unknown }).relationships
      : undefined;
  if (Array.isArray(rows)) {
    for (const row of rows as readonly OwnRelationshipRow[]) {
      const id = row.counterpart?.id;
      if (typeof id !== "string") continue;
      if (typeof row.state === "string" && NOT_CONTACT.has(row.state)) {
        continue;
      }
      ids.add(id);
    }
  }
  for (const applicant of digest?.gateq?.inbox?.applicants ?? []) {
    const key = nameKey(applicant);
    if (key.length >= 3) names.add(key);
  }
  return { ids, names };
}

/** Whether one company is in contact, by id or (GateQ) by name. */
export function inContactWith(
  contact: InContact,
  company: { readonly id: string; readonly name?: string | null | undefined },
): boolean {
  if (contact.ids.has(company.id)) return true;
  const name = company.name ?? "";
  return name.length > 0 && contact.names.has(nameKey(name));
}

/**
 * An answer that says, in its own words, that what it lists leaves out
 * their contacts ("with no recorded contact", "outside your connected
 * companies", "that you haven't been in touch with"). Such a list is held
 * to the rule above exactly as a stated exclusion is.
 */
const LEFT_OUT_CONTACTS =
  /\b(?:with\s+no\s+(?:recorded\s+|existing\s+|prior\s+)?(?:contact|relationship|connection)|outside\s+(?:of\s+)?your\s+(?:connected|existing|current)\s+(?:companies|relationships|contacts|pipeline)|(?:that|which|whom)\s+you(?:'re|\s+are|'ve|\s+have)?\s+(?:not|n't|never|haven'?t|have\s+not)\s+(?:yet\s+|been\s+|already\s+)*(?:in\s+(?:touch|contact)|connected)\s+with\b|not\s+already\s+(?:in\s+(?:touch|contact)|connected))/iu;

export function claimsLeftOutContacts(content: string): boolean {
  return LEFT_OUT_CONTACTS.test(content.replace(/[’]/gu, "'"));
}

/** A set of ids (older callers) or the shared reading, as the reading. */
export function asInContact(
  value: ReadonlySet<string> | InContact | null | undefined,
): InContact {
  if (value === null || value === undefined) return NO_CONTACT;
  if ("ids" in value) return value;
  return { ids: value, names: new Set() };
}

/**
 * Live 18 Nov 2026 (fictional Savanna, run cce59657): "Am I in contact
 * with any of those?", right after Q ranked three companies "apart from the
 * ones you're in contact with", came back as a side-by-side comparison of
 * them, the contact status last and in a model's words. When the reading
 * says the turn asks about their contact with particular companies
 * (TURN_READER v94 `contactStatus`), the answer is this: each company
 * meant, said as in contact or not by the one rule above, with its stage
 * from the same records. Nothing here calls a model.
 */
export type ContactSubject = {
  readonly id: string;
  readonly name: string;
};

const STAGE_SAID: Readonly<Record<string, string>> = {
  DISCOVERED: "discovered",
  INTEREST_EXPRESSED: "interest expressed",
  CONNECTED: "connected",
  DECLINED: "declined",
  MEETING_HELD: "meeting held",
  IN_DILIGENCE: "in diligence",
  PAUSED: "paused",
  PASSED: "passed",
  INVESTED: "invested",
};

/**
 * Each counterpart's relationship stage: this turn's own relationships
 * read first (the fresher), then the digest's stages.
 */
export function contactStagesOf(
  digest: QAccountDigest | null,
  own?: unknown,
): ReadonlyMap<string, string> {
  const stages = new Map<string, string>();
  const rows =
    own !== null && typeof own === "object"
      ? (own as { readonly relationships?: unknown }).relationships
      : undefined;
  if (Array.isArray(rows)) {
    for (const row of rows as readonly OwnRelationshipRow[]) {
      const id = row.counterpart?.id;
      if (typeof id === "string" && typeof row.state === "string") {
        stages.set(id, row.state);
      }
    }
  }
  for (const row of digest?.relationshipStages ?? []) {
    if (!stages.has(row.counterpartId)) {
      stages.set(row.counterpartId, row.stage);
    }
  }
  return stages;
}

/**
 * The companies a contact-status question means: those the reading bound
 * (named from the cards Q showed, else from their own relationships), or,
 * when it bound none and named no one else, every company on Q's newest
 * cards ("any of those"). Null when one meant cannot be named from these
 * records: the full path answers then, never a guess.
 */
export function contactSubjectsOf(input: {
  readonly referenced: readonly string[];
  readonly shown: readonly {
    readonly companyId: string;
    readonly name: string;
  }[];
  readonly namedOther: boolean;
  readonly digest: QAccountDigest | null;
  readonly own?: unknown;
}): readonly ContactSubject[] | null {
  const names = new Map<string, string>();
  for (const row of input.digest?.relationshipStages ?? []) {
    names.set(row.counterpartId, row.name);
  }
  const rows =
    input.own !== null && typeof input.own === "object"
      ? (input.own as { readonly relationships?: unknown }).relationships
      : undefined;
  if (Array.isArray(rows)) {
    for (const row of rows as readonly OwnRelationshipRow[]) {
      const { id, name } = row.counterpart ?? {};
      if (typeof id === "string" && typeof name === "string") {
        names.set(id, name);
      }
    }
  }
  for (const card of input.shown) names.set(card.companyId, card.name);
  if (input.referenced.length > 0) {
    const subjects = input.referenced.map((id) => ({
      id,
      name: names.get(id) ?? "",
    }));
    return subjects.every((subject) => subject.name.length > 0)
      ? subjects
      : null;
  }
  if (input.namedOther || input.shown.length === 0) return null;
  return input.shown.map((card) => ({ id: card.companyId, name: card.name }));
}

const listed = (names: readonly string[], joiner: "and" | "or"): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1) ?? ""}`;

const COUNT_SAID = ["no", "one", "two", "three", "four", "five", "six"];

/**
 * Whether they are in contact with each company meant, and at what stage.
 * Null with no company to answer about.
 */
export function contactStatusAnswer(
  subjects: readonly ContactSubject[],
  contact: InContact,
  stages: ReadonlyMap<string, string>,
): string | null {
  const unique = subjects.filter(
    (subject, index, all) =>
      subject.name.trim().length > 0 &&
      all.findIndex((other) => other.id === subject.id) === index,
  );
  if (unique.length === 0) return null;
  const inTouch = unique.filter((subject) => inContactWith(contact, subject));
  const notInTouch = unique.filter(
    (subject) => !inContactWith(contact, subject),
  );
  const stageOf = (subject: ContactSubject): string => {
    const stage = stages.get(subject.id);
    if (stage !== undefined && !NOT_CONTACT.has(stage)) {
      return STAGE_SAID[stage] ?? stage.toLowerCase().replace(/_/gu, " ");
    }
    // In contact by the GateQ inbox alone.
    return "applied to you through GateQ";
  };
  // A relationship row only at DISCOVERED: seen, never contact.
  const seenOnly = notInTouch
    .filter((subject) => NOT_CONTACT.has(stages.get(subject.id) ?? ""))
    .map((subject) => subject.name);
  const notInTouchNames = notInTouch.map((subject) => subject.name);
  const why = (): string => {
    if (seenOnly.length === 0) {
      return notInTouch.length === 1
        ? "it has no relationship with you yet"
        : notInTouch.length === 2
          ? "neither has a relationship with you yet"
          : "none has a relationship with you yet";
    }
    const verb = seenOnly.length === 1 ? "is" : "are";
    return seenOnly.length === notInTouch.length
      ? `${listed(seenOnly, "and")} ${verb} only discovered so far, with no contact yet`
      : `${listed(seenOnly, "and")} ${verb} only discovered so far; the others have no relationship with you yet`;
  };
  if (inTouch.length === 0) {
    return `No. You're not in contact with ${listed(notInTouchNames, "or")}; ${why()}.`;
  }
  const opening =
    unique.length === 1
      ? "Yes."
      : inTouch.length === unique.length
        ? unique.length === 2
          ? "Yes, both."
          : `Yes, all ${COUNT_SAID[unique.length] ?? String(unique.length)}.`
        : `Yes, ${COUNT_SAID[inTouch.length] ?? String(inTouch.length)} of them.`;
  const yes = `You're in contact with ${listed(
    inTouch.map((subject) => `${subject.name} (${stageOf(subject)})`),
    "and",
  )}.`;
  if (notInTouch.length === 0) return `${opening} ${yes}`;
  const no = `You're not in contact with ${listed(notInTouchNames, "or")} yet${
    seenOnly.length > 0 ? `: ${why()}` : ""
  }.`;
  return `${opening} ${yes} ${no}`;
}
