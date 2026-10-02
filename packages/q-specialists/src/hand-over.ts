import type { Logger } from "@capital-q/observability";
import type {
  ContextFirewallPort,
  QAnswerRequest,
  QToolPort,
} from "@capital-q/q-runtime";

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
 *
 * A counterpart they name ("handle an intro to Kazikit") that is one of
 * their own relationships wins over the screen (QA 2026-10-01, run
 * 41cdef22: asked from Q's page, the named relationship was found but the
 * run's plan, built for the screen, did not bind it, so propose_errand was
 * refused and the answer said the identifier was "not available"). That
 * relationship is then planned by the Context Firewall on its own -- party
 * membership decides, as for any subject -- before the tool is called.
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
  /**
   * An investor's pending founders' Connection Requests (live 2026-10-02:
   * "accept their connection and send them a message"): answer one with
   * Q's opening message, as ONE approval. `company` is who they named or
   * the company on screen, or null. Null result: not an investor, or not
   * composed. Absent: never tried.
   */
  readonly answerConnectionRequest?: (
    request: QAnswerRequest,
    company: string | null,
  ) => Promise<{
    readonly status: string;
    readonly awaitingApprovalOf: string;
  } | null>;
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
  let subject: HandOverSubject | null = null;
  const onScreen = handOverSubjectOf(request);
  // A founder's request waiting on this investor comes first: handing it
  // over means accepting it and opening the conversation. Who it is: the
  // name they gave, else the company on screen, else (one waiting) that
  // one, else they are asked once, by name. A name or company that is not
  // a waiting request falls through to the errand below.
  if (port.answerConnectionRequest !== undefined) {
    const named =
      handOver.counterpartName ??
      (onScreen?.kind === "COMPANY" ? onScreen.companyId : null);
    const answered = await port.answerConnectionRequest(request, named);
    if (answered !== null) {
      switch (answered.status) {
        case "PREPARED":
          return {
            kind: "PREPARED",
            line: `${answered.awaitingApprovalOf}: once you approve, I accept it and send the message shown on the card, word for word.`,
          };
        case "ONE_PER_TURN":
          return {
            kind: "PREPARED",
            line: "Another change is already waiting for your approval in this answer; approve or decline it first, then I'll prepare this.",
          };
        case "WHICH_ONE":
          return { kind: "ASK", line: answered.awaitingApprovalOf };
        default:
          break;
      }
    }
  }
  // Their own relationships are read only when a name needs resolving or
  // there is nothing on screen to act on.
  const candidates =
    handOver.counterpartName !== null || onScreen === null
      ? await port.candidates(request)
      : [];
  // A name they gave resolves to one of their own relationships when it
  // is that relationship's name; never a guess among several.
  if (handOver.counterpartName !== null) {
    const wanted = comparable(handOver.counterpartName);
    const named = candidates.filter((candidate) => {
      const name = comparable(candidate.name);
      return (
        name.length > 0 &&
        wanted.length > 0 &&
        (name === wanted || name.includes(wanted) || wanted.includes(name))
      );
    });
    if (named.length === 1 && named[0] !== undefined) {
      subject = named[0].subject;
    }
  }
  subject ??= onScreen;
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
  const prepared = await port.prepare(request, subject);
  if (prepared?.status === "ALREADY_ACTIVE") {
    // No second card: what Q is already doing there, from its real state.
    return {
      kind: "PREPARED",
      line: `${prepared.awaitingApprovalOf} Want me to change anything?`,
    };
  }
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
  /**
   * Plans a relationship they named that the run's own plan does not bind.
   * Without it, such a relationship is refused by the tool, as before.
   */
  readonly firewall?: ContextFirewallPort | undefined;
  readonly logger?: Logger | undefined;
}): QHandOverPort {
  const { tools, firewall, logger } = dependencies;
  const planFor = async (
    request: QAnswerRequest,
    subject: HandOverSubject,
  ): Promise<QAnswerRequest["plan"] | null> => {
    if (subject.kind !== "RELATIONSHIP" || firewall === undefined) {
      return request.plan;
    }
    const bound = request.plan.subjects.some(
      (entry) =>
        entry.kind === "RELATIONSHIP" &&
        entry.relationshipId === subject.relationshipId,
    );
    if (bound) return request.plan;
    const decision = await firewall.plan({
      actor: request.actor,
      runId: request.runId,
      correlationId: request.correlationId,
      capability: request.capability,
      subjects: [
        { kind: "RELATIONSHIP", relationshipId: subject.relationshipId },
      ],
    });
    return decision.outcome === "AUTHORISED" ? decision.plan : null;
  };
  const call = async (
    request: QAnswerRequest,
    name: string,
    args: Record<string, unknown>,
    plan: QAnswerRequest["plan"] = request.plan,
  ): Promise<unknown> => {
    try {
      const outcome = await tools.execute(
        { callId: `q-hand-over-${name}`, name, arguments: args },
        {
          actor: request.actor,
          runId: request.runId,
          correlationId: request.correlationId,
          capability: request.capability,
          plan,
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
      const plan = await planFor(request, subject).catch((error: unknown) => {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "a named relationship was not planned",
        );
        return null;
      });
      if (plan === null) return null;
      const data = await call(
        request,
        "propose_errand",
        {
          ...ref,
          expressInterest: true,
          openingMessage: null,
          brief: null,
          callPurpose: HAND_OVER_CALL_PURPOSE,
        },
        plan,
      );
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
    answerConnectionRequest: async (request, company) => {
      const data = await call(request, "propose_connection_request_answer", {
        company,
        decision: "ACCEPTED",
        openingMessage: null,
        withMessage: true,
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
