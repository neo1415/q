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
