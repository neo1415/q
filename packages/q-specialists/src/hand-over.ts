import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

/**
 * A hand-over, acted on by code (founder live 2026-10-01; TURN_READER v22).
 *
 * "Get me a meeting with this person" and "handle this for me" on a
 * company's page were met with "which person?" and a menu: the answer's
 * model chose among sixty tools and kept asking. The turn reader now reads
 * the intent (MEETING / HAND_OVER, from meaning, any language); code finds
 * the subject the person is looking at and prepares Q's errand for it
 * through propose_errand, under this run's plan, for their approval. The
 * card is the usual one; nothing happens until they approve exactly it.
 *
 * Without a subject on screen or in the conversation, Q asks one short
 * question naming the likely candidates from their own relationships.
 */

export type HandOverSubject =
  | { readonly kind: "COMPANY"; readonly companyId: string }
  | {
      readonly kind: "INVESTOR_ORGANISATION";
      readonly investorOrganisationId: string;
    }
  | { readonly kind: "RELATIONSHIP"; readonly relationshipId: string };

export type HandOverOutcome =
  /** The errand is prepared; the card asks for approval. */
  | { readonly kind: "PREPARED"; readonly line: string }
  /** No subject: a short question naming the likely ones. */
  | { readonly kind: "ASK"; readonly line: string }
  /** Could not prepare (not permitted, not reachable): answer normally. */
  | { readonly kind: "NONE" };

export type QHandOverPort = {
  readonly prepare: (
    request: QAnswerRequest,
    subject: HandOverSubject,
  ) => Promise<{
    readonly status: string;
    readonly awaitingApprovalOf: string;
  } | null>;
  /** Their own relationships, most recent first: who they might mean. */
  readonly candidates: (request: QAnswerRequest) => Promise<
    readonly {
      readonly name: string;
      readonly subject: HandOverSubject;
    }[]
  >;
};

/** The call an errand books, named the same for every hand-over. */
export const HAND_OVER_CALL_PURPOSE = "Introductory call";

/** What the person is looking at, else what the conversation is about. */
export function handOverSubjectOf(
  request: Pick<QAnswerRequest, "plan" | "subjects">,
): HandOverSubject | null {
  const screen = request.plan.screen;
  if (screen?.companyId !== undefined) {
    return { kind: "COMPANY", companyId: screen.companyId };
  }
  if (screen?.investorOrganisationId !== undefined) {
    return {
      kind: "INVESTOR_ORGANISATION",
      investorOrganisationId: screen.investorOrganisationId,
    };
  }
  for (const subject of request.subjects) {
    if (subject.kind === "RELATIONSHIP") {
      return { kind: "RELATIONSHIP", relationshipId: subject.relationshipId };
    }
    if (subject.kind === "COMPANY") {
      return { kind: "COMPANY", companyId: subject.companyId };
    }
  }
  return null;
}

function comparable(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}`;
}

export async function actOnHandOver(
  port: QHandOverPort,
  request: QAnswerRequest,
  handOver: { readonly counterpartName: string | null },
): Promise<HandOverOutcome> {
  let subject = handOverSubjectOf(request);
  if (subject === null) {
    const candidates = await port.candidates(request);
    // A name they gave resolves to one of their own relationships when it
    // is that relationship's name; never a guess among several.
    if (handOver.counterpartName !== null) {
      const wanted = comparable(handOver.counterpartName);
      const named = candidates.filter((candidate) => {
        const name = comparable(candidate.name);
        return (
          name === wanted || name.includes(wanted) || wanted.includes(name)
        );
      });
      if (named.length === 1 && named[0] !== undefined) {
        subject = named[0].subject;
      }
    }
    if (subject === null) {
      const names = candidates.slice(0, 3).map((candidate) => candidate.name);
      return {
        kind: "ASK",
        line:
          names.length === 0
            ? "Who should I set this up with?"
            : `Who should I set this up with: ${listed(names)}?`,
      };
    }
  }
  const prepared = await port.prepare(request, subject);
  if (prepared === null || prepared.status !== "PREPARED") {
    return { kind: "NONE" };
  }
  return {
    kind: "PREPARED",
    line: `${prepared.awaitingApprovalOf}: once you approve, I express interest where it's still needed, and when you're connected I book an introductory call and send you the link.`,
  };
}

/** The port through the run's own tools, under its plan. */
export function createToolHandOverPort(dependencies: {
  readonly tools: QToolPort;
  readonly logger?: Logger | undefined;
}): QHandOverPort {
  const { tools, logger } = dependencies;
  const call = async (
    request: QAnswerRequest,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    try {
      const outcome = await tools.execute(
        { callId: `q-hand-over-${name}`, name, arguments: args },
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
        "a hand-over step was not taken",
      );
      return null;
    }
  };
  return {
    prepare: async (request, subject) => {
      const ref =
        subject.kind === "COMPANY"
          ? { companyId: subject.companyId }
          : subject.kind === "INVESTOR_ORGANISATION"
            ? { investorOrganisationId: subject.investorOrganisationId }
            : { relationshipId: subject.relationshipId };
      const data = await call(request, "propose_errand", {
        ...ref,
        expressInterest: true,
        openingMessage: null,
        brief: null,
        callPurpose: HAND_OVER_CALL_PURPOSE,
      });
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
    candidates: async (request) => {
      const data = await call(request, "list_my_relationships", {});
      if (data === null || typeof data !== "object") return [];
      const list = (data as { relationships?: unknown }).relationships;
      if (!Array.isArray(list)) return [];
      return list
        .flatMap((item: unknown) => {
          if (item === null || typeof item !== "object") return [];
          const row = item as {
            relationshipId?: unknown;
            stateSince?: unknown;
            counterpart?: { name?: unknown };
          };
          return typeof row.relationshipId === "string" &&
            typeof row.counterpart?.name === "string"
            ? [
                {
                  name: row.counterpart.name,
                  since:
                    typeof row.stateSince === "string" ? row.stateSince : "",
                  subject: {
                    kind: "RELATIONSHIP" as const,
                    relationshipId: row.relationshipId,
                  },
                },
              ]
            : [];
        })
        .sort((a, b) => b.since.localeCompare(a.since))
        .map(({ name, subject }) => ({ name, subject }));
    },
  };
}
