import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ModelDataPosture,
  QRehearsalDto,
  QRehearsalListDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  InvestorPersonaResultSchema,
  InvestorTwinTurnResultSchema,
  RehearsalScoreResultSchema,
  renderPrompt,
  type InvestorPersonaResult,
  type InvestorPersonaVariables,
  type InvestorTwinTurnResult,
  type InvestorTwinTurnVariables,
  type RehearsalScoreResult,
  type RehearsalScoreVariables,
} from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

/**
 * The Investor Twin (founder direction 2026-09-30, C12). A founder
 * rehearses a meeting with an investor, played by Q, then Q coaches them.
 *
 * Firewall: the persona is built only from what this founder may already
 * see of the investor (the material port below answers for the founder's
 * own side): their network-visible profile, what they wrote to this
 * founder, and what was said in calls this founder was on. Never the
 * investor's mandate, never their conversations with Q. The rehearsal is
 * the founder's own practice: it is not evidence, it writes no claim or
 * memory, and the investor never sees it.
 */

/** What the founder may see of one investor, from their own side. */
export type RehearsalMaterial = {
  /** The founder's own company name; null when they are not a founder. */
  readonly companyName: (actor: ActorContext) => Promise<string | null>;
  /**
   * The investor as this founder may see them; null when they may not
   * (not network-visible and no relationship with the founder's company).
   */
  readonly investor: (
    actor: ActorContext,
    investorOrganisationId: string,
  ) => Promise<{
    readonly name: string;
    readonly profile: string;
    readonly relationshipId: string | null;
  } | null>;
  /** What the investor's side wrote to this founder, oldest first. */
  readonly theirMessages: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<string>;
  /** What was said in calls this founder was on with them. */
  readonly theirCalls: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<string>;
};

/** The task frame renderPrompt supplies; callers give only their own. */
type FrameKeys =
  | "operatingMode"
  | "communicationProfile"
  | "communicationGuidance"
  | "environmentNotes";

export type RehearsalComposer = {
  readonly persona: (
    actor: ActorContext,
    variables: Omit<InvestorPersonaVariables, FrameKeys>,
  ) => Promise<InvestorPersonaResult | null>;
  readonly turn: (
    actor: ActorContext,
    variables: Omit<InvestorTwinTurnVariables, FrameKeys>,
  ) => Promise<InvestorTwinTurnResult | null>;
  readonly score: (
    actor: ActorContext,
    variables: Omit<RehearsalScoreVariables, FrameKeys>,
  ) => Promise<RehearsalScoreResult | null>;
};

const TurnSchema = z
  .object({
    from: z.enum(["INVESTOR", "FOUNDER"]),
    text: z.string().max(4_000),
    at: z.string(),
  })
  .strict();
type Turn = z.infer<typeof TurnSchema>;

type RehearsalRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  investor_organisation_id: string;
  investor_name: string;
  persona: unknown;
  turns: unknown;
  asked: number;
  length: number;
  status: "ACTIVE" | "FINISHED";
  scorecard: unknown;
  created_at: Date;
};

export type RehearsalOutcome =
  | { readonly kind: "OK"; readonly rehearsal: QRehearsalDto }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_A_FOUNDER" }
  | { readonly kind: "FINISHED" }
  | { readonly kind: "Q_UNAVAILABLE" };

export type RehearsalService = {
  readonly start: (
    actor: ActorContext,
    investorOrganisationId: string,
    length?: number,
  ) => Promise<RehearsalOutcome>;
  readonly get: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<RehearsalOutcome>;
  readonly list: (
    actor: ActorContext,
    investorOrganisationId: string,
  ) => Promise<QRehearsalListDto>;
  readonly say: (
    actor: ActorContext,
    rehearsalId: string,
    text: string,
  ) => Promise<RehearsalOutcome>;
  readonly finish: (
    actor: ActorContext,
    rehearsalId: string,
  ) => Promise<RehearsalOutcome>;
};

const DEFAULT_LENGTH = 8;
/** The whole rehearsal handed to the model, newest kept when long. */
const REHEARSAL_TEXT_MAX = 24_000;

function transcriptOf(turns: readonly Turn[], investorName: string): string {
  if (turns.length === 0) return "(nothing said yet)";
  const text = turns
    .map(
      (turn) =>
        `${turn.from === "INVESTOR" ? investorName : "Founder"}: ${turn.text}`,
    )
    .join("\n");
  return text.length <= REHEARSAL_TEXT_MAX
    ? text
    : text.slice(text.length - REHEARSAL_TEXT_MAX);
}

function personaText(persona: InvestorPersonaResult): string {
  return [
    `Who they are: ${persona.summary}`,
    `How they speak: ${persona.style}`,
    `Priorities: ${persona.priorities.join("; ") || "not known"}`,
    "Likely questions:",
    ...persona.likelyQuestions.map((q) => `- ${q.question} (${q.why})`),
    `How they push back: ${persona.pushbacks.join("; ") || "not known"}`,
    `What wins them over: ${persona.howToWin.join("; ") || "not known"}`,
    `Grounding: ${persona.grounding}`,
  ].join("\n");
}

function toDto(row: RehearsalRow): QRehearsalDto | null {
  const persona = InvestorPersonaResultSchema.safeParse(row.persona);
  const turns = z.array(TurnSchema).safeParse(row.turns);
  if (!persona.success || !turns.success) return null;
  const scorecard =
    row.scorecard === null
      ? null
      : RehearsalScoreResultSchema.safeParse(row.scorecard);
  return {
    id: row.id,
    investorOrganisationId: row.investor_organisation_id,
    investorName: row.investor_name,
    status: row.status,
    persona: {
      summary: persona.data.summary,
      style: persona.data.style,
      priorities: persona.data.priorities,
      grounding: persona.data.grounding,
    },
    turns: turns.data.map((turn) => ({
      from: turn.from,
      text: turn.text,
      at: new Date(turn.at).toISOString(),
    })),
    asked: row.asked,
    length: row.length,
    scorecard: scorecard?.success === true ? scorecard.data : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function createRehearsalService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly material: RehearsalMaterial;
  readonly composer: RehearsalComposer;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}): RehearsalService {
  const { sql, material, composer } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /** Only the founder's own rehearsal, in their own tenant. */
  async function own(
    actor: ActorContext,
    rehearsalId: string,
  ): Promise<RehearsalRow | null> {
    if (!z.string().uuid().safeParse(rehearsalId).success) return null;
    const rows = await sql<RehearsalRow[]>`
      select id, tenant_id, user_id, investor_organisation_id, investor_name,
             persona, turns, asked, length, status, scorecard, created_at
        from q_runtime.rehearsals
       where id = ${rehearsalId} and user_id = ${actor.userId}
         and tenant_id = ${actor.tenantId}
       limit 1`;
    return rows[0] ?? null;
  }

  function ok(row: RehearsalRow): RehearsalOutcome {
    const rehearsal = toDto(row);
    return rehearsal === null
      ? { kind: "NOT_FOUND" }
      : { kind: "OK", rehearsal };
  }

  async function nextLine(
    actor: ActorContext,
    row: RehearsalRow,
    companyName: string,
    turns: readonly Turn[],
  ): Promise<InvestorTwinTurnResult | null> {
    const persona = InvestorPersonaResultSchema.parse(row.persona);
    return composer.turn(actor, {
      companyName,
      investorName: row.investor_name,
      persona: personaText(persona),
      rehearsal: transcriptOf(turns, row.investor_name),
      asked: Math.min(row.asked, 40),
      length: row.length,
    });
  }

  return {
    start: async (actor, investorOrganisationId, length) => {
      const companyName = await material.companyName(actor);
      if (companyName === null) return { kind: "NOT_A_FOUNDER" };
      const investor = await material
        .investor(actor, investorOrganisationId)
        .catch(() => null);
      if (investor === null) return { kind: "NOT_FOUND" };
      const [messages, calls] =
        investor.relationshipId === null
          ? ["", ""]
          : await Promise.all([
              material
                .theirMessages(actor, investor.relationshipId)
                .catch(() => ""),
              material
                .theirCalls(actor, investor.relationshipId)
                .catch(() => ""),
            ]);
      const persona = await composer.persona(actor, {
        companyName,
        investorProfile: investor.profile.slice(0, 4_000),
        theirMessages: (messages || "(none)").slice(-12_000),
        theirWordsInCalls: (calls || "(none)").slice(-20_000),
      });
      if (persona === null) return { kind: "Q_UNAVAILABLE" };
      const size = Math.max(3, Math.min(20, length ?? DEFAULT_LENGTH));
      const id = randomUUID();
      const draft: RehearsalRow = {
        id,
        tenant_id: actor.tenantId,
        user_id: actor.userId,
        investor_organisation_id: investorOrganisationId,
        investor_name: investor.name.slice(0, 200),
        persona,
        turns: [],
        asked: 0,
        length: size,
        status: "ACTIVE",
        scorecard: null,
        created_at: now(),
      };
      const opening = await nextLine(actor, draft, companyName, []);
      if (opening === null) return { kind: "Q_UNAVAILABLE" };
      const turns: Turn[] = [
        { from: "INVESTOR", text: opening.line, at: now().toISOString() },
      ];
      const rows = await sql<RehearsalRow[]>`
        insert into q_runtime.rehearsals
          (id, tenant_id, user_id, organisation_id, investor_organisation_id,
           investor_name, persona, turns, asked, length)
        values
          (${id}, ${actor.tenantId}, ${actor.userId},
           ${actor.organisationId ?? null}, ${investorOrganisationId},
           ${draft.investor_name}, ${sql.json(persona)},
           ${sql.json(turns)}, 1, ${size})
        returning id, tenant_id, user_id, investor_organisation_id,
                  investor_name, persona, turns, asked, length, status,
                  scorecard, created_at`;
      const row = rows[0];
      return row === undefined ? { kind: "Q_UNAVAILABLE" } : ok(row);
    },

    get: async (actor, rehearsalId) => {
      const row = await own(actor, rehearsalId);
      return row === null ? { kind: "NOT_FOUND" } : ok(row);
    },

    list: async (actor, investorOrganisationId) => {
      if (!z.string().uuid().safeParse(investorOrganisationId).success) {
        return { rehearsals: [] };
      }
      const rows = await sql<
        {
          id: string;
          status: "ACTIVE" | "FINISHED";
          asked: number;
          created_at: Date;
        }[]
      >`
        select id, status, asked, created_at
          from q_runtime.rehearsals
         where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
           and investor_organisation_id = ${investorOrganisationId}
         order by created_at desc
         limit 10`;
      return {
        rehearsals: rows.map((row) => ({
          id: row.id,
          status: row.status,
          asked: row.asked,
          createdAt: row.created_at.toISOString(),
        })),
      };
    },

    say: async (actor, rehearsalId, text) => {
      const row = await own(actor, rehearsalId);
      if (row === null) return { kind: "NOT_FOUND" };
      if (row.status !== "ACTIVE") return { kind: "FINISHED" };
      const companyName = await material.companyName(actor);
      if (companyName === null) return { kind: "NOT_A_FOUNDER" };
      const previous = z.array(TurnSchema).parse(row.turns);
      const said: Turn[] = [
        ...previous,
        {
          from: "FOUNDER",
          text: text.slice(0, 4_000),
          at: now().toISOString(),
        },
      ];
      const reply = await nextLine(actor, row, companyName, said);
      if (reply === null) return { kind: "Q_UNAVAILABLE" };
      const turns: Turn[] = [
        ...said,
        { from: "INVESTOR", text: reply.line, at: now().toISOString() },
      ];
      const asked = Math.min(
        40,
        row.asked + (reply.move === "QUESTION" ? 1 : 0),
      );
      // The founder's own row, guarded on its status so a finished
      // rehearsal is never written to again.
      const rows = await sql<RehearsalRow[]>`
        update q_runtime.rehearsals
           set turns = ${sql.json(turns.slice(-80))}, asked = ${asked},
               updated_at = clock_timestamp()
         where id = ${row.id} and user_id = ${actor.userId}
           and status = 'ACTIVE'
        returning id, tenant_id, user_id, investor_organisation_id,
                  investor_name, persona, turns, asked, length, status,
                  scorecard, created_at`;
      const updated = rows[0];
      return updated === undefined ? { kind: "FINISHED" } : ok(updated);
    },

    finish: async (actor, rehearsalId) => {
      const row = await own(actor, rehearsalId);
      if (row === null) return { kind: "NOT_FOUND" };
      if (row.status === "FINISHED") return ok(row);
      const companyName = await material.companyName(actor);
      if (companyName === null) return { kind: "NOT_A_FOUNDER" };
      const persona = InvestorPersonaResultSchema.parse(row.persona);
      const turns = z.array(TurnSchema).parse(row.turns);
      const scorecard = await composer.score(actor, {
        companyName,
        investorName: row.investor_name,
        persona: personaText(persona),
        rehearsal: transcriptOf(turns, row.investor_name),
      });
      if (scorecard === null) return { kind: "Q_UNAVAILABLE" };
      const rows = await sql<RehearsalRow[]>`
        update q_runtime.rehearsals
           set status = 'FINISHED', scorecard = ${sql.json(scorecard)},
               updated_at = clock_timestamp()
         where id = ${row.id} and user_id = ${actor.userId}
        returning id, tenant_id, user_id, investor_organisation_id,
                  investor_name, persona, turns, asked, length, status,
                  scorecard, created_at`;
      const updated = rows[0];
      return updated === undefined ? { kind: "NOT_FOUND" } : ok(updated);
    },
  };
}

const PERSONA_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 1_500,
  attemptTimeoutMs: 40_000,
} as const;
const TURN_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.02,
  maxOutputTokens: 400,
  attemptTimeoutMs: 25_000,
} as const;
const SCORE_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 1_800,
  attemptTimeoutMs: 40_000,
} as const;

/** The three rehearsal prompts, through the Q Model Gateway only. */
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
    budget: {
      readonly maxAttempts: number;
      readonly maxEstimatedCostUsd: number;
      readonly maxOutputTokens: number;
      readonly attemptTimeoutMs: number;
    },
    variables: V,
    schema: z.ZodType<R>,
  ): Promise<R | null> {
    const rendered = renderPrompt<V>(registry, {
      task,
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "A founder's private rehearsal on Capital Q. Practice only: nothing here is evidence or is shown to the investor.",
      variables,
    });
    try {
      const response = await dependencies.gateway.execute<R>(
        {
          taskClass,
          sensitivity: "CONFIDENTIAL",
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          budget,
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            correlationId: `cor_${randomUUID()}`,
          },
        },
        { schema },
      );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = schema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      return parsed.success ? parsed.data : null;
    } catch (error: unknown) {
      dependencies.logger?.warn({ err: error, task }, "rehearsal step failed");
      return null;
    }
  }

  return {
    persona: (actor, variables) =>
      run(
        actor,
        "INVESTOR_PERSONA",
        "STRUCTURED_EXTRACTION",
        PERSONA_BUDGET,
        variables,
        InvestorPersonaResultSchema,
      ),
    turn: (actor, variables) =>
      run(
        actor,
        "INVESTOR_TWIN_TURN",
        "NORMAL_DIALOGUE",
        TURN_BUDGET,
        variables,
        InvestorTwinTurnResultSchema,
      ),
    score: (actor, variables) =>
      run(
        actor,
        "REHEARSAL_SCORE",
        "STRUCTURED_EXTRACTION",
        SCORE_BUDGET,
        variables,
        RehearsalScoreResultSchema,
      ),
  };
}
