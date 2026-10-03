import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * Work handed to Q in general (QA 2026-10-03, runs 18eb8420, 5c6dcabe):
 * "handle my investors", "just handle it", "take care of all of it". Its
 * meaning is a standing instruction -- Q works toward the goal over time
 * inside one grant they approve -- so code prepares that card
 * (propose_standing_instruction) and says what is true first: a founder
 * with no investors yet is told so, with the real path (be findable, add a
 * deck) from their own readiness. Never a "could not" line,
 * never an invented target.
 */

export type DelegationContext = {
  /** Their side, from their own relationships; NONE when on neither. */
  readonly side: "INVESTOR" | "COMPANY" | "NONE";
  readonly relationships: number;
  /** Readiness requirements still open (ids), when they have a company. */
  readonly outstanding: readonly string[];
};

export type QDelegationPort = {
  readonly context: (request: QAnswerRequest) => Promise<DelegationContext>;
  readonly propose: (
    request: QAnswerRequest,
    input: {
      readonly goal: string;
      readonly includeNewCompanies: boolean;
      /**
       * What else they said about the grant (ask first, tone, topics,
       * digest, how long), read against the tool's own schema; the
       * tool validates it.
       */
      readonly more?: Readonly<Record<string, unknown>> | undefined;
    },
  ) => Promise<{
    readonly status: string;
    readonly awaitingApprovalOf: string;
  } | null>;
};

/** The router's candidate for it: offered beside the declared actions. */
export const DELEGATION_TOOL = "propose_standing_instruction";
export const DELEGATION_CANDIDATE = {
  name: DELEGATION_TOOL,
  area: "Delegation",
  does: "Hand Q ongoing work in general, with no single action or person named (handle my investors, just handle it, take care of all of it): Q works toward the goal over time inside one grant they approve.",
} as const;

export function delegationLine(
  context: DelegationContext,
  prepared: { readonly status: string; readonly awaitingApprovalOf: string },
  /** They also asked for terms or money, which Q never takes on. */
  askedTerms = false,
): string {
  const truth: string[] = [];
  if (context.side !== "INVESTOR" && context.relationships === 0) {
    truth.push(
      context.side === "COMPANY"
        ? "You don't have any investors on Capital Q yet, so there's no one for me to handle today."
        : "You don't have anyone on Capital Q to work with yet.",
    );
    const path: string[] = [];
    if (context.outstanding.includes("DISCOVERY_VISIBILITY_CONFIRMED")) {
      path.push("make your company findable to investors");
    }
    if (context.outstanding.includes("REQUIRED_DOCUMENTATION")) {
      path.push("upload your deck");
    }
    if (path.length > 0) {
      truth.push(
        `The real path is to ${path.join(" and ")}, and I can help with both.`,
      );
    }
  } else if (context.side === "INVESTOR" && context.relationships === 0) {
    truth.push(
      "You aren't in touch with any founders yet, so I'd start from your feed.",
    );
  }
  // Whatever they asked for, terms stay theirs, said plainly up front when
  // the card is there (lead 2026-10-03, run 8705e6e8: "negotiate the
  // valuation and terms for me" got a refusal and no card).
  const terms =
    prepared.status === "PREPARED" && askedTerms
      ? "I won't negotiate valuation, terms or money for you; those stay with you, and I'll handle the rest."
      : null;
  // The engine's own line says the card is ready and waiting (QA
  // 2026-10-03, runs f8bc8e8d, c2fa5052: "I've prepared..." and "That's
  // ready..." in one reply); this line says only what the card means.
  const card =
    prepared.status === "PREPARED"
      ? context.side === "COMPANY"
        ? "Meanwhile, as a standing instruction I'd find investors who match and engage them for you, asking you first before anything goes out. The card shows what I'd do on my own, what I'd ask first and what never happens without you."
        : "As a standing instruction, the card shows exactly what I'd do on my own, what I'd ask first and what never happens without you."
      : prepared.status === "ONE_PER_TURN"
        ? "Another change is already waiting for your approval in this answer; approve or decline it first, then I'll set this up."
        : "What would you like me to take on: your conversations with investors, new founders in your feed, or something else?";
  return [...truth, ...(terms === null ? [] : [terms]), card].join(" ");
}

export async function actOnDelegation(
  port: QDelegationPort,
  request: QAnswerRequest,
  utterance: string,
  /** Their words read against the tool's schema, when a reader is composed. */
  readArguments?: () => Promise<Readonly<Record<string, unknown>> | null>,
): Promise<string> {
  const context = await port.context(request).catch((): DelegationContext => ({
    side: "NONE",
    relationships: 0,
    outstanding: [],
  }));
  const more = (await readArguments?.().catch(() => null)) ?? null;
  const prepared = await port
    .propose(request, {
      goal: utterance.trim().slice(0, 2_000) || "Handle everything for me",
      // Investors with no one yet: Q starts from their feed and saves; and
      // whenever their words reach companies they don't know yet.
      includeNewCompanies:
        (context.side === "INVESTOR" && context.relationships === 0) ||
        more?.["includeNewCompanies"] === true,
      ...(more === null ? {} : { more }),
    })
    .catch(() => null);
  return delegationLine(
    context,
    prepared ?? { status: "NOT_PREPARED", awaitingApprovalOf: "" },
    more?.["askedTermsOrMoney"] === true,
  );
}

/** The port through the run's own tools, under its plan. */
export function createToolDelegationPort(dependencies: {
  readonly tools: QToolPort;
  readonly logger?: Logger | undefined;
}): QDelegationPort {
  const { tools, logger } = dependencies;
  const call = async (
    request: QAnswerRequest,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    try {
      const outcome = await tools.execute(
        { callId: `q-delegation-${name}`, name, arguments: args },
        {
          actor: request.actor,
          runId: request.runId,
          correlationId: request.correlationId,
          capability: request.capability,
          plan: request.plan,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      return outcome.result.ok ? outcome.result.data : null;
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      logger?.warn(
        { err: error, qRunId: request.runId, tool: name },
        "a delegation step was not taken",
      );
      return null;
    }
  };
  return {
    context: async (request) => {
      const [mine, readiness] = await Promise.all([
        call(request, "list_my_relationships", {}),
        call(request, "read_my_record", { record: "MARKETPLACE_READINESS" }),
      ]);
      const own = (mine ?? {}) as {
        yourSide?: unknown;
        relationships?: unknown;
      };
      const side =
        own.yourSide === "INVESTOR" || own.yourSide === "COMPANY"
          ? own.yourSide
          : "NONE";
      const relationships = Array.isArray(own.relationships)
        ? own.relationships.length
        : 0;
      const assessment = (readiness ?? {}) as {
        data?: { requirements?: unknown };
      };
      const outstanding = Array.isArray(assessment.data?.requirements)
        ? (
            assessment.data.requirements as {
              requirement?: unknown;
              outcome?: unknown;
            }[]
          )
            .filter((entry) => entry.outcome === "OUTSTANDING")
            .map((entry) => String(entry.requirement))
        : [];
      return {
        // A founder's company read means they are a founder even with no
        // relationships yet.
        side: side === "NONE" && readiness !== null ? "COMPANY" : side,
        relationships,
        outstanding,
      };
    },
    propose: async (request, input) => {
      const more = input.more ?? {};
      // Only the grant's own knobs are taken from the reading; the goal is
      // their words, and an unreadable extra is dropped, not guessed.
      const known = [
        "askFirst",
        "tone",
        "topics",
        "relationshipIds",
        "expiresInDays",
        "digest",
        "askedTermsOrMoney",
      ] as const;
      const extra = Object.fromEntries(
        known.filter((key) => key in more).map((key) => [key, more[key]]),
      );
      const data =
        (await call(request, DELEGATION_TOOL, {
          ...extra,
          goal: input.goal,
          includeNewCompanies: input.includeNewCompanies,
        })) ??
        // The extras did not validate: the plain card, their goal only.
        (Object.keys(extra).length === 0
          ? null
          : await call(request, DELEGATION_TOOL, {
              goal: input.goal,
              includeNewCompanies: input.includeNewCompanies,
            }));
      if (data === null || typeof data !== "object") return null;
      const record = data as Record<string, unknown>;
      return typeof record["status"] === "string" &&
        typeof record["awaitingApprovalOf"] === "string"
        ? {
            status: record["status"],
            awaitingApprovalOf: record["awaitingApprovalOf"],
          }
        : null;
    },
  };
}
