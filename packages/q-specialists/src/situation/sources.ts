import { z } from "zod";

import {
  DeckCoachingSchema,
  ProfileFindingsResponseSchema,
  type QSituationFact,
  type QSituationSide,
  type QSituationSource,
} from "@capital-q/contracts";
import {
  FindProspectiveInvestorsOutputSchema,
  GetCapitalObjectiveOutputSchema,
  GetInvestorMandateOutputSchema,
  GetQDailyOutputSchema,
  ListIncomingInterestOutputSchema,
  ListMyRelationshipsOutputSchema,
  ReadMyOutputSchema,
} from "@capital-q/q-tools";

/**
 * Situation-first planning, S2: which typed read answers each source, and
 * how its output becomes facts. Every read is a Q tool the chat already
 * calls, executed through the tool port as the asker (validate ->
 * authorise -> execute), so nothing here can read more than the person
 * could ask Q for in chat. Fact text is written here, by code, from the
 * tool's validated output; a model never writes a fact.
 *
 * Reads are shared across sources (one list_my_relationships answers
 * relationships, messages and feed decisions), so the dossier costs one
 * tool call per distinct read, never one per item.
 */

/** A fact before its dossier label is given. */
export type SituationRawFact = Omit<QSituationFact, "ref">;

/** One typed read: the tool and its arguments. `key` dedupes shared reads. */
export type SituationRead = {
  readonly key: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
};

export type SituationSubject =
  | { readonly side: "FOUNDER"; readonly companyId: string }
  | { readonly side: "INVESTOR"; readonly investorOrganisationId: string };

/** A source's reads' data, in the order of its reads. */
export type SituationFormat = (
  data: readonly unknown[],
  side: QSituationSide,
) => readonly SituationRawFact[] | null;

export type SituationSourceSpec = {
  readonly source: QSituationSource;
  readonly reads: (subject: SituationSubject) => readonly SituationRead[];
  /** Null: the output did not validate; the source is not known. */
  readonly format: SituationFormat;
  /**
   * Public-safe topics the source's reads yield (owner 2026-10-29: the
   * places and sectors of the person's own declared context are public
   * vocabulary, not private facts). Words only: never a figure, a name of
   * someone they deal with, or a document's content.
   */
  readonly topics?:
    ((data: readonly unknown[]) => readonly string[]) | undefined;
};

// --- shared words -------------------------------------------------------------

const TEXT_MAX = 1_000;

const clip = (text: string, max = TEXT_MAX): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const day = (iso: string | null | undefined): string | null => {
  if (iso === null || iso === undefined) return null;
  const match = /^\d{4}-\d{2}-\d{2}/u.exec(iso);
  return match === null ? null : match[0];
};

/** An instant for `asOf`, or a calendar day, or null when unreadable. */
const asOfOf = (iso: string | null | undefined): string | null => {
  if (iso === null || iso === undefined) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return iso;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? day(iso) : new Date(ms).toISOString();
};

const words = (code: string): string => code.toLowerCase().replace(/_/gu, " ");

const quote = (text: string, max = 300): string =>
  `"${clip(text.trim(), max)}"`;

type FactBase = Pick<
  SituationRawFact,
  "truthClass" | "evidenceStatus" | "label" | "category"
>;

const PLATFORM: Omit<FactBase, "label"> = {
  truthClass: "VERIFIED",
  evidenceStatus: "PLATFORM_VERIFIED",
  category: null,
};

function fact(
  tool: string,
  base: FactBase,
  statement: string,
  options: {
    readonly asOf?: string | null | undefined;
    readonly record?: SituationRawFact["provenance"]["record"];
    readonly url?: string | null;
  } = {},
): SituationRawFact {
  return {
    statement: clip(statement),
    ...base,
    asOf: asOfOf(options.asOf),
    provenance: {
      tool,
      record: options.record ?? null,
      url: options.url ?? null,
    },
  };
}

function parsed<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

// --- tool names -----------------------------------------------------------------

export const SITUATION_TOOLS = {
  relationships: "list_my_relationships",
  interest: "list_incoming_interest",
  prospects: "find_prospective_investors",
  coaching: "coach_my_deck",
  dataRoom: "read_company_data_room",
  readMy: "read_my",
  record: "read_my_record",
  capital: "get_capital_objective",
  schedule: "list_schedule",
  board: "my_board",
  work: "list_q_work",
  approvals: "list_pending_approvals",
  daily: "get_q_daily",
  mandate: "get_investor_mandate",
} as const;

const RELATIONSHIPS_READ: SituationRead = {
  key: "relationships",
  tool: SITUATION_TOOLS.relationships,
  args: {},
};

const readMy = (kind: string): SituationRead => ({
  key: `read_my:${kind}`,
  tool: SITUATION_TOOLS.readMy,
  args: { kind },
});

const companyIdOf = (subject: SituationSubject): string | null =>
  subject.side === "FOUNDER" ? subject.companyId : null;

// --- formatters -----------------------------------------------------------------

const relationshipsOf = (data: unknown) =>
  parsed(ListMyRelationshipsOutputSchema, data);

function formatRelationships(
  data: readonly unknown[],
): SituationRawFact[] | null {
  const read = relationshipsOf(data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.relationships;
  if (read.relationships.length === 0) {
    return [
      fact(
        tool,
        { ...PLATFORM, label: "personal_private" },
        "No relationships on record yet.",
      ),
    ];
  }
  return [...read.relationships]
    .sort((a, b) => Date.parse(b.stateSince) - Date.parse(a.stateSince))
    .map((relationship) =>
      fact(
        tool,
        { ...PLATFORM, label: "relationship_shared" },
        `${relationship.counterpart.name}: ${words(relationship.state)} since ${
          day(relationship.stateSince) ?? "an unknown date"
        }; next step: ${words(relationship.nextStep)}.`,
        {
          asOf: relationship.stateSince,
          record: { kind: "RELATIONSHIP", id: relationship.relationshipId },
        },
      ),
    );
}

function formatMessages(data: readonly unknown[]): SituationRawFact[] | null {
  const read = relationshipsOf(data[0]);
  if (read === null) return null;
  const readable = read.relationships.filter(
    (relationship) => relationship.messagesRead === "OK",
  );
  // Every chat unreadable: messages are not known (never "no messages").
  if (read.relationships.length > 0 && readable.length === 0) return null;
  const tool = SITUATION_TOOLS.relationships;
  const facts = readable.flatMap((relationship) => {
    const last = relationship.lastMessage;
    if (last === null) return [];
    const who = relationship.counterpart.name;
    return [
      fact(
        tool,
        { ...PLATFORM, label: "relationship_shared" },
        last.from === "THEM"
          ? `${who} wrote last (${day(last.at) ?? "date unknown"}) and is waiting for a reply: ${quote(last.preview)}`
          : `You wrote last to ${who} (${day(last.at) ?? "date unknown"}): ${quote(last.preview)}`,
        {
          asOf: last.at,
          record: { kind: "RELATIONSHIP", id: relationship.relationshipId },
        },
      ),
    ];
  });
  return facts.sort((a, b) => (b.asOf ?? "").localeCompare(a.asOf ?? ""));
}

function formatFeedDecisions(
  data: readonly unknown[],
): SituationRawFact[] | null {
  const read = relationshipsOf(data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.relationships;
  const base: FactBase = { ...PLATFORM, label: "investor_private" };
  return [
    ...read.saved.map((company) =>
      fact(
        tool,
        base,
        `You saved ${company.name} in Discover (a save is not interest).`,
        {
          record: { kind: "COMPANY", id: company.companyId },
        },
      ),
    ),
    ...read.passed.map((company) =>
      fact(tool, base, `You passed on ${company.name} in Discover.`, {
        record: { kind: "COMPANY", id: company.companyId },
      }),
    ),
  ];
}

const ANSWER_WORDS = {
  PENDING: "you have not answered yet",
  ACCEPTED: "you accepted",
  DECLINED: "you declined",
} as const;

function formatInterest(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(ListIncomingInterestOutputSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.interest;
  return [...read.interests]
    .sort((a, b) => Date.parse(b.expressedAt) - Date.parse(a.expressedAt))
    .map((interest) =>
      fact(
        tool,
        { ...PLATFORM, label: "relationship_shared" },
        `${interest.investorName} (${interest.investorType}) expressed interest on ${
          day(interest.expressedAt) ?? "an unknown date"
        }; ${ANSWER_WORDS[interest.answer]}.${
          interest.note === null
            ? " No note."
            : ` Their note: ${quote(interest.note, 500)}`
        }`,
        {
          asOf: interest.expressedAt,
          record: {
            kind: "INVESTOR_ORGANISATION",
            id: interest.investorOrganisationId,
          },
        },
      ),
    );
}

function formatProspects(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(FindProspectiveInvestorsOutputSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.prospects;
  return read.prospects.map((prospect) => {
    const parts = [
      `${prospect.name}${prospect.investorType === null ? "" : ` (${prospect.investorType}${prospect.hqCountry === null ? "" : `, ${prospect.hqCountry}`})`}: a likely fit to check, not evidence of interest.`,
    ];
    const gate = prospect.gate ?? null;
    if (gate !== null) {
      const by = (standing: "MET" | "NOT_MET" | "UNKNOWN") =>
        gate.criteria
          .filter((c) => c.standing === standing)
          .map((c) => c.label);
      const met = by("MET");
      const notMet = by("NOT_MET");
      const unknown = by("UNKNOWN");
      parts.push(
        `Their published gate "${gate.title}" (${gate.acceptingApplications ? "accepting applications" : "not accepting applications"}):` +
          `${met.length > 0 ? ` met: ${met.join(", ")};` : ""}` +
          `${notMet.length > 0 ? ` not met: ${notMet.join(", ")};` : ""}` +
          `${unknown.length > 0 ? ` not known yet: ${unknown.join(", ")};` : ""}`,
      );
    }
    if (prospect.sector !== undefined && prospect.sector.fit !== "UNKNOWN") {
      parts.push(
        `Published sector ${prospect.sector.focus ?? ""} ${prospect.sector.fit === "MATCH" ? "matches" : "does not match"} yours.`,
      );
    }
    return fact(
      tool,
      {
        truthClass: "Q_INFERENCE",
        evidenceStatus: "SELF_REPORTED",
        label: "network_visible",
        category: null,
      },
      parts.join(" ").replace(/\s+/gu, " "),
      {
        record: {
          kind: "INVESTOR_ORGANISATION",
          id: prospect.investorOrganisationId,
        },
      },
    );
  });
}

const CoachOutputSchema = z
  .object({ deckTitle: z.string(), coaching: DeckCoachingSchema })
  .passthrough();

function formatDeck(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(CoachOutputSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.coaching;
  const base: FactBase = {
    truthClass: "Q_INFERENCE",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    label: "founder_private",
    category: null,
  };
  const { coaching } = read;
  const facts = [
    fact(
      tool,
      base,
      `Deck "${read.deckTitle}": ${String(coaching.sectionsAtStandard)} of ${String(coaching.sections.length)} sections at standard; ${
        coaching.atMinimumStandard ? "meets" : "does not yet meet"
      } the minimum standard.`,
    ),
  ];
  const weakest = [...coaching.sections]
    .filter((section) => !section.atStandard)
    .sort((a, b) => a.score - b.score);
  for (const section of weakest) {
    facts.push(
      fact(
        tool,
        base,
        `Deck section ${words(section.section)} scores ${String(section.score)}/5${
          section.requiredForMinimum ? " (needed for the minimum standard)" : ""
        }${section.gaps.length > 0 ? `; missing or weak: ${section.gaps.join("; ")}` : ""}${
          section.improve === null ? "" : `. To improve: ${section.improve}`
        }`,
      ),
    );
  }
  for (const check of coaching.checks.filter((c) => !c.passed)) {
    facts.push(
      fact(
        tool,
        base,
        `Deck check not passed (${words(check.code)}): ${check.words}`,
      ),
    );
  }
  return facts;
}

const DataRoomOutputSchema = z
  .object({
    documents: z.array(
      z
        .object({ title: z.string(), folder: z.string(), status: z.string() })
        .passthrough(),
    ),
    openRequests: z.number().int().min(0),
  })
  .passthrough();

function formatDataRoom(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(DataRoomOutputSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.dataRoom;
  const base: FactBase = { ...PLATFORM, label: "organisation_private" };
  return [
    fact(
      tool,
      base,
      `Data room: ${String(read.documents.length)} documents; ${String(read.openRequests)} open requests from investors.`,
    ),
    ...read.documents.map((document) =>
      fact(
        tool,
        base,
        `Data room document "${document.title}" in ${document.folder}: ${document.status}.`,
      ),
    ),
  ];
}

/** Fields whose value speaks for itself: shown without their name. */
const SELF_SPEAKING = new Set(["oneLine", "summary", "description", "title"]);

/**
 * One detail of a record in plain words: "stage: seed", never a field name
 * such as "oneLine:" (live 2026-10-29: "oneLine: Ledgerline checks every
 * invoice…" reached the person).
 */
export function detailWords(key: string, value: string): string {
  if (SELF_SPEAKING.has(key)) return value;
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/_/gu, " ")
    .toLowerCase();
  return `${words}: ${value}`;
}

/** read_my items: their own records exactly as their page shows them. */
function readMyFacts(
  data: unknown,
  base: FactBase,
  prefix: string,
): SituationRawFact[] | null {
  const read = parsed(ReadMyOutputSchema, data);
  if (read === null || !read.available) return null;
  return read.items.map((item) => {
    const details = Object.entries(item.facts)
      .filter(([, value]) => value !== null && value !== "")
      .slice(0, 8)
      .map(([key, value]) => detailWords(key, String(value)))
      .join("; ");
    return fact(
      SITUATION_TOOLS.readMy,
      base,
      `${prefix}${item.title} — ${item.status}${details.length > 0 ? ` (${details})` : ""}.`,
      { asOf: item.at },
    );
  });
}

function formatReadiness(data: readonly unknown[]): SituationRawFact[] | null {
  const base: FactBase = { ...PLATFORM, label: "founder_private" };
  const readiness = readMyFacts(data[0], base, "Readiness: ");
  const plan = readMyFacts(data[1], base, "Action plan step: ");
  if (readiness === null && plan === null) return null;
  return [...(readiness ?? []), ...(plan ?? [])];
}

function formatClaims(data: readonly unknown[]): SituationRawFact[] | null {
  const record = parsed(
    z
      .object({
        status: z.enum(["FOUND", "NONE", "TOO_LARGE"]),
        data: z.unknown(),
      })
      .strict(),
    data[0],
  );
  if (record === null || record.status === "TOO_LARGE") return null;
  if (record.status === "NONE") return [];
  const findings = parsed(ProfileFindingsResponseSchema, record.data);
  if (findings === null) return null;
  return findings.findings.map((finding) => {
    const lifecycle =
      finding.lifecycleStatus === "CURRENT"
        ? ""
        : ` [${words(finding.lifecycleStatus)}]`;
    const source = finding.sources[0];
    return {
      statement: clip(`${finding.statement}${lifecycle}`),
      truthClass: finding.truthClass,
      evidenceStatus: finding.evidenceStatus,
      label: "organisation_private",
      category: null,
      asOf: asOfOf(finding.recordedAt),
      provenance: {
        tool: SITUATION_TOOLS.record,
        record: {
          kind: "PUBLIC_PAGE",
          id: source?.url.slice(0, 200) ?? finding.id,
        },
        url: null,
      },
    } satisfies SituationRawFact;
  });
}

/** COMPANY_NETWORK_PREVIEW: how investors on the network see them. */
function formatProfile(data: readonly unknown[]): SituationRawFact[] | null {
  const record = parsed(
    z
      .object({
        status: z.enum(["FOUND", "NONE", "TOO_LARGE"]),
        data: z.unknown(),
      })
      .strict(),
    data[0],
  );
  if (record === null || record.status === "TOO_LARGE") return null;
  if (record.status === "NONE") return [];
  const base: FactBase = { ...PLATFORM, label: "network_visible" };
  return flatten(record.data)
    .slice(0, 12)
    .map((line) =>
      fact(
        SITUATION_TOOLS.record,
        base,
        `Investors on the network see: ${line}`,
      ),
    );
}

/** Top-level fields of a record as "field: value" lines (bounded). */
function flatten(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [];
  const lines: string[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (field === null || field === undefined || field === "") continue;
    if (
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean"
    ) {
      lines.push(`${key}: ${clip(String(field), 400)}`);
    } else if (Array.isArray(field)) {
      const shown = field
        .filter(
          (item): item is string | number =>
            typeof item === "string" || typeof item === "number",
        )
        .slice(0, 6)
        .map(String);
      lines.push(
        `${key}: ${shown.length > 0 ? shown.join(", ") : `${String(field.length)} entries`}`,
      );
    }
  }
  return lines;
}

function formatCapital(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(GetCapitalObjectiveOutputSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.capital;
  const base: FactBase = {
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    label: "founder_private",
    category: "RAISE_TARGET",
  };
  if (read.availability !== "CURRENT" || read.objective === null) {
    // NONE is "no current objective on record" -- never "not raising".
    return [
      fact(
        tool,
        base,
        "No current raise is on record (not known whether they are raising).",
      ),
    ];
  }
  const objective = read.objective;
  const target = `${objective.target.currency} ${objective.target.amount}`;
  const facts = [
    fact(
      tool,
      base,
      `Current raise (${words(objective.objectiveType)}, ${words(objective.status)}): target ${clip(target, 200)}${
        objective.targetStage === null ? "" : `, stage ${objective.targetStage}`
      }${objective.instrumentCode === null ? "" : `, instrument ${objective.instrumentCode}`}; started ${
        day(objective.startedAt) ?? "date unknown"
      }.`,
      {
        asOf: objective.startedAt,
        record: { kind: "COMPANY", id: read.companyId },
      },
    ),
  ];
  if (objective.targetCloseDate !== null) {
    facts.push(
      fact(
        tool,
        { ...base, category: "FUNDING_DEADLINE" },
        `They aim to close the raise by ${objective.targetCloseDate}.`,
        { asOf: objective.startedAt },
      ),
    );
  }
  return facts;
}

const ScheduleOutputSchema = z
  .object({
    meetings: z.array(
      z
        .object({
          id: z.string(),
          relationshipId: z.string(),
          purpose: z.string(),
          startsAt: z.string(),
          with: z.array(z.string()),
          brief: z.string().nullable(),
        })
        .passthrough(),
    ),
    reminders: z.array(
      z
        .object({ id: z.string(), title: z.string(), dueAt: z.string() })
        .passthrough(),
    ),
  })
  .passthrough();

function formatSchedule(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(ScheduleOutputSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.schedule;
  const base: FactBase = { ...PLATFORM, label: "personal_private" };
  return [
    ...read.meetings.map((meeting) =>
      fact(
        tool,
        base,
        `Call "${meeting.purpose}" with ${meeting.with.join(", ") || "them"} on ${meeting.startsAt}${
          meeting.brief === null ? "" : " (prep brief ready)"
        }.`,
        { asOf: meeting.startsAt, record: { kind: "MEETING", id: meeting.id } },
      ),
    ),
    ...read.reminders.map((reminder) =>
      fact(tool, base, `Reminder "${reminder.title}" due ${reminder.dueAt}.`, {
        asOf: reminder.dueAt,
        record: { kind: "REMINDER", id: reminder.id },
      }),
    ),
  ];
}

const BoardListSchema = z
  .object({
    action: z.literal("LIST"),
    items: z.array(
      z
        .object({
          itemId: z.string(),
          kind: z.string(),
          title: z.string(),
          status: z.string(),
          dueOn: z.string().nullable(),
          workJobId: z.string().nullable(),
        })
        .passthrough(),
    ),
    more: z.number().int().min(0),
  })
  .passthrough();

function formatBoard(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(BoardListSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.board;
  const base: FactBase = { ...PLATFORM, label: "personal_private" };
  const open = read.items.filter((item) => item.status !== "DONE");
  return open.map((item) =>
    fact(
      tool,
      base,
      `On your board (${words(item.status)}): ${words(item.kind)} "${item.title}"${
        item.dueOn === null ? "" : `, due ${item.dueOn}`
      }${item.workJobId === null ? "" : "; Q is working on it"}.`,
      { asOf: item.dueOn, record: { kind: "BOARD_ITEM", id: item.itemId } },
    ),
  );
}

const WorkListSchema = z
  .object({
    items: z.array(
      z
        .object({
          delegationId: z.string(),
          kind: z.string(),
          status: z.string(),
          summary: z.string().nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const ApprovalsSchema = z
  .object({
    items: z.array(
      z
        .object({
          approvalId: z.string(),
          summary: z.string(),
          requestedAt: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function formatWork(data: readonly unknown[]): SituationRawFact[] | null {
  const work = parsed(WorkListSchema, data[0]);
  const approvals = parsed(ApprovalsSchema, data[1]);
  if (work === null && approvals === null) return null;
  const base: FactBase = { ...PLATFORM, label: "personal_private" };
  return [
    ...(approvals?.items ?? []).map((item) =>
      fact(
        SITUATION_TOOLS.approvals,
        base,
        `Waiting for your approval: ${item.summary}`,
        {
          asOf: item.requestedAt,
        },
      ),
    ),
    ...(work?.items ?? []).map((item) =>
      fact(
        SITUATION_TOOLS.work,
        base,
        `Q is working on (${words(item.kind)}, ${words(item.status)}): ${item.summary ?? "no summary recorded"}.`,
      ),
    ),
  ];
}

function formatDaily(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(GetQDailyOutputSchema, data[0]);
  if (read === null) return null;
  if (read.status !== "READY") return [];
  const tool = SITUATION_TOOLS.daily;
  // Reported by a publisher, not checked by Capital Q.
  const base: FactBase = {
    truthClass: "UNKNOWN",
    evidenceStatus: "NO_EVIDENCE",
    label: "public_external",
    category: null,
  };
  return [
    ...read.headlines.map((headline) =>
      fact(
        tool,
        base,
        `In your Q Daily (${headline.section}): "${headline.headline}" (${headline.publisher}).`,
        {
          asOf: read.editionDate,
        },
      ),
    ),
    ...(read.qTake === null
      ? []
      : [
          fact(
            tool,
            { ...base, truthClass: "Q_INFERENCE" },
            `Q's take in your Q Daily: ${read.qTake}`,
            { asOf: read.editionDate },
          ),
        ]),
  ];
}

/** Taxonomy vocabularies whose codes name a market, never a figure or a name. */
const MARKET_VOCABULARIES = new Set([
  "industry",
  "product_category",
  "technology",
  "business_model",
  "customer_type",
  "impact_theme",
]);

const TOPIC_COUNTRIES_MAX = 4;
const TOPIC_SECTORS_MAX = 4;

/**
 * An investor's research topics from their declared mandates in force:
 * their sectors in each of their geographies ("fintech payments nigeria"),
 * or their sectors alone. Exclusions, cheques, stages and the
 * organisation's name never become a topic (CQ-Q-RESEARCH-001 §9).
 */
export function mandateTopics(data: readonly unknown[]): readonly string[] {
  const read = parsed(GetInvestorMandateOutputSchema, data[0]);
  if (read === null) return [];
  const plain = (code: string) =>
    code
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const places = new Set<string>();
  const sectors = new Set<string>();
  for (const mandate of read.mandates) {
    if (mandate.status === "CLOSED") continue;
    for (const preference of mandate.taxonomyPreferences) {
      if (preference.isExclusion) continue;
      const word = plain(preference.canonicalCode);
      if (word.length < 2) continue;
      if (preference.vocabularyCode === "geography") places.add(word);
      else if (MARKET_VOCABULARIES.has(preference.vocabularyCode))
        sectors.add(word);
    }
  }
  const market = [...sectors].slice(0, TOPIC_SECTORS_MAX).join(" ");
  const topics =
    places.size === 0
      ? [market]
      : [...places]
          .slice(0, TOPIC_COUNTRIES_MAX)
          .map((place) => `${market} ${place}`.trim());
  return topics
    .filter((topic) => topic.length >= 2)
    .map((topic) => topic.slice(0, 120));
}

function formatMandate(data: readonly unknown[]): SituationRawFact[] | null {
  const read = parsed(GetInvestorMandateOutputSchema, data[0]);
  if (read === null) return null;
  const tool = SITUATION_TOOLS.mandate;
  const base: FactBase = {
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    label: "investor_private",
    category: "INVESTOR_THESIS",
  };
  const facts = [
    fact(
      tool,
      base,
      `${read.displayName}${read.investorType === null ? "" : ` (${read.investorType})`}: deployment ${
        read.deploymentState ?? "not answered"
      }; ${String(read.mandates.length)} active mandate(s).`,
      {
        record: {
          kind: "INVESTOR_ORGANISATION",
          id: read.investorOrganisationId,
        },
      },
    ),
  ];
  for (const mandate of read.mandates) {
    const cheque =
      mandate.cheque === null
        ? "cheque not declared"
        : `cheque ${mandate.cheque.currency} ${[
            mandate.cheque.min,
            mandate.cheque.typical,
            mandate.cheque.max,
          ]
            .map((v) => v ?? "?")
            .join(" / ")} (min / typical / max)`;
    const stages = `stages ${mandate.stage.minStageCode ?? "any"} to ${mandate.stage.maxStageCode ?? "any"}`;
    const sectors = mandate.taxonomyPreferences
      .filter((p) => !p.isExclusion)
      .slice(0, 8)
      .map((p) => p.canonicalCode);
    const excluded = mandate.taxonomyPreferences
      .filter((p) => p.isExclusion)
      .slice(0, 8)
      .map((p) => p.canonicalCode);
    const hard = mandate.constraints.filter((c) => c.isHardExclusion).length;
    facts.push(
      fact(
        tool,
        base,
        `Mandate v${String(mandate.version)} (${words(mandate.status)}): ${cheque}; ${stages}${
          sectors.length > 0 ? `; prefers ${sectors.join(", ")}` : ""
        }${excluded.length > 0 ? `; excludes ${excluded.join(", ")}` : ""}; ${String(hard)} hard exclusion rule(s).`,
        { record: { kind: "MANDATE", id: mandate.mandateId } },
      ),
    );
  }
  return facts;
}

function formatGateq(data: readonly unknown[]): SituationRawFact[] | null {
  // Founders' applications to them: shared with them by the applicant.
  return readMyFacts(
    data[0],
    { ...PLATFORM, label: "specifically_shared" },
    "GateQ application: ",
  );
}

function formatFeed(data: readonly unknown[]): SituationRawFact[] | null {
  return readMyFacts(
    data[0],
    { ...PLATFORM, label: "network_visible" },
    "In your Discover feed: ",
  );
}

function formatPitchVideo(data: readonly unknown[]): SituationRawFact[] | null {
  return readMyFacts(
    data[0],
    { ...PLATFORM, label: "organisation_private" },
    "Pitch video: ",
  );
}

// --- the catalogue ------------------------------------------------------------------

const founderOnly =
  (reads: (companyId: string) => readonly SituationRead[]) =>
  (subject: SituationSubject): readonly SituationRead[] => {
    const companyId = companyIdOf(subject);
    return companyId === null ? [] : reads(companyId);
  };

const investorOnly =
  (reads: (investorOrganisationId: string) => readonly SituationRead[]) =>
  (subject: SituationSubject): readonly SituationRead[] =>
    subject.side === "INVESTOR" ? reads(subject.investorOrganisationId) : [];

/**
 * Tool-backed sources. MEMORY and ACTIVITY come from their own ports, and
 * PUBLIC from the bounded research hook, in the assembler.
 */
export const SITUATION_SOURCE_SPECS: readonly SituationSourceSpec[] = [
  {
    source: "RELATIONSHIPS",
    reads: () => [RELATIONSHIPS_READ],
    format: (d) => formatRelationships(d),
  },
  {
    source: "MESSAGES",
    reads: () => [RELATIONSHIPS_READ],
    format: (d) => formatMessages(d),
  },
  {
    source: "SCHEDULE",
    reads: () => [
      { key: "schedule", tool: SITUATION_TOOLS.schedule, args: {} },
    ],
    format: (d) => formatSchedule(d),
  },
  {
    source: "BOARD",
    reads: () => [
      { key: "board", tool: SITUATION_TOOLS.board, args: { action: "LIST" } },
    ],
    format: (d) => formatBoard(d),
  },
  {
    source: "Q_WORK",
    reads: () => [
      { key: "work", tool: SITUATION_TOOLS.work, args: {} },
      { key: "approvals", tool: SITUATION_TOOLS.approvals, args: {} },
    ],
    format: (d) => formatWork(d),
  },
  {
    source: "Q_DAILY",
    reads: () => [{ key: "daily", tool: SITUATION_TOOLS.daily, args: {} }],
    format: (d) => formatDaily(d),
  },
  {
    source: "INTEREST",
    reads: founderOnly((companyId) => [
      { key: "interest", tool: SITUATION_TOOLS.interest, args: { companyId } },
    ]),
    format: (d) => formatInterest(d),
  },
  {
    source: "PROSPECTS",
    reads: (subject) =>
      subject.side === "FOUNDER"
        ? [
            {
              key: "prospects",
              tool: SITUATION_TOOLS.prospects,
              args: { companyId: subject.companyId, limit: 8 },
            },
          ]
        : [readMy("feed")],
    format: (d, side) =>
      side === "FOUNDER" ? formatProspects(d) : formatFeed(d),
  },
  {
    source: "PROFILE",
    reads: founderOnly(() => [
      {
        key: "network_preview",
        tool: SITUATION_TOOLS.record,
        args: { record: "COMPANY_NETWORK_PREVIEW" },
      },
    ]),
    format: (d) => formatProfile(d),
  },
  {
    source: "DECK",
    reads: founderOnly(() => [
      { key: "coaching", tool: SITUATION_TOOLS.coaching, args: {} },
    ]),
    format: (d) => formatDeck(d),
  },
  {
    source: "DATA_ROOM",
    reads: founderOnly((companyId) => [
      { key: "data_room", tool: SITUATION_TOOLS.dataRoom, args: { companyId } },
    ]),
    format: (d) => formatDataRoom(d),
  },
  {
    source: "PITCH_VIDEO",
    reads: founderOnly(() => [readMy("media")]),
    format: (d) => formatPitchVideo(d),
  },
  {
    source: "READINESS",
    reads: founderOnly(() => [readMy("readiness"), readMy("plan")]),
    format: (d) => formatReadiness(d),
  },
  {
    source: "CLAIMS",
    reads: founderOnly(() => [
      {
        key: "findings",
        tool: SITUATION_TOOLS.record,
        args: { record: "PROFILE_FINDINGS" },
      },
    ]),
    format: (d) => formatClaims(d),
  },
  {
    source: "CAPITAL",
    reads: founderOnly((companyId) => [
      { key: "capital", tool: SITUATION_TOOLS.capital, args: { companyId } },
    ]),
    format: (d) => formatCapital(d),
  },
  {
    source: "MANDATE",
    reads: investorOnly((investorOrganisationId) => [
      {
        key: "mandate",
        tool: SITUATION_TOOLS.mandate,
        args: { investorOrganisationId },
      },
    ]),
    format: (d) => formatMandate(d),
    topics: (d) => mandateTopics(d),
  },
  {
    source: "GATEQ",
    reads: investorOnly(() => [readMy("gateq")]),
    format: (d) => formatGateq(d),
  },
  {
    source: "FEED_DECISIONS",
    reads: investorOnly(() => [RELATIONSHIPS_READ]),
    format: (d) => formatFeedDecisions(d),
  },
];
