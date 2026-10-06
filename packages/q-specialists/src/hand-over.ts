import { isActiveMatchState } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type {
  ContextFirewallPort,
  QAnswerRequest,
  QToolPort,
} from "@capital-q/q-runtime";
import { closestByName } from "@capital-q/q-tools";

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
  | { readonly kind: "NONE" }
  /**
   * Handing over work with no one counterpart to hand it over for ("just
   * handle it", "handle my investors" with none yet): a standing
   * instruction is what that means (QA 2026-10-03, runs 5c6dcabe,
   * 18eb8420). Never a guessed target.
   */
  | { readonly kind: "STANDING" };

/**
 * A time they asked for, in minutes from now (TURN_READER v28 timeWindow:
 * "in the next five minutes" is {0, 5}); null bounds are open.
 */
export type HandOverTimeWindow = {
  readonly fromMinutes: number | null;
  readonly toMinutes: number | null;
};

export type QHandOverPort = {
  readonly prepare: (
    request: QAnswerRequest,
    subject: HandOverSubject,
    window?: HandOverTimeWindow | null,
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
  /**
   * "Book a meeting with X" when they are already connected (action parity
   * 2026-10-02): a direct call proposal at their first free time, not an
   * errand. Null when it cannot be one (not connected, no calendar, no
   * free time): the errand below handles those. Absent: never tried.
   */
  readonly proposeMeeting?: (
    request: QAnswerRequest,
    subject: HandOverSubject,
    window?: HandOverTimeWindow | null,
  ) => Promise<{
    readonly awaitingApprovalOf: string;
    /** The slot's local time; null when the card's title already says it. */
    readonly local: string | null;
    readonly alsoFree: readonly string[];
  } | null>;
  readonly candidates: (request: QAnswerRequest) => Promise<
    readonly {
      readonly name: string;
      readonly subject: HandOverSubject;
      /** Where it stands for their side (CONNECTED, INTEREST_EXPRESSED, …). */
      readonly state?: string | undefined;
    }[]
  >;
};

/** The call an errand books, named the same for every hand-over. */
export const HAND_OVER_CALL_PURPOSE = "Introductory call";

/**
 * The first message a hand-over's errand sends once both sides are
 * connected: short, true for any counterpart, approved word for word.
 */
export const HAND_OVER_OPENING_MESSAGE =
  "Hello, thanks for connecting on Capital Q. I'd be glad to learn more and have asked Q to find us a time for a short introductory call.";

/** How many of their relationships a "who?" question names at most. */
const ASK_NAMES_MAX = 6;

/** What the person is looking at, else what the conversation is about. */
export function handOverSubjectOf(
  request: Pick<QAnswerRequest, "plan" | "subjects">,
): HandOverSubject | null {
  // Their own company is never something to hand over (QA 2026-10-03,
  // runs 4e9dc7c0, 02eb9643: a founder's run always carries it as a
  // subject, so "handle my investors" was taken as an errand for it and
  // refused). Own: the plan is about their own company, or it grants the
  // owner-only private financials scope for it.
  const own = new Set<string>();
  for (const scope of request.plan.scopes) {
    if (
      scope.kind === "COMPANY_PRIVATE_FINANCIALS" &&
      scope.subject?.kind === "COMPANY"
    ) {
      own.add(scope.subject.companyId);
    }
  }
  const ownQuestion = request.plan.purpose.taskClass === "OWN_COMPANY_QUESTION";
  const isOwn = (companyId: string) => ownQuestion || own.has(companyId);
  const screen = request.plan.screen;
  // The page they are on names its company; only the owner-only scope says
  // it is theirs.
  if (screen?.companyId !== undefined && !own.has(screen.companyId)) {
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
    if (subject.kind === "COMPANY" && !isOwn(subject.companyId)) {
      return { kind: "COMPANY", companyId: subject.companyId };
    }
  }
  return null;
}

/** The first five-minute mark at least a minute ahead inside the window, or null. */
function earliestInside(at: Date, window: HandOverTimeWindow): string | null {
  const step = 5 * 60_000;
  const earliest = at.getTime() + Math.max(window.fromMinutes ?? 0, 1) * 60_000;
  const start = Math.ceil(earliest / step) * step;
  const latest =
    window.toMinutes === null
      ? Number.POSITIVE_INFINITY
      : at.getTime() + window.toMinutes * 60_000;
  return start <= latest ? new Date(start).toISOString() : null;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}`;
}

export async function actOnHandOver(
  port: QHandOverPort,
  request: QAnswerRequest,
  handOver: {
    readonly kind?: "MEETING" | "HAND_OVER" | undefined;
    readonly counterpartName: string | null;
  },
  /** The time they asked for, if any (TURN_READER v28). */
  window: HandOverTimeWindow | null = null,
): Promise<HandOverOutcome> {
  let subject: HandOverSubject | null = null;
  const onScreen = handOverSubjectOf(request);
  // A company request waiting on this investor comes first: handing it
  // over means accepting it and opening the conversation. Who it is: the
  // name they gave, else the company on screen, else (one waiting) that
  // one, else they are asked once, by name. A name or company that is not
  // a waiting request falls through to the errand below.
  // Work handed over with no one named and nothing on screen ("just handle
  // it", "handle all my work") is a standing instruction, decided before
  // anything else: never a waiting request or an errand Q would have to
  // pick for them (QA 2026-10-03, runs 73c40208, bec2d96a, 1d641c09: a
  // pending connection request was accepted in its place).
  if (
    handOver.kind !== "MEETING" &&
    handOver.counterpartName === null &&
    onScreen === null
  ) {
    return { kind: "STANDING" };
  }
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
  // A name they gave is matched against ALL their relationships, outgoing
  // interest included, as they said or misheard it (live 2026-10-02:
  // "TALUM" for Tallyloom). One match is that one; several are asked
  // about; none means the question names every one of them.
  let chosen: (typeof candidates)[number] | undefined;
  let named: readonly (typeof candidates)[number][] = [];
  if (handOver.counterpartName !== null) {
    named = closestByName(
      candidates,
      handOver.counterpartName,
      (candidate) => candidate.name,
    );
    if (named.length === 1 && named[0] !== undefined) {
      chosen = named[0];
      subject = chosen.subject;
    }
  }
  // Work handed over (not a meeting) for a name that is none of their
  // relationships ("my investors", "everyone", "new founders") is work in
  // general: a standing instruction, whether or not they have relationships
  // (QA 2026-10-03, run d77f9934). A meeting with an unknown name is still
  // asked about by name.
  if (
    handOver.kind !== "MEETING" &&
    subject === null &&
    onScreen === null &&
    handOver.counterpartName !== null &&
    named.length === 0
  ) {
    return { kind: "STANDING" };
  }
  subject ??= onScreen;
  if (subject === null) {
    const pool = named.length > 1 ? named : candidates;
    const names = pool
      .slice(0, ASK_NAMES_MAX)
      .map((candidate) => candidate.name);
    return {
      kind: "ASK",
      line:
        names.length === 0
          ? "Who should I set this up with?"
          : `Who should I set this up with: ${listed(names)}?`,
    };
  }
  // The truth first when there is nothing of theirs to accept.
  const truth =
    chosen?.state === "INTEREST_EXPRESSED"
      ? `${chosen.name} hasn't accepted your interest yet, so there's nothing to accept. `
      : "";
  if (handOver.kind === "MEETING" && port.proposeMeeting !== undefined) {
    const meeting = await port.proposeMeeting(request, subject, window);
    if (meeting !== null) {
      const also =
        meeting.alsoFree.length === 0
          ? ""
          : ` (also free: ${listed([...meeting.alsoFree])})`;
      const when =
        meeting.local === null
          ? ""
          : window === null
            ? ` ${meeting.local} is your first free time.`
            : ` ${meeting.local}, as you asked.`;
      return {
        kind: "PREPARED",
        line: `${meeting.awaitingApprovalOf}:${when} Approve it and I send the invite with a Meet link, or tell me another time${also}.`,
      };
    }
  }
  const prepared = await port.prepare(request, subject, window);
  if (prepared?.status === "ALREADY_ACTIVE") {
    // No second card: what Q is already doing there, from its real state.
    return {
      kind: "PREPARED",
      line: `${truth}${prepared.awaitingApprovalOf} Want me to change anything?`,
    };
  }
  if (prepared === null || prepared.status !== "PREPARED") {
    // Nothing to hand over for the screen's subject (their own company,
    // say) and no one named: the general meaning, not "could not".
    return handOver.kind !== "MEETING" &&
      handOver.counterpartName === null &&
      chosen === undefined
      ? { kind: "STANDING" }
      : { kind: "NONE" };
  }
  return {
    kind: "PREPARED",
    line:
      chosen?.state !== undefined && isActiveMatchState(chosen.state)
        ? `${prepared.awaitingApprovalOf}: once you approve, I send them the message on the card, book an introductory call and send you the link.`
        : chosen?.state === "INTEREST_EXPRESSED"
          ? `${truth}${prepared.awaitingApprovalOf}: once you approve, I wait for them to accept, then send them the message on the card, book an introductory call and send you the link.`
          : `${prepared.awaitingApprovalOf}: once you approve, I express interest where it's still needed, and when you're connected I send them the message on the card, book an introductory call and send you the link.`,
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
  readonly now?: (() => Date) | undefined;
}): QHandOverPort {
  const { tools, firewall, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
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
  const refOf = (subject: HandOverSubject) =>
    subject.kind === "COMPANY"
      ? { companyId: subject.companyId }
      : subject.kind === "INVESTOR_ORGANISATION"
        ? { investorOrganisationId: subject.investorOrganisationId }
        : { relationshipId: subject.relationshipId };
  return {
    proposeMeeting: async (
      request,
      subject,
      window: HandOverTimeWindow | null = null,
    ) => {
      const plan = await planFor(request, subject).catch(() => null);
      if (plan === null) return null;
      const ref = refOf(subject);
      const at = now();
      const minutes = (n: number) => new Date(at.getTime() + n * 60_000);
      // The window they asked for bounds the search; without one, the
      // tool's own default (the coming week).
      const range =
        window === null
          ? {}
          : {
              from: minutes(Math.max(window.fromMinutes ?? 0, 1)).toISOString(),
              ...(window.toMinutes === null
                ? {}
                : { to: minutes(window.toMinutes).toISOString() }),
            };
      const found = await call(
        request,
        "find_meeting_times",
        { ...ref, ...range },
        plan,
      );
      if (found === null || typeof found !== "object") return null;
      const times = found as { status?: unknown; slots?: unknown };
      if (times.status !== "OK" || !Array.isArray(times.slots)) return null;
      const slots: { startsAt: string; local: string | null }[] = (
        times.slots as unknown[]
      ).flatMap((slot: unknown) => {
        if (slot === null || typeof slot !== "object") return [];
        const { startsAt, local } = slot as {
          startsAt?: unknown;
          local?: unknown;
        };
        return typeof startsAt === "string" && typeof local === "string"
          ? [{ startsAt, local }]
          : [];
      });
      // No free slot inside a near window ("in the next five minutes"):
      // the earliest five-minute mark inside it, for them to approve or
      // move; the card shows the exact time. Not connected stays null.
      const soonest =
        slots[0] === undefined && window?.toMinutes != null
          ? earliestInside(at, window)
          : null;
      const first =
        slots[0] ??
        (soonest === null ? undefined : { startsAt: soonest, local: null });
      if (first === undefined) return null;
      const data = await call(
        request,
        "propose_meeting",
        { ...ref, purpose: HAND_OVER_CALL_PURPOSE, startsAt: first.startsAt },
        plan,
      );
      if (data === null || typeof data !== "object") return null;
      const record = data as Record<string, unknown>;
      return record["status"] === "PREPARED" &&
        typeof record["awaitingApprovalOf"] === "string"
        ? {
            awaitingApprovalOf: record["awaitingApprovalOf"],
            local: first.local,
            alsoFree: slots
              .slice(1)
              .flatMap((slot) => (slot.local === null ? [] : [slot.local])),
          }
        : null;
    },
    prepare: async (
      request,
      subject,
      window: HandOverTimeWindow | null = null,
    ) => {
      const ref = refOf(subject);
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
          openingMessage: HAND_OVER_OPENING_MESSAGE,
          brief: null,
          callPurpose: HAND_OVER_CALL_PURPOSE,
          // The time they asked for travels to the errand's booking.
          callWindow: window,
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
            state?: unknown;
            counterpart?: { name?: unknown };
          };
          return typeof row.relationshipId === "string" &&
            typeof row.counterpart?.name === "string"
            ? [
                {
                  name: row.counterpart.name,
                  since:
                    typeof row.stateSince === "string" ? row.stateSince : "",
                  state: typeof row.state === "string" ? row.state : undefined,
                  subject: {
                    kind: "RELATIONSHIP" as const,
                    relationshipId: row.relationshipId,
                  },
                },
              ]
            : [];
        })
        .sort((a, b) => b.since.localeCompare(a.since))
        .map(({ name, subject, state }) => ({ name, subject, state }));
    },
  };
}
