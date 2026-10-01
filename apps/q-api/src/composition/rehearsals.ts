import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  REHEARSAL_HAND_RAISED_SIGNAL,
  REHEARSAL_SILENCE_SIGNAL,
  type RehearsalDifficulty,
  type ModelDataPosture,
  type PersonaSourceKind,
  type QPersonaSourceDto,
  type QRehearsalCounterpartDto,
  type QRehearsalDto,
  type QRehearsalListDto,
  type QRehearsalPartnersDto,
  type QRehearsalPersonaDto,
  type QRehearsalReviewDto,
  type RehearsalCounterpartKind,
  type RehearsalOutcome as RehearsalConclusion,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  CounterpartPersonaResultSchema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  InvestorPersonaResultSchema,
  CounterpartPersonaLenientSchema,
  normaliseCounterpartPersona,
  normaliseRehearsalReview,
  RehearsalReviewLenientSchema,
  RehearsalReviewResultSchema,
  RehearsalTurnV3ResultSchema,
  renderPrompt,
  type CounterpartPersonaResult,
  type CounterpartPersonaVariables,
  type RehearsalReviewResult,
  type RehearsalReviewVariables,
  type RehearsalTurnV3Result as RehearsalTurnResult,
  type RehearsalTurnV3Variables as RehearsalTurnVariables,
} from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

/**
 * Rehearsals (C12 Investor Twin, generalised by REHEARSE, founder direction
 * 2026-10-01; docs/specs/2026-10/rehearse.md). A person rehearses a meeting
 * with someone they are connected to -- a founder with an investor, an
 * investor with a company -- played by Q from a persona profile.
 *
 * Context Firewall: every input to the persona comes through the material
 * port, which answers for the rehearsing person's own side only (what they
 * may already see). The persona is kept per viewer, with its sources, as
 * Q inference about style: it writes nothing to Knowledge, and nothing
 * said in a rehearsal becomes a fact, a claim, a memory or a relationship
 * event. The other person never sees any of it.
 *
 * Latency: the persona is built before the call (the lobby) and reused
 * while its material is unchanged; each spoken turn is one bounded model
 * call.
 */

export type ViewerRole = "FOUNDER" | "INVESTOR";

export type PersonaSource = {
  readonly kind: PersonaSourceKind;
  readonly label: string;
  readonly url: string | null;
  /** A web snippet, kept so a refresh can reuse it; never sent to a browser. */
  readonly excerpt?: string | undefined;
};

/** A piece of material with where it came from. */
export type Sourced = {
  readonly text: string;
  readonly sources: readonly PersonaSource[];
};

/** What the rehearsing person may see, from their own side only. */
export type RehearsalMaterial = {
  /** Who is rehearsing; null when they are neither a founder nor an investor. */
  readonly viewer: (actor: ActorContext) => Promise<{
    readonly role: ViewerRole;
    readonly organisationName: string;
  } | null>;
  /** The counterpart as this viewer may see them; null when they may not. */
  readonly counterpart: (
    actor: ActorContext,
    kind: RehearsalCounterpartKind,
    id: string,
  ) => Promise<{
    readonly name: string;
    readonly profile: string;
    readonly relationshipId: string | null;
  } | null>;
  /** What their side wrote to this viewer, oldest first. */
  readonly theirMessages: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<string>;
  /** What was said in calls this viewer was on with them. */
  readonly theirCalls: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<string>;
  /** Public knowledge and pitch material this viewer may see of them. */
  readonly counterpartMaterial: (
    actor: ActorContext,
    kind: RehearsalCounterpartKind,
    id: string,
  ) => Promise<Sourced>;
  /** The public web about them (a provider search): sparing, at most weekly. */
  readonly publicWeb: (
    actor: ActorContext,
    name: string,
    kind: RehearsalCounterpartKind,
  ) => Promise<Sourced>;
  /** A founder's own company material (profile, pitch, deck) to be asked about. */
  readonly ownMaterial: (actor: ActorContext) => Promise<Sourced>;
  /** Their own relationships, as their side sees them. */
  readonly relationships: (actor: ActorContext) => Promise<
    readonly {
      readonly relationshipId: string;
      readonly kind: RehearsalCounterpartKind;
      readonly id: string;
      readonly name: string;
      readonly state: string;
    }[]
  >;
  /** Their own upcoming meetings. */
  readonly upcomingMeetings: (actor: ActorContext) => Promise<
    readonly {
      readonly meetingId: string;
      readonly relationshipId: string;
      readonly startsAt: string;
      readonly purpose: string;
    }[]
  >;
};

type FrameKeys =
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes";

export type RehearsalImage = {
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly dataBase64: string;
};

export type RehearsalComposer = {
  readonly persona: (
    actor: ActorContext,
    variables: Omit<CounterpartPersonaVariables, FrameKeys>,
  ) => Promise<CounterpartPersonaResult | null>;
  readonly turn: (
    actor: ActorContext,
    variables: Omit<RehearsalTurnVariables, FrameKeys>,
    image: RehearsalImage | null,
    signal?: AbortSignal,
  ) => Promise<RehearsalTurnResult | null>;
  readonly review: (
    actor: ActorContext,
    variables: Omit<RehearsalReviewVariables, FrameKeys>,
  ) => Promise<RehearsalReviewResult | null>;
};

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

const MOODS = [
  "WARM",
  "NEUTRAL",
  "SKEPTICAL",
  "IMPATIENT",
  "ANNOYED",
  "ENTHUSIASTIC",
  "COLD",
  "INDIFFERENT",
  "ANGRY",
  "SAD",
  "AUTHORITATIVE",
  "MEEK",
  "SARCASTIC",
  "AMUSED",
] as const;
type Mood = (typeof MOODS)[number];

/** A stored turn; C12 rows used INVESTOR / FOUNDER. */
const StoredTurnSchema = z.object({
  from: z.enum(["THEM", "YOU", "INVESTOR", "FOUNDER"]),
  text: z.string().max(4_000),
  at: z.string(),
  mood: z.enum(MOODS).nullish(),
  sawScreen: z.boolean().optional(),
  intensity: z.enum(["SOFT", "NORMAL", "RAISED"]).optional(),
  reaction: z.enum(["LAUGH", "CHUCKLE", "SIGH"]).nullish(),
});

export type Turn = {
  readonly from: "THEM" | "YOU";
  readonly text: string;
  readonly at: string;
  readonly mood: Mood | null;
  readonly sawScreen: boolean;
  /** How loud the played person said it, and any sound before it. */
  readonly intensity?: "SOFT" | "NORMAL" | "RAISED" | undefined;
  readonly reaction?: "LAUGH" | "CHUCKLE" | "SIGH" | null | undefined;
};

export function normaliseTurns(raw: unknown, role: ViewerRole): Turn[] {
  const parsed = z.array(StoredTurnSchema).safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.map((turn) => {
    const legacyThem =
      (turn.from === "INVESTOR" && role === "FOUNDER") ||
      (turn.from === "FOUNDER" && role === "INVESTOR");
    return {
      from: turn.from === "THEM" || legacyThem ? "THEM" : "YOU",
      text: turn.text,
      at: turn.at,
      mood: turn.mood ?? null,
      sawScreen: turn.sawScreen === true,
      ...(turn.intensity === undefined ? {} : { intensity: turn.intensity }),
      ...(turn.reaction === undefined ? {} : { reaction: turn.reaction }),
    };
  });
}

/** The persona a rehearsal row holds: v2, or a C12 (v1) reading. */
function personaOf(raw: unknown): CounterpartPersonaResult | null {
  const v2 = CounterpartPersonaResultSchema.safeParse(raw);
  if (v2.success) return v2.data;
  const v1 = InvestorPersonaResultSchema.safeParse(raw);
  if (!v1.success) return null;
  return {
    summary: v1.data.summary,
    style: v1.data.style.slice(0, 400),
    temperament: { baseline: "NEUTRAL", warmsTo: [], coolsOn: [] },
    priorities: v1.data.priorities,
    likelyQuestions: v1.data.likelyQuestions,
    likelyAnswers: [],
    pushbacks: v1.data.pushbacks,
    howToWin: v1.data.howToWin,
    dealbreakers: [],
    grounding: v1.data.grounding,
  };
}

export function personaText(persona: CounterpartPersonaResult): string {
  const list = (items: readonly string[]) => items.join("; ") || "not known";
  return [
    `Who they are: ${persona.summary}`,
    `How they speak: ${persona.style}`,
    `Baseline mood: ${persona.temperament.baseline}. Warms to: ${list(persona.temperament.warmsTo)}. Cools on: ${list(persona.temperament.coolsOn)}.`,
    `Priorities: ${list(persona.priorities)}`,
    "Likely questions:",
    ...persona.likelyQuestions.map((q) => `- ${q.question} (${q.why})`),
    ...(persona.likelyAnswers.length === 0
      ? []
      : [
          "How they answer:",
          ...persona.likelyAnswers.map((a) => `- ${a.topic}: ${a.answer}`),
        ]),
    `How they push back: ${list(persona.pushbacks)}`,
    `What wins them over: ${list(persona.howToWin)}`,
    `Dealbreakers: ${list(persona.dealbreakers)}`,
    `Grounding: ${persona.grounding}`,
  ].join("\n");
}

/** The whole meeting handed to a model, newest kept when long. */
const REHEARSAL_TEXT_MAX = 24_000;
const MAX_TURNS = 160;
/** After this, the person Q plays steers to a close. */
const WRAP_UP_MINUTES = 30;
const WRAP_UP_TURNS = 70;
/** The public web is read about a counterpart at most this often. */
const WEB_READ_EVERY_MS = 7 * 24 * 3_600_000;

function transcriptOf(
  turns: readonly Turn[],
  name: string,
  viewerRole: ViewerRole = "FOUNDER",
): string {
  // The rehearsing side by role, so the played person never mistakes
  // whose lines are whose.
  const them = `${viewerRole === "FOUNDER" ? "The founder" : "The investor"} (rehearsing)`;
  if (turns.length === 0) return "(nothing said yet)";
  const text = turns
    .map(
      (turn) =>
        `${turn.from === "THEM" ? name : them}${turn.sawScreen ? " [their screen in view]" : ""}: ${turn.text}`,
    )
    .join("\n");
  return text.length <= REHEARSAL_TEXT_MAX
    ? text
    : text.slice(text.length - REHEARSAL_TEXT_MAX);
}

/** Ratings in words become a score by a fixed rule, never by a model. */
const RATING_POINTS = { STRONG: 90, SOLID: 70, NEEDS_WORK: 40 } as const;
export function scoreOf(
  dimensions: readonly { readonly rating: keyof typeof RATING_POINTS }[],
): number | null {
  if (dimensions.length === 0) return null;
  const total = dimensions.reduce(
    (sum, dimension) => sum + RATING_POINTS[dimension.rating],
    0,
  );
  return Math.round(total / dimensions.length);
}

export function digestOf(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\u0000");
  return hash.digest("hex").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type PersonaRow = {
  readonly id: string;
  readonly subjectName: string;
  readonly profile: unknown;
  readonly sources: unknown;
  readonly signalDigest: string;
  readonly webReadAt: Date | null;
  readonly refreshedAt: Date;
};

export type RehearsalRow = {
  readonly id: string;
  readonly counterpartKind: RehearsalCounterpartKind;
  readonly counterpartId: string;
  readonly counterpartName: string;
  readonly userRole: ViewerRole;
  readonly persona: unknown;
  readonly turns: unknown;
  readonly asked: number;
  readonly status: "ACTIVE" | "FINISHED";
  readonly outcome: RehearsalConclusion | null;
  readonly score: number | null;
  readonly scorecard: unknown;
  readonly meetingId: string | null;
  readonly voice: "FEMALE" | "MALE" | null;
  readonly difficulty: RehearsalDifficulty;
  readonly createdAt: Date;
  readonly endedAt: Date | null;
};

export type RehearsalStore = {
  readonly findPersona: (
    actor: ActorContext,
    kind: RehearsalCounterpartKind,
    id: string,
  ) => Promise<PersonaRow | null>;
  readonly savePersona: (
    actor: ActorContext,
    input: {
      readonly kind: RehearsalCounterpartKind;
      readonly id: string;
      readonly name: string;
      readonly relationshipId: string | null;
      readonly profile: CounterpartPersonaResult;
      readonly sources: readonly PersonaSource[];
      readonly signalDigest: string;
      readonly webReadAt: Date | null;
    },
  ) => Promise<PersonaRow>;
  readonly insert: (
    actor: ActorContext,
    input: {
      readonly id: string;
      readonly kind: RehearsalCounterpartKind;
      readonly counterpartId: string;
      readonly name: string;
      readonly role: ViewerRole;
      readonly relationshipId: string | null;
      readonly meetingId: string | null;
      readonly personaProfileId: string;
      readonly persona: CounterpartPersonaResult;
      readonly turns: readonly Turn[];
      readonly voice: "FEMALE" | "MALE";
      readonly difficulty: RehearsalDifficulty;
    },
  ) => Promise<RehearsalRow>;
  /** Only the person's own row, in their own tenant. */
  readonly own: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<RehearsalRow | null>;
  /** Guarded on ACTIVE and not ended: a closed rehearsal is never written. */
  readonly saveTurns: (
    actor: ActorContext,
    rehearsalId: string,
    input: {
      readonly turns: readonly Turn[];
      readonly asked: number;
      readonly outcome: RehearsalConclusion | null;
      readonly ended: boolean;
    },
  ) => Promise<RehearsalRow | null>;
  readonly finish: (
    actor: ActorContext,
    rehearsalId: string,
    input: {
      readonly outcome: RehearsalConclusion;
      readonly score: number | null;
      readonly review: RehearsalReviewResult | null;
    },
  ) => Promise<RehearsalRow | null>;
  readonly list: (
    actor: ActorContext,
    filter?: {
      readonly kind: RehearsalCounterpartKind;
      readonly id: string;
    },
  ) => Promise<readonly RehearsalRow[]>;
};

type RawRehearsalRow = {
  id: string;
  counterpart_kind: RehearsalCounterpartKind;
  counterpart_id: string;
  counterpart_name: string;
  user_role: ViewerRole;
  persona: unknown;
  turns: unknown;
  asked: number;
  status: "ACTIVE" | "FINISHED";
  outcome: RehearsalConclusion | null;
  score: number | null;
  scorecard: unknown;
  meeting_id: string | null;
  voice: "FEMALE" | "MALE" | null;
  difficulty: RehearsalDifficulty;
  created_at: Date;
  ended_at: Date | null;
};

function fromRaw(row: RawRehearsalRow): RehearsalRow {
  return {
    id: row.id,
    counterpartKind: row.counterpart_kind,
    counterpartId: row.counterpart_id,
    counterpartName: row.counterpart_name,
    userRole: row.user_role,
    persona: row.persona,
    turns: row.turns,
    asked: row.asked,
    status: row.status,
    outcome: row.outcome,
    score: row.score,
    scorecard: row.scorecard,
    meetingId: row.meeting_id,
    voice: row.voice,
    difficulty: row.difficulty,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

type RawPersonaRow = {
  id: string;
  subject_name: string;
  profile: unknown;
  sources: unknown;
  signal_digest: string;
  web_read_at: Date | null;
  refreshed_at: Date;
};
const personaFromRaw = (row: RawPersonaRow): PersonaRow => ({
  id: row.id,
  subjectName: row.subject_name,
  profile: row.profile,
  sources: row.sources,
  signalDigest: row.signal_digest,
  webReadAt: row.web_read_at,
  refreshedAt: row.refreshed_at,
});

/** Server-side reads and writes, always keyed on the acting person and tenant. */
export function createPostgresRehearsalStore(
  sql: DatabaseExecutor,
): RehearsalStore {
  const uuid = z.string().uuid();
  const json = (value: unknown) => sql.json(value as never);
  return {
    findPersona: async (actor, kind, id) => {
      const rows = await sql<RawPersonaRow[]>`
        select id, subject_name, profile, sources, signal_digest, web_read_at, refreshed_at
          from q_runtime.persona_profiles
         where viewer_user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
           and subject_kind = ${kind} and subject_id = ${id}
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : personaFromRaw(row);
    },
    savePersona: async (actor, input) => {
      const rows = await sql<RawPersonaRow[]>`
        insert into q_runtime.persona_profiles
          (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name,
           relationship_id, profile, sources, signal_digest, web_read_at)
        values (${actor.tenantId}, ${actor.userId}, ${input.kind}, ${input.id},
                ${input.name.slice(0, 200)}, ${input.relationshipId},
                ${json(input.profile)}, ${json(input.sources)},
                ${input.signalDigest}, ${input.webReadAt})
        on conflict (viewer_user_id, subject_kind, subject_id) do update
           set subject_name = excluded.subject_name,
               relationship_id = excluded.relationship_id,
               profile = excluded.profile,
               sources = excluded.sources,
               signal_digest = excluded.signal_digest,
               web_read_at = excluded.web_read_at,
               version = q_runtime.persona_profiles.version + 1,
               refreshed_at = clock_timestamp()
         where q_runtime.persona_profiles.tenant_id = ${actor.tenantId}
        returning id, subject_name, profile, sources, signal_digest, web_read_at, refreshed_at`;
      const row = rows[0];
      if (row === undefined) throw new Error("persona profile not saved");
      return personaFromRaw(row);
    },
    insert: async (actor, input) => {
      const investor = input.kind === "INVESTOR_ORGANISATION";
      const rows = await sql<RawRehearsalRow[]>`
        insert into q_runtime.rehearsals
          (id, tenant_id, user_id, organisation_id, investor_organisation_id,
           investor_name, counterpart_kind, counterpart_id, counterpart_name,
           user_role, relationship_id, meeting_id, persona_profile_id, persona,
           turns, asked, length, voice, difficulty)
        values
          (${input.id}, ${actor.tenantId}, ${actor.userId},
           ${actor.organisationId ?? null},
           ${investor ? input.counterpartId : null},
           ${investor ? input.name.slice(0, 200) : null},
           ${input.kind}, ${input.counterpartId}, ${input.name.slice(0, 200)},
           ${input.role}, ${input.relationshipId}, ${input.meetingId},
           ${input.personaProfileId}, ${json(input.persona)},
           ${json(input.turns)}, 0, 20, ${input.voice}, ${input.difficulty})
        returning id, counterpart_kind, counterpart_id, counterpart_name, user_role,
               persona, turns, asked, status, outcome, score, scorecard,
               meeting_id, voice, difficulty, created_at, ended_at`;
      const row = rows[0];
      if (row === undefined) throw new Error("rehearsal not saved");
      return fromRaw(row);
    },
    own: async (actor, rehearsalId) => {
      if (!uuid.safeParse(rehearsalId).success) return null;
      const rows = await sql<RawRehearsalRow[]>`
        select id, counterpart_kind, counterpart_id, counterpart_name, user_role,
               persona, turns, asked, status, outcome, score, scorecard,
               meeting_id, voice, difficulty, created_at, ended_at from q_runtime.rehearsals
         where id = ${rehearsalId} and user_id = ${actor.userId}
           and tenant_id = ${actor.tenantId}
         limit 1`;
      const row = rows[0];
      return row === undefined ? null : fromRaw(row);
    },
    saveTurns: async (actor, rehearsalId, input) => {
      const rows = await sql<RawRehearsalRow[]>`
        update q_runtime.rehearsals
           set turns = ${json(input.turns)}, asked = ${input.asked},
               outcome = coalesce(${input.outcome}, outcome),
               ended_at = case when ${input.ended} then clock_timestamp() else ended_at end,
               updated_at = clock_timestamp()
         where id = ${rehearsalId} and user_id = ${actor.userId}
           and tenant_id = ${actor.tenantId}
           and status = 'ACTIVE' and ended_at is null
        returning id, counterpart_kind, counterpart_id, counterpart_name, user_role,
               persona, turns, asked, status, outcome, score, scorecard,
               meeting_id, voice, difficulty, created_at, ended_at`;
      const row = rows[0];
      return row === undefined ? null : fromRaw(row);
    },
    finish: async (actor, rehearsalId, input) => {
      const rows = await sql<RawRehearsalRow[]>`
        update q_runtime.rehearsals
           set status = 'FINISHED', outcome = ${input.outcome},
               score = ${input.score},
               scorecard = ${input.review === null ? null : json(input.review)},
               ended_at = coalesce(ended_at, clock_timestamp()),
               updated_at = clock_timestamp()
         where id = ${rehearsalId} and user_id = ${actor.userId}
           and tenant_id = ${actor.tenantId} and status = 'ACTIVE'
        returning id, counterpart_kind, counterpart_id, counterpart_name, user_role,
               persona, turns, asked, status, outcome, score, scorecard,
               meeting_id, voice, difficulty, created_at, ended_at`;
      const row = rows[0];
      return row === undefined ? null : fromRaw(row);
    },
    list: async (actor, filter) => {
      const rows =
        filter === undefined
          ? await sql<RawRehearsalRow[]>`
              select id, counterpart_kind, counterpart_id, counterpart_name, user_role,
               persona, turns, asked, status, outcome, score, scorecard,
               meeting_id, voice, difficulty, created_at, ended_at from q_runtime.rehearsals
               where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
               order by created_at desc limit 50`
          : await sql<RawRehearsalRow[]>`
              select id, counterpart_kind, counterpart_id, counterpart_name, user_role,
               persona, turns, asked, status, outcome, score, scorecard,
               meeting_id, voice, difficulty, created_at, ended_at from q_runtime.rehearsals
               where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
                 and counterpart_kind = ${filter.kind}
                 and counterpart_id = ${filter.id}
               order by created_at desc limit 20`;
      return rows.map(fromRaw);
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type RehearsalResult =
  | { readonly kind: "OK"; readonly rehearsal: QRehearsalDto }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_A_PARTICIPANT" }
  | { readonly kind: "FINISHED" }
  | { readonly kind: "Q_UNAVAILABLE" };

export type PersonaResult =
  | { readonly kind: "OK"; readonly persona: QRehearsalPersonaDto }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_A_PARTICIPANT" }
  | { readonly kind: "Q_UNAVAILABLE" };

export type RehearsalSay =
  { readonly text: string } | { readonly cue: "HAND_RAISED" | "SILENCE" };

export type RehearsalService = {
  readonly partners: (actor: ActorContext) => Promise<QRehearsalPartnersDto>;
  readonly persona: (
    actor: ActorContext,
    kind: RehearsalCounterpartKind,
    id: string,
  ) => Promise<PersonaResult>;
  readonly meeting: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<QRehearsalCounterpartDto | null>;
  readonly start: (
    actor: ActorContext,
    input: {
      readonly kind: RehearsalCounterpartKind;
      readonly id: string;
      readonly meetingId?: string | undefined;
      readonly voice?: "FEMALE" | "MALE" | undefined;
      readonly difficulty?: RehearsalDifficulty | undefined;
    },
  ) => Promise<RehearsalResult>;
  readonly get: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<RehearsalResult>;
  readonly list: (
    actor: ActorContext,
    filter?: { readonly kind: RehearsalCounterpartKind; readonly id: string },
  ) => Promise<QRehearsalListDto>;
  /** One exchange: what they said (or a raised hand), and the reply. */
  readonly say: (
    actor: ActorContext,
    rehearsalId: string,
    said: RehearsalSay,
    signal?: AbortSignal,
  ) => Promise<RehearsalResult>;
  /** A frame of the person's shared screen, for the next turn only. */
  readonly screen: (
    actor: ActorContext,
    rehearsalId: string,
    image: RehearsalImage,
  ) => Promise<"OK" | "NOT_FOUND" | "FINISHED">;
  readonly finish: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<RehearsalResult>;
  /** The latest line the other person said, for a voice line's opening. */
  readonly opening: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<{
    readonly line: string;
    readonly name: string;
    /** Steady per counterpart, to keep their voice the same. */
    readonly seed: string;
    readonly voice: "FEMALE" | "MALE";
    readonly mood: Mood | null;
    readonly intensity: "SOFT" | "NORMAL" | "RAISED";
    readonly reaction: "LAUGH" | "CHUCKLE" | "SIGH" | null;
  } | null>;
};

function counterpartRoleOf(
  kind: RehearsalCounterpartKind,
): "INVESTOR" | "FOUNDER" {
  return kind === "INVESTOR_ORGANISATION" ? "INVESTOR" : "FOUNDER";
}

const StoredSourceSchema = z.object({
  kind: z.enum([
    "PROFILE",
    "MESSAGES",
    "CALLS",
    "PUBLIC_WEB",
    "PUBLIC_KNOWLEDGE",
    "PITCH_TRANSCRIPT",
    "DECK",
    "OWN_COMPANY",
  ]),
  label: z.string(),
  url: z.string().nullable().optional(),
  excerpt: z.string().optional(),
});

function storedSources(raw: unknown): PersonaSource[] {
  const parsed = z.array(StoredSourceSchema).safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.map((source) => ({
    kind: source.kind,
    label: source.label,
    url: source.url ?? null,
    excerpt: source.excerpt,
  }));
}

/** Sources as a browser sees them: no excerpts, https links only. */
function publicSources(raw: unknown): QPersonaSourceDto[] {
  return storedSources(raw)
    .slice(0, 24)
    .map((source) => ({
      kind: source.kind,
      label: source.label.slice(0, 200),
      url:
        source.url !== null && source.url.startsWith("https://")
          ? source.url.slice(0, 2048)
          : null,
    }));
}

function reviewDto(row: RehearsalRow): QRehearsalReviewDto | null {
  if (row.scorecard === null || row.scorecard === undefined) return null;
  const parsed = RehearsalReviewResultSchema.safeParse(row.scorecard);
  if (!parsed.success) return null;
  return { ...parsed.data, score: row.score };
}

const wordsIn = (text: string) =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

/** Counted from the transcript by code, never by a model. */
export function metricsOf(
  turns: readonly Turn[],
  createdAt: Date,
  endedAt: Date | null,
  now: Date,
): QRehearsalDto["metrics"] {
  let yours = 0;
  let theirs = 0;
  let longest = 0;
  let exchanges = 0;
  for (const turn of turns) {
    const words = wordsIn(turn.text);
    if (turn.from === "YOU") {
      yours += words;
      exchanges += 1;
      longest = Math.max(longest, words);
    } else {
      theirs += words;
    }
  }
  const total = yours + theirs;
  const last = turns.at(-1);
  const end =
    endedAt ?? (last === undefined ? now : new Date(Date.parse(last.at)));
  return {
    yourShareOfWords: total === 0 ? 0 : Math.round((yours / total) * 100),
    longestAnswerWords: longest,
    exchanges,
    minutes: Math.max(
      0,
      Math.round((end.getTime() - createdAt.getTime()) / 60_000),
    ),
  };
}

function toDto(
  row: RehearsalRow,
  previousScore: number | null = null,
  now: Date = new Date(),
): QRehearsalDto | null {
  const persona = personaOf(row.persona);
  if (persona === null) return null;
  const turns = normaliseTurns(row.turns, row.userRole);
  return {
    id: row.id,
    counterpart: {
      kind: row.counterpartKind,
      id: row.counterpartId,
      name: row.counterpartName,
    },
    userRole: row.userRole,
    status: row.status,
    outcome: row.outcome,
    meetingId: row.meetingId,
    voice: row.voice ?? "MALE",
    difficulty: row.difficulty,
    metrics: metricsOf(turns, row.createdAt, row.endedAt, now),
    previousScore,
    persona: {
      ...shownPersona(persona),
      grounding: persona.grounding,
    },
    turns: turns.map((turn) => ({
      from: turn.from,
      text: turn.text,
      at: new Date(turn.at).toISOString(),
      mood: turn.mood,
      sawScreen: turn.sawScreen,
      ...(turn.intensity === undefined ? {} : { intensity: turn.intensity }),
      ...(turn.reaction === undefined ? {} : { reaction: turn.reaction }),
    })),
    review: reviewDto(row),
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
  };
}

/**
 * A persona as the screen shows it, within the public contract's bounds
 * (QRehearsalPersonaDto: summary 600, style 400, six priorities of 200).
 * The stored reading may be longer (live 2026-10-01: once the reader's
 * bounds were relaxed, a persona with seven priorities made the persona
 * endpoint answer 500 and the lobby could not start). Cut at a sentence or
 * a word, never mid-word; the first priorities are the ones that matter.
 */
export function shownPersona(profile: {
  readonly summary: string;
  readonly style: string;
  readonly priorities: readonly string[];
}): { summary: string; style: string; priorities: string[] } {
  return {
    summary: clipText(profile.summary, 600),
    style: clipText(profile.style, 400),
    priorities: profile.priorities
      .slice(0, 6)
      .map((priority) => clipText(priority, 200)),
  };
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const sentence = Math.max(
    room.lastIndexOf(". "),
    room.lastIndexOf("! "),
    room.lastIndexOf("? "),
  );
  if (sentence >= max / 2) return room.slice(0, sentence + 1);
  const word = room.lastIndexOf(" ");
  return `${(word > 0 ? room.slice(0, word) : room).trimEnd()}…`;
}

/** A shared frame, held in memory for the next turn only; never persisted. */
type Frame = { readonly image: RehearsalImage; readonly at: number };
const FRAME_TTL_MS = 90_000;
const NO_MATERIAL: Sourced = { text: "", sources: [] };

type BuiltPersona = {
  readonly row: PersonaRow;
  readonly profile: CounterpartPersonaResult;
  readonly name: string;
  readonly relationshipId: string | null;
};

export function createRehearsalService(dependencies: {
  readonly store: RehearsalStore;
  readonly material: RehearsalMaterial;
  readonly composer: RehearsalComposer;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}): RehearsalService {
  const { store, material, composer, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const frames = new Map<string, Frame>();
  /** One persona build per viewer and subject at a time. */
  const building = new Map<string, Promise<PersonaRow | null>>();

  function ok(
    row: RehearsalRow | null,
    previousScore: number | null = null,
  ): RehearsalResult {
    if (row === null) return { kind: "NOT_FOUND" };
    const rehearsal = toDto(row, previousScore, now());
    return rehearsal === null
      ? { kind: "NOT_FOUND" }
      : { kind: "OK", rehearsal };
  }

  /** The row, with their previous finished score with the same person. */
  async function okWithHistory(
    actor: ActorContext,
    row: RehearsalRow | null,
  ): Promise<RehearsalResult> {
    if (row === null) return { kind: "NOT_FOUND" };
    const earlier = await store
      .list(actor, { kind: row.counterpartKind, id: row.counterpartId })
      .catch(() => []);
    const previous = earlier.find(
      (other) =>
        other.id !== row.id &&
        other.score !== null &&
        other.createdAt.getTime() < row.createdAt.getTime(),
    );
    return ok(row, previous?.score ?? null);
  }

  /**
   * The persona of one counterpart for this viewer: reused while what feeds
   * it is unchanged, refreshed from the previous reading when it changed,
   * and the public web read again at most weekly.
   */
  async function ensurePersona(
    actor: ActorContext,
    viewer: { readonly role: ViewerRole; readonly organisationName: string },
    kind: RehearsalCounterpartKind,
    id: string,
  ): Promise<BuiltPersona | "NOT_FOUND" | "Q_UNAVAILABLE"> {
    const counterpart = await material
      .counterpart(actor, kind, id)
      .catch(() => null);
    if (counterpart === null) return "NOT_FOUND";
    const relationshipId = counterpart.relationshipId;
    const [messages, calls, theirs] = await Promise.all([
      relationshipId === null
        ? ""
        : material.theirMessages(actor, relationshipId).catch(() => ""),
      relationshipId === null
        ? ""
        : material.theirCalls(actor, relationshipId).catch(() => ""),
      material.counterpartMaterial(actor, kind, id).catch(() => NO_MATERIAL),
    ]);
    const digest = digestOf([
      counterpart.profile,
      messages,
      calls,
      theirs.text,
      viewer.organisationName,
    ]);
    const existing = await store.findPersona(actor, kind, id);
    const held =
      existing === null
        ? null
        : CounterpartPersonaResultSchema.safeParse(existing.profile);
    const heldProfile = held?.success === true ? held.data : null;
    const webDue =
      existing?.webReadAt == null ||
      now().getTime() - existing.webReadAt.getTime() > WEB_READ_EVERY_MS;
    const built = (row: PersonaRow, profile: CounterpartPersonaResult) => ({
      row,
      profile,
      name: counterpart.name,
      relationshipId,
    });
    if (
      existing !== null &&
      heldProfile !== null &&
      existing.signalDigest === digest &&
      !webDue
    ) {
      return built(existing, heldProfile);
    }
    const key = `${actor.tenantId}:${actor.userId}:${kind}:${id}`;
    let pending = building.get(key);
    if (pending === undefined) {
      pending = (async () => {
        const keptWeb = storedSources(existing?.sources ?? []).filter(
          (source) => source.kind === "PUBLIC_WEB",
        );
        const web: Sourced = webDue
          ? await material
              .publicWeb(actor, counterpart.name, kind)
              .catch(() => NO_MATERIAL)
          : {
              text: keptWeb
                .map((source) => `${source.label}: ${source.excerpt ?? ""}`)
                .join("\n"),
              sources: keptWeb,
            };
        const profile = await composer.persona(actor, {
          viewerRole: viewer.role,
          viewerOrganisation: viewer.organisationName.slice(0, 200),
          counterpartRole: counterpartRoleOf(kind),
          counterpartProfile: counterpart.profile.slice(0, 6_000),
          theirMessages: (messages || "(none)").slice(-12_000),
          theirWordsInCalls: (calls || "(none)").slice(-20_000),
          publicPresence: (web.text || "(none)").slice(0, 6_000),
          pitchMaterial: (theirs.text || "(none)").slice(0, 16_000),
          previousProfile:
            heldProfile === null
              ? "(none)"
              : personaText(heldProfile).slice(0, 8_000),
        });
        if (profile === null) return null;
        const sources: PersonaSource[] = [
          {
            kind: "PROFILE",
            label: `${counterpart.name}'s profile`,
            url: null,
          },
          ...(messages.length > 0
            ? [
                {
                  kind: "MESSAGES" as const,
                  label: "Their messages to you",
                  url: null,
                },
              ]
            : []),
          ...(calls.length > 0
            ? [
                {
                  kind: "CALLS" as const,
                  label: "Calls you were on together",
                  url: null,
                },
              ]
            : []),
          ...theirs.sources,
          ...web.sources,
        ];
        return store.savePersona(actor, {
          kind,
          id,
          name: counterpart.name,
          relationshipId,
          profile,
          sources: sources.slice(0, 24),
          signalDigest: digest,
          webReadAt: webDue ? now() : (existing?.webReadAt ?? null),
        });
      })().finally(() => building.delete(key));
      building.set(key, pending);
    }
    const saved = await pending.catch((error: unknown) => {
      logger?.warn({ err: error }, "persona build failed");
      return null;
    });
    if (saved === null) {
      // A refresh that failed keeps the reading already held.
      return existing !== null && heldProfile !== null
        ? built(existing, heldProfile)
        : "Q_UNAVAILABLE";
    }
    const parsed = CounterpartPersonaResultSchema.safeParse(saved.profile);
    return parsed.success ? built(saved, parsed.data) : "Q_UNAVAILABLE";
  }

  /** What the person Q plays asks about, or answers from. */
  async function meetingMaterial(
    actor: ActorContext,
    row: RehearsalRow,
  ): Promise<string> {
    // Played investor: the founder's own pitch, deck and record, which the
    // founder may see. Played founder: their material as this investor may
    // see it (pitch under the playback rule, public knowledge).
    const found =
      row.userRole === "FOUNDER"
        ? await material.ownMaterial(actor).catch(() => NO_MATERIAL)
        : await material
            .counterpartMaterial(actor, row.counterpartKind, row.counterpartId)
            .catch(() => NO_MATERIAL);
    return found.text || "(none)";
  }

  async function reply(
    actor: ActorContext,
    row: RehearsalRow,
    turns: readonly Turn[],
    cue: RehearsalTurnVariables["cue"],
    viewerOrganisation: string,
    signal: AbortSignal | undefined,
  ): Promise<{
    readonly result: RehearsalTurnResult;
    readonly sawScreen: boolean;
  } | null> {
    const persona = personaOf(row.persona);
    if (persona === null) return null;
    const frame = frames.get(row.id);
    const fresh =
      frame !== undefined && now().getTime() - frame.at <= FRAME_TTL_MS
        ? frame
        : null;
    if (fresh !== null) frames.delete(row.id);
    const minutes = Math.floor(
      (now().getTime() - row.createdAt.getTime()) / 60_000,
    );
    const wrapUp =
      cue === "NONE" &&
      (minutes >= WRAP_UP_MINUTES || turns.length >= WRAP_UP_TURNS);
    const result = await composer.turn(
      actor,
      {
        viewerRole: row.userRole,
        viewerOrganisation: viewerOrganisation.slice(0, 200),
        counterpartName: row.counterpartName,
        counterpartRole: counterpartRoleOf(row.counterpartKind),
        persona: personaText(persona).slice(0, 10_000),
        meetingMaterial: (await meetingMaterial(actor, row)).slice(0, 16_000),
        rehearsal: transcriptOf(turns, row.counterpartName, row.userRole),
        turnsSoFar: Math.min(turns.length, 400),
        minutesElapsed: Math.max(0, Math.min(minutes, 600)),
        cue: wrapUp ? "WRAP_UP" : cue,
        difficulty: row.difficulty,
        screenShared: fresh !== null,
      },
      fresh?.image ?? null,
      signal,
    );
    return result === null ? null : { result, sawScreen: fresh !== null };
  }

  const viewerOf = (actor: ActorContext) =>
    material.viewer(actor).catch(() => null);

  return {
    partners: async (actor) => {
      const viewer = await viewerOf(actor);
      if (viewer === null) return { role: null, upcoming: [], people: [] };
      const [relationships, meetings, history] = await Promise.all([
        material.relationships(actor).catch(() => []),
        material.upcomingMeetings(actor).catch(() => []),
        store.list(actor).catch(() => []),
      ]);
      const byRelationship = new Map(
        relationships.map((item) => [item.relationshipId, item]),
      );
      const last = new Map<string, RehearsalRow>();
      for (const row of history) {
        const key = `${row.counterpartKind}:${row.counterpartId}`;
        if (!last.has(key)) last.set(key, row);
      }
      return {
        role: viewer.role,
        upcoming: meetings
          .flatMap((meeting) => {
            const who = byRelationship.get(meeting.relationshipId);
            return who === undefined
              ? []
              : [
                  {
                    meetingId: meeting.meetingId,
                    startsAt: meeting.startsAt,
                    purpose: meeting.purpose.slice(0, 300),
                    counterpart: { kind: who.kind, id: who.id, name: who.name },
                  },
                ];
          })
          .slice(0, 20),
        people: relationships.slice(0, 200).map((item) => {
          const row = last.get(`${item.kind}:${item.id}`);
          return {
            counterpart: { kind: item.kind, id: item.id, name: item.name },
            relationshipId: item.relationshipId,
            state: item.state.slice(0, 40),
            lastRehearsal:
              row === undefined
                ? null
                : {
                    id: row.id,
                    at: row.createdAt.toISOString(),
                    score: row.score,
                    outcome: row.outcome,
                  },
          };
        }),
      };
    },

    persona: async (actor, kind, id) => {
      const viewer = await viewerOf(actor);
      if (viewer === null) return { kind: "NOT_A_PARTICIPANT" };
      // A founder rehearses with investors, an investor with companies.
      if (counterpartRoleOf(kind) === viewer.role) return { kind: "NOT_FOUND" };
      const built = await ensurePersona(actor, viewer, kind, id);
      if (built === "NOT_FOUND") return { kind: "NOT_FOUND" };
      if (built === "Q_UNAVAILABLE") return { kind: "Q_UNAVAILABLE" };
      return {
        kind: "OK",
        persona: {
          counterpart: { kind, id, name: built.name },
          ...shownPersona(built.profile),
          grounding: built.profile.grounding,
          sources: publicSources(built.row.sources),
          refreshedAt: built.row.refreshedAt.toISOString(),
        },
      };
    },

    meeting: async (actor, meetingId) => {
      const [meetings, relationships] = await Promise.all([
        material.upcomingMeetings(actor).catch(() => []),
        material.relationships(actor).catch(() => []),
      ]);
      const meeting = meetings.find((item) => item.meetingId === meetingId);
      if (meeting === undefined) return null;
      const who = relationships.find(
        (item) => item.relationshipId === meeting.relationshipId,
      );
      return who === undefined
        ? null
        : { kind: who.kind, id: who.id, name: who.name };
    },

    start: async (actor, input) => {
      const viewer = await viewerOf(actor);
      if (viewer === null) return { kind: "NOT_A_PARTICIPANT" };
      if (counterpartRoleOf(input.kind) === viewer.role) {
        return { kind: "NOT_FOUND" };
      }
      // A meeting id is input: kept only when it is one of their own.
      let meetingId: string | null = null;
      if (input.meetingId !== undefined) {
        const meetings = await material.upcomingMeetings(actor).catch(() => []);
        meetingId =
          meetings.find((item) => item.meetingId === input.meetingId)
            ?.meetingId ?? null;
      }
      const built = await ensurePersona(actor, viewer, input.kind, input.id);
      if (built === "NOT_FOUND") return { kind: "NOT_FOUND" };
      if (built === "Q_UNAVAILABLE") return { kind: "Q_UNAVAILABLE" };
      const id = randomUUID();
      const voice = input.voice ?? "MALE";
      const draft: RehearsalRow = {
        id,
        counterpartKind: input.kind,
        counterpartId: input.id,
        counterpartName: built.name,
        userRole: viewer.role,
        persona: built.profile,
        turns: [],
        asked: 0,
        status: "ACTIVE",
        outcome: null,
        score: null,
        scorecard: null,
        meetingId,
        voice,
        difficulty: input.difficulty ?? "REALISTIC",
        createdAt: now(),
        endedAt: null,
      };
      const opening = await reply(
        actor,
        draft,
        [],
        "OPENING",
        viewer.organisationName,
        undefined,
      );
      if (opening === null) return { kind: "Q_UNAVAILABLE" };
      const row = await store.insert(actor, {
        id,
        kind: input.kind,
        counterpartId: input.id,
        name: built.name,
        role: viewer.role,
        relationshipId: built.relationshipId,
        meetingId,
        personaProfileId: built.row.id,
        persona: built.profile,
        voice,
        difficulty: input.difficulty ?? "REALISTIC",
        turns: [
          {
            from: "THEM",
            text: opening.result.line,
            at: now().toISOString(),
            mood: opening.result.mood,
            sawScreen: false,
            intensity: opening.result.intensity,
            reaction: opening.result.reaction,
          },
        ],
      });
      return ok(row);
    },

    get: async (actor, rehearsalId) =>
      okWithHistory(actor, await store.own(actor, rehearsalId)),

    list: async (actor, filter) => {
      const rows = await store.list(actor, filter);
      return {
        rehearsals: rows.map((row) => ({
          id: row.id,
          counterpart: {
            kind: row.counterpartKind,
            id: row.counterpartId,
            name: row.counterpartName,
          },
          status: row.status,
          outcome: row.outcome,
          score: row.score,
          exchanges: normaliseTurns(row.turns, row.userRole).filter(
            (turn) => turn.from === "YOU",
          ).length,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },

    say: async (actor, rehearsalId, said, signal) => {
      const row = await store.own(actor, rehearsalId);
      if (row === null) return { kind: "NOT_FOUND" };
      if (row.status !== "ACTIVE" || row.endedAt !== null) {
        return { kind: "FINISHED" };
      }
      // The browser's raised-hand cue is a fixed token, never their words.
      const words =
        "text" in said
          ? said.text
              .split(REHEARSAL_HAND_RAISED_SIGNAL)
              .join(" ")
              .split(REHEARSAL_SILENCE_SIGNAL)
              .join(" ")
              .trim()
          : "";
      // Likewise the silence cue: the browser noticed they said nothing.
      const silent =
        ("cue" in said && said.cue === "SILENCE") ||
        ("text" in said && said.text.includes(REHEARSAL_SILENCE_SIGNAL));
      const handRaised =
        !silent &&
        (("cue" in said && said.cue === "HAND_RAISED") ||
          ("text" in said && said.text.includes(REHEARSAL_HAND_RAISED_SIGNAL)));
      if (words.length === 0 && !handRaised && !silent) return ok(row);
      const viewer = await viewerOf(actor);
      if (viewer === null) return { kind: "NOT_A_PARTICIPANT" };
      const previous = normaliseTurns(row.turns, row.userRole);
      const turns: Turn[] =
        words.length === 0
          ? previous
          : [
              ...previous,
              {
                from: "YOU",
                text: words.slice(0, 4_000),
                at: now().toISOString(),
                mood: null,
                sawScreen: false,
              },
            ];
      const answered = await reply(
        actor,
        row,
        turns,
        words.length > 0 ? "NONE" : silent ? "SILENCE" : "HAND_RAISED",
        viewer.organisationName,
        signal,
      );
      // Spoken over: the person carried on, and their grown words come as
      // the next turn. Nothing of this one is kept.
      if (signal?.aborted === true) return ok(row);
      if (answered === null) return { kind: "Q_UNAVAILABLE" };
      const { result } = answered;
      const closing = result.move === "CLOSE";
      const next: Turn[] = [
        ...turns,
        {
          from: "THEM",
          text: result.line,
          at: now().toISOString(),
          mood: result.mood,
          sawScreen: answered.sawScreen,
          intensity: result.intensity,
          reaction: result.reaction,
        },
      ];
      const saved = await store.saveTurns(actor, row.id, {
        turns: next.slice(-MAX_TURNS),
        asked: Math.min(
          80,
          row.asked +
            (result.move === "QUESTION" || result.move === "FOLLOW_UP" ? 1 : 0),
        ),
        outcome: closing ? (result.conclusion ?? "INDECISIVE") : null,
        ended: closing,
      });
      return saved === null ? { kind: "FINISHED" } : ok(saved);
    },

    screen: async (actor, rehearsalId, image) => {
      const row = await store.own(actor, rehearsalId);
      if (row === null) return "NOT_FOUND";
      if (row.status !== "ACTIVE" || row.endedAt !== null) return "FINISHED";
      const current = now().getTime();
      for (const [key, frame] of frames) {
        if (current - frame.at > FRAME_TTL_MS) frames.delete(key);
      }
      frames.set(row.id, { image, at: current });
      return "OK";
    },

    finish: async (actor, rehearsalId) => {
      const row = await store.own(actor, rehearsalId);
      if (row === null) return { kind: "NOT_FOUND" };
      if (row.status === "FINISHED") return ok(row);
      frames.delete(row.id);
      const turns = normaliseTurns(row.turns, row.userRole);
      if (!turns.some((turn) => turn.from === "YOU")) {
        // Nothing to review: they left before saying anything.
        const left = await store.finish(actor, row.id, {
          outcome: "LEFT_EARLY",
          score: null,
          review: null,
        });
        return ok(left ?? (await store.own(actor, row.id)));
      }
      const viewer = await viewerOf(actor);
      if (viewer === null) return { kind: "NOT_A_PARTICIPANT" };
      const persona = personaOf(row.persona);
      if (persona === null) return { kind: "NOT_FOUND" };
      const outcome: RehearsalConclusion = row.outcome ?? "LEFT_EARLY";
      const review = await composer.review(actor, {
        viewerRole: row.userRole,
        viewerOrganisation: viewer.organisationName.slice(0, 200),
        counterpartName: row.counterpartName,
        persona: personaText(persona).slice(0, 10_000),
        rehearsal: transcriptOf(turns, row.counterpartName, row.userRole),
        ending: outcome,
      });
      if (review === null) return { kind: "Q_UNAVAILABLE" };
      const saved = await store.finish(actor, row.id, {
        outcome,
        score: scoreOf(review.dimensions),
        review,
      });
      return okWithHistory(actor, saved ?? (await store.own(actor, row.id)));
    },

    opening: async (actor, rehearsalId) => {
      const row = await store.own(actor, rehearsalId);
      if (row === null || row.status !== "ACTIVE" || row.endedAt !== null) {
        return null;
      }
      const last = normaliseTurns(row.turns, row.userRole)
        .filter((turn) => turn.from === "THEM")
        .at(-1);
      return last === undefined
        ? null
        : {
            line: last.text,
            name: row.counterpartName,
            seed: `${row.counterpartKind}:${row.counterpartId}`,
            voice: row.voice ?? "MALE",
            mood: last.mood,
            intensity: last.intensity ?? "NORMAL",
            reaction: last.reaction ?? null,
          };
    },
  };
}

// ---------------------------------------------------------------------------
// Composer: the three prompts, through the Q Model Gateway only
// ---------------------------------------------------------------------------

type Budget = {
  readonly maxAttempts: number;
  readonly maxEstimatedCostUsd: number;
  readonly maxOutputTokens: number;
  readonly attemptTimeoutMs: number;
};
const PERSONA_BUDGET: Budget = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.06,
  maxOutputTokens: 2_000,
  attemptTimeoutMs: 40_000,
};
/** A spoken turn: small and fast, inside the think route's deadline. */
const TURN_BUDGET: Budget = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.03,
  maxOutputTokens: 400,
  attemptTimeoutMs: 8_000,
};
const REVIEW_BUDGET: Budget = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.06,
  maxOutputTokens: 2_200,
  attemptTimeoutMs: 40_000,
};

export function createRehearsalComposer(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): RehearsalComposer {
  const registry = createDefaultPromptRegistry();

  async function run<V extends Record<string, unknown>, R>(
    actor: ActorContext,
    task: "INVESTOR_PERSONA" | "INVESTOR_TWIN_TURN" | "REHEARSAL_SCORE",
    taskClass: "STRUCTURED_EXTRACTION" | "NORMAL_DIALOGUE",
    budget: Budget,
    variables: V,
    schema: z.ZodType<R>,
    image: RehearsalImage | null = null,
    signal?: AbortSignal,
  ): Promise<R | null> {
    const rendered = renderPrompt<V>(registry, {
      task,
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "A private rehearsal on Capital Q. Practice only: nothing here is evidence or is shown to the other person.",
      variables,
    });
    const messages = [...rendered.messages];
    if (image !== null) {
      // The shared frame rides with the turn, as a USER image.
      messages.push({
        role: "USER",
        content: "Their shared screen, as it is now.",
        images: [image],
      });
    }
    try {
      const response = await dependencies.gateway.execute<R>(
        {
          taskClass,
          sensitivity: "CONFIDENTIAL",
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          budget,
          messages,
          output: rendered.output,
          ...(image === null ? {} : { requiredCapabilities: ["VISION"] }),
          attribution: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            correlationId: `cor_${randomUUID()}`,
          },
        },
        { schema, ...(signal === undefined ? {} : { signal }) },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = schema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      return parsed.success ? parsed.data : null;
    } catch (error: unknown) {
      if (signal?.aborted !== true) {
        dependencies.logger?.warn(
          { err: error, task },
          "rehearsal step failed",
        );
      }
      return null;
    }
  }

  return {
    // Lenient shapes from the model, trimmed here to what is stored.
    persona: async (actor, variables) => {
      const loose = await run(
        actor,
        "INVESTOR_PERSONA",
        "STRUCTURED_EXTRACTION",
        PERSONA_BUDGET,
        variables,
        CounterpartPersonaLenientSchema,
      );
      return loose === null ? null : normaliseCounterpartPersona(loose);
    },
    turn: async (actor, variables, image, signal) => {
      const result = await run(
        actor,
        "INVESTOR_TWIN_TURN",
        "NORMAL_DIALOGUE",
        TURN_BUDGET,
        variables,
        RehearsalTurnV3ResultSchema,
        image,
        signal,
      );
      return result === null
        ? null
        : { ...result, line: result.line.slice(0, 700) };
    },
    review: async (actor, variables) => {
      const loose = await run(
        actor,
        "REHEARSAL_SCORE",
        "STRUCTURED_EXTRACTION",
        REVIEW_BUDGET,
        variables,
        RehearsalReviewLenientSchema,
      );
      return loose === null ? null : normaliseRehearsalReview(loose);
    },
  };
}
