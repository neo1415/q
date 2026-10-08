import type {
  QPageManifest,
  QManifestRefKind,
  QManifestSectionKind,
  QResultBlock,
} from "@capital-q/contracts";
import type { QConversationMessage } from "@capital-q/q-runtime";

/**
 * RECOVERY-2026-10 B6: what "the second one", "not that investor, the
 * second one", "compare those two", "go back to what we were discussing"
 * and "book a meeting with him" point at, across pages and modalities.
 *
 * Code binds the words to concrete records from three places, all of which
 * already exist without a new store:
 *   - the page's own lists (the manifest's sections, ids in screen order);
 *   - the lists Q showed (answer and comparison cards on Q's messages);
 *   - what the conversation focused on, newest first: the records Q opened
 *     (OPEN_RECORD_PAGE intents on its messages) and the cards' subjects.
 * Messages are durable and shared by voice and text, so the focus survives
 * a deploy, another q-api instance, and a switch between speaking and
 * typing (Scenario G).
 *
 * Binding is not authority: every id here came from a read the person was
 * already allowed (a page they see, an answer they got), and opening or
 * acting on it still goes through the tools' own authorize steps.
 */

export type EntityKind = "COMPANY" | "INVESTOR_ORGANISATION" | "DOCUMENT";

export type ConversationEntity = {
  readonly kind: EntityKind;
  readonly id: string;
  /** The name when Q showed it; null for a page ref (ids only). */
  readonly name: string | null;
};

export type ShownList = {
  readonly via: "PAGE" | "Q_ANSWER";
  readonly items: readonly ConversationEntity[];
};

export type ReferenceAsk =
  | {
      readonly kind: "ORDINAL";
      /** 1-based; -1 is the last. */
      readonly position: number;
      /** "the second investor": only that kind counts. */
      readonly entityKind: EntityKind | null;
      /** "not that one, the second": the current focus is excluded. */
      readonly correction: boolean;
    }
  | { readonly kind: "PAIR" }
  | { readonly kind: "BACK" }
  | { readonly kind: "COUNTERPART" };

export type ResolvedReference =
  | {
      readonly kind: "ONE";
      readonly entity: ConversationEntity;
      readonly via: ShownList["via"] | "FOCUS";
    }
  | { readonly kind: "PAIR"; readonly entities: readonly ConversationEntity[] };

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  "1st": 1,
  one: 1,
  second: 2,
  "2nd": 2,
  two: 2,
  third: 3,
  "3rd": 3,
  three: 3,
  fourth: 4,
  "4th": 4,
  four: 4,
  fifth: 5,
  "5th": 5,
  five: 5,
  sixth: 6,
  "6th": 6,
  six: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  last: -1,
};

const KIND_WORDS: readonly [RegExp, EntityKind][] = [
  [/\b(?:investors?|funds?|firms?|vcs?|backers?)\b/iu, "INVESTOR_ORGANISATION"],
  [/\b(?:compan(?:y|ies)|startups?|businesse?s?|founders?)\b/iu, "COMPANY"],
  [/\b(?:documents?|docs?|files?|decks?|reports?)\b/iu, "DOCUMENT"],
];

const ORDINAL_WORD =
  /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|1st|2nd|3rd|[4-6]th)\s+(one|investors?|funds?|firms?|compan(?:y|ies)|startups?|documents?|docs?|decks?|cards?|results?|options?|ones?)?\b|\bnumber\s+(one|two|three|four|five|six|\d)\b/iu;

/** "not that (one|investor)", "no, the other", "wrong one": a correction. */
const CORRECTION =
  /\b(?:not\s+(?:that|this|the)\s+(?:one|investor|company|fund|firm|document)|no[,.]?\s+(?:not\s+(?:that|this)|the\s+other)|wrong\s+one|i\s+meant)\b/iu;

const PAIR =
  /\b(?:compare|contrast|versus|vs\.?)\b.*\b(?:those|these|the|them|both)\s*(?:two|2)?\b|\b(?:those|these)\s+two\b|\bcompare\s+them\b|\bboth\s+of\s+them\b/iu;

const BACK =
  /\b(?:go(?:ing)?\s+back|back)\s+to\s+(?:what|the\s+(?:one|thing|company|investor)|where)\s+(?:we\s+were\s+(?:discussing|talking\s+about|on)|we\s+discussed|before|earlier)|\b(?:as\s+we\s+were\s+saying|where\s+were\s+we|the\s+one\s+(?:before|we\s+discussed\s+before))\b/iu;

/** A person pointed at by pronoun, for a meeting, a message or an intro. */
const COUNTERPART =
  /\b(?:with|to|email|message|call|ping|meet|book|introduce\s+me\s+to)\s+(?:him|her|them)\b/iu;

/** What the words point at, if they point at all. */
export function referenceAskOf(text: string): ReferenceAsk | null {
  const said = text.replace(/[’]/gu, "'");
  if (PAIR.test(said)) return { kind: "PAIR" };
  if (BACK.test(said)) return { kind: "BACK" };
  const ordinal = ORDINAL_WORD.exec(said);
  if (ordinal !== null) {
    const word = (ordinal[1] ?? ordinal[3] ?? "").toLowerCase();
    const position =
      ORDINALS[word] ?? (/^\d$/u.test(word) ? Number(word) : null);
    if (position !== null) {
      // The kind named with the ordinal wins ("the second investor"); a
      // correction names the kind in its first half ("not that investor").
      const kindText = `${ordinal[2] ?? ""} ${said.slice(0, ordinal.index)}`;
      const entityKind =
        KIND_WORDS.find(([pattern]) => pattern.test(kindText))?.[1] ?? null;
      return {
        kind: "ORDINAL",
        position,
        entityKind,
        correction: CORRECTION.test(said),
      };
    }
  }
  if (COUNTERPART.test(said)) return { kind: "COUNTERPART" };
  return null;
}

const REF_KINDS: Partial<Record<QManifestRefKind, EntityKind>> = {
  COMPANY: "COMPANY",
  INVESTOR_ORGANISATION: "INVESTOR_ORGANISATION",
  ARTIFACT: "DOCUMENT",
  UPLOADED_DOCUMENT: "DOCUMENT",
};

/** Sections that are lists a person counts through. */
const LIST_SECTIONS: ReadonlySet<QManifestSectionKind> = new Set([
  "COMPANY_FEED",
  "COMPANY_LIST",
  "INVESTOR_LIST",
  "RELATIONSHIP_LIST",
  "DOCUMENT_LIST",
  "UPLOAD_LIST",
  "GATEQ_INBOX",
]);

/**
 * The page's lists, the ones in view first, each in screen order. Only
 * refs of a kind Q can open count; the rest keep no place in the count.
 */
export function listsFromManifest(
  manifest: QPageManifest | null | undefined,
): readonly ShownList[] {
  if (manifest === undefined || manifest === null) return [];
  const inView = new Set(manifest.inView);
  const sections = [...manifest.sections]
    .filter((section) => LIST_SECTIONS.has(section.kind))
    .sort((a, b) => Number(inView.has(b.id)) - Number(inView.has(a.id)));
  return sections.flatMap((section): ShownList[] => {
    const items = section.refs.flatMap((ref): ConversationEntity[] => {
      const kind = REF_KINDS[ref.kind];
      return kind === undefined ? [] : [{ kind, id: ref.id, name: null }];
    });
    return items.length === 0 ? [] : [{ via: "PAGE", items }];
  });
}

function blockEntities(block: QResultBlock): ConversationEntity[] {
  if (block.kind === "ANSWER_CARDS") {
    return block.cards.flatMap((card): ConversationEntity[] => {
      const subject = card.subject;
      if (subject?.kind === "COMPANY") {
        return [{ kind: "COMPANY", id: subject.companyId, name: card.name }];
      }
      if (subject?.kind === "INVESTOR_ORGANISATION") {
        return [
          {
            kind: "INVESTOR_ORGANISATION",
            id: subject.investorOrganisationId,
            name: card.name,
          },
        ];
      }
      return [];
    });
  }
  if (block.kind === "ARTIFACT_REFERENCE") {
    return [{ kind: "DOCUMENT", id: block.artifactId, name: block.title }];
  }
  return [];
}

/** Q's lists, newest answer first: the cards it showed, in their order. */
export function listsFromHistory(
  history: readonly QConversationMessage[],
): readonly ShownList[] {
  const lists: ShownList[] = [];
  for (const message of [...history].reverse()) {
    if (message.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "ANSWER_CARDS") continue;
      const items = blockEntities(block);
      if (items.length > 0) lists.push({ via: "Q_ANSWER", items });
    }
    if (lists.length >= 4) break;
  }
  return lists;
}

/**
 * What the conversation was about, newest first, one entry per record:
 * what Q opened (its OPEN_RECORD_PAGE intents) and what its cards and
 * documents named. Read from the durable messages, so every modality and
 * every q-api instance sees the same focus.
 */
export function focusFromHistory(
  history: readonly QConversationMessage[],
): readonly ConversationEntity[] {
  const seen = new Set<string>();
  const focus: ConversationEntity[] = [];
  const add = (entity: ConversationEntity) => {
    const key = `${entity.kind}:${entity.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    focus.push(entity);
  };
  for (const message of [...history].reverse()) {
    if (message.role !== "Q") continue;
    const blocks = message.blocks ?? [];
    // What Q opened is the strongest focus of that answer.
    for (const block of blocks) {
      if (block.kind !== "UI_INTENT") continue;
      const intent = block.intent;
      if (intent.kind !== "OPEN_RECORD_PAGE") continue;
      if (intent.page === "COMPANY") {
        add({ kind: "COMPANY", id: intent.id, name: null });
      } else if (intent.page === "INVESTOR") {
        add({ kind: "INVESTOR_ORGANISATION", id: intent.id, name: null });
      }
    }
    for (const block of blocks) {
      if (block.kind === "COMPARISON_CARDS") continue;
      for (const entity of blockEntities(block)) add(entity);
    }
    if (focus.length >= 12) break;
  }
  return focus.slice(0, 12);
}

/**
 * Binds an ask to records. The newest list is the one meant: Q's own list
 * when Q's latest answer showed one (it was just said), else the page's
 * list in view, else an older Q list. Null: nothing it can point at, and
 * the turn is read as before.
 */
export function resolveReference(
  ask: ReferenceAsk,
  context: {
    readonly page: readonly ShownList[];
    readonly answers: readonly ShownList[];
    /** True when Q's latest message carried cards. */
    readonly answerIsNewest: boolean;
    readonly focus: readonly ConversationEntity[];
  },
): ResolvedReference | null {
  const lists = context.answerIsNewest
    ? [
        ...context.answers.slice(0, 1),
        ...context.page,
        ...context.answers.slice(1),
      ]
    : [...context.page, ...context.answers];
  const current = context.focus[0] ?? null;
  switch (ask.kind) {
    case "ORDINAL": {
      for (const list of lists) {
        const items = list.items.filter(
          (item) => ask.entityKind === null || item.kind === ask.entityKind,
        );
        if (items.length === 0) continue;
        const index = ask.position === -1 ? items.length - 1 : ask.position - 1;
        const entity = items[index];
        if (entity === undefined) continue;
        // "Not that one, the second": a correction never lands back on the
        // record they just rejected.
        if (
          ask.correction &&
          current !== null &&
          entity.kind === current.kind &&
          entity.id === current.id
        ) {
          continue;
        }
        return { kind: "ONE", entity, via: list.via };
      }
      return null;
    }
    case "PAIR": {
      const [first, second] = context.focus;
      if (
        first !== undefined &&
        second !== undefined &&
        first.kind === second.kind
      ) {
        return { kind: "PAIR", entities: [first, second] };
      }
      const list = lists.find((one) => one.items.length >= 2);
      return list === undefined
        ? null
        : { kind: "PAIR", entities: list.items.slice(0, 2) };
    }
    case "BACK": {
      // The topic before the current one.
      const previous = context.focus[1];
      return previous === undefined
        ? null
        : { kind: "ONE", entity: previous, via: "FOCUS" };
    }
    case "COUNTERPART": {
      const counterpart = context.focus.find(
        (entity) =>
          entity.kind === "INVESTOR_ORGANISATION" || entity.kind === "COMPANY",
      );
      return counterpart === undefined
        ? null
        : { kind: "ONE", entity: counterpart, via: "FOCUS" };
    }
  }
}

const KIND_LABEL: Readonly<Record<EntityKind, string>> = {
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor",
  DOCUMENT: "document",
};

function described(entity: ConversationEntity): string {
  const name = entity.name === null ? "" : `"${entity.name.slice(0, 60)}" `;
  return `${name}(${KIND_LABEL[entity.kind]} ${entity.id})`;
}

/**
 * Capital Q's note of what the turn points at, for the reader and the
 * answer: trusted (code-made from records the person already saw), with
 * ids so a tool can read the record. Never the person's words.
 */
export function resolutionNote(
  ask: ReferenceAsk,
  resolved: ResolvedReference,
): string {
  const what =
    ask.kind === "ORDINAL"
      ? `${ask.position === -1 ? "the last" : `number ${String(ask.position)}`}${ask.entityKind === null ? "" : ` ${KIND_LABEL[ask.entityKind]}`}${ask.correction ? " (a correction: not the one before)" : ""}`
      : ask.kind === "PAIR"
        ? "the two to compare"
        : ask.kind === "BACK"
          ? "what was being discussed before"
          : "the person they mean";
  const bound =
    resolved.kind === "ONE"
      ? described(resolved.entity)
      : resolved.entities.map(described).join(" and ");
  return `RESOLVED: ${what} = ${bound}.`;
}
