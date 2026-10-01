import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_PRESENCE_PATH,
  Q_WORK_ITEM_PATH,
  Q_WORK_LANE_ANSWER_PATH,
  Q_WORK_LANE_PATH,
  Q_WORK_LANE_REPORT_PATH,
  Q_WORK_PATH,
  QPresenceRequestSchema,
  QWorkAcceptedDtoSchema,
  QWorkDetailDtoSchema,
  QWorkLaneAnswerRequestSchema,
  QWorkListDtoSchema,
  QWorkReportDtoSchema,
} from "@capital-q/contracts";
import { documentToPdf, type ArtifactDocument } from "@capital-q/deck-render";

import type { WorkPort } from "../composition/work/actions.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Q's delegated work, for the person (AUTO, ADR 0030): read their own work
 * (the read is also their presence heartbeat), stop it or one founder in
 * it, give their word on a lane (a time, another time, pass), read and
 * download a first-stage report, and say they are away or back. Ids in
 * paths are input: every call answers only for the person's own work, and
 * someone else's id is the same 404 as one that does not exist.
 */

export type WorkRoutesDependencies = ActorContextDependencies & {
  readonly work: WorkPort;
};

const Id = z.string().uuid();
const ItemParams = z.object({ delegationId: Id }).strict();
const LaneParams = z.object({ delegationId: Id, laneId: Id }).strict();

function notFound(request: FastifyRequest, reply: FastifyReply) {
  const problem = createProblemDetails({
    code: "RESOURCE_NOT_FOUND",
    requestId: request.id,
    detail: "Not found.",
  });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

function invalid(request: FastifyRequest, reply: FastifyReply) {
  const problem = createProblemDetails({
    code: "VALIDATION_FAILED",
    requestId: request.id,
    detail: "The request is not valid.",
  });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

const VERDICT = {
  PROCEED: "Q suggests you proceed",
  MAYBE: "Q is unsure",
  PASS: "Q suggests you pass",
} as const;

export function reportDocument(
  report: z.infer<typeof QWorkReportDtoSchema>,
): ArtifactDocument {
  const label = (basis: "CLAIM" | "INFERENCE") =>
    basis === "CLAIM" ? "their claim, not verified" : "Q's inference";
  return {
    kind: "Q_REPORT",
    title: `First-stage report: ${report.counterpartName}`,
    summary: report.headline,
    dateline: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(report.writtenAt)),
    sections: [
      {
        heading: `Recommendation: ${VERDICT[report.recommendation]}`,
        body: report.why,
        findings: [],
      },
      { heading: "How it went", body: report.howItWent, findings: [] },
      {
        heading: "Strengths",
        body: report.strengths.length === 0 ? "None stated." : "",
        findings: report.strengths.map((item) => ({
          statement: item.point,
          provenance: label(item.basis),
        })),
      },
      {
        heading: "Concerns",
        body: report.concerns.length === 0 ? "None stated." : "",
        findings: report.concerns.map((item) => ({
          statement: item.point,
          provenance: label(item.basis),
        })),
      },
      {
        heading: "Interview",
        body: report.interview
          .map(
            (item) =>
              `Q: ${item.question}\nA${item.byQ ? " (answered by the founder's Q, standing in from their approved brief)" : ""}: ${item.answer}`,
          )
          .join("\n\n"),
        findings: [],
      },
    ],
    gaps: report.openQuestions,
    notice:
      "Written by Q from a chat interview it ran for you. What the founder said is their own claim; nothing here is verified, and it is not investment advice.",
  };
}

export function registerWorkRoutes(
  app: FastifyInstance,
  dependencies: WorkRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { work } = dependencies;

  app.get(Q_WORK_PATH, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    // Reading their own work is also "they are here" for a stand-in.
    await work.seen(actor).catch(() => undefined);
    const items = await work.list(actor);
    void reply.header("Cache-Control", "no-store");
    return QWorkListDtoSchema.parse({ items: items.slice(0, 20) });
  });

  app.get(
    Q_WORK_ITEM_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = ItemParams.safeParse(request.params);
      if (!params.success) return notFound(request, reply);
      const detail = await work.detail(
        getActorContext(request),
        params.data.delegationId,
      );
      if (detail === null) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return QWorkDetailDtoSchema.parse(detail);
    },
  );

  app.delete(
    Q_WORK_ITEM_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = ItemParams.safeParse(request.params);
      if (!params.success) return notFound(request, reply);
      const stopped = await work.stop(
        getActorContext(request),
        params.data.delegationId,
        null,
      );
      if (!stopped) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return QWorkAcceptedDtoSchema.parse({ accepted: true });
    },
  );

  app.delete(
    Q_WORK_LANE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = LaneParams.safeParse(request.params);
      if (!params.success) return notFound(request, reply);
      const stopped = await work.stop(
        getActorContext(request),
        params.data.delegationId,
        params.data.laneId,
      );
      if (!stopped) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return QWorkAcceptedDtoSchema.parse({ accepted: true });
    },
  );

  app.post(
    Q_WORK_LANE_ANSWER_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = LaneParams.safeParse(request.params);
      if (!params.success) return notFound(request, reply);
      const body = QWorkLaneAnswerRequestSchema.safeParse(request.body);
      if (!body.success) return invalid(request, reply);
      const outcome = await work.answer(
        getActorContext(request),
        params.data.delegationId,
        params.data.laneId,
        body.data.kind === "PASS"
          ? { kind: "PASS" }
          : { kind: "BOOK_AT", at: new Date(body.data.at).toISOString() },
      );
      if (outcome !== "ACCEPTED") return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      return QWorkAcceptedDtoSchema.parse({ accepted: true });
    },
  );

  app.get(
    Q_WORK_LANE_REPORT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = LaneParams.safeParse(request.params);
      if (!params.success) return notFound(request, reply);
      const raw = await work.report(
        getActorContext(request),
        params.data.delegationId,
        params.data.laneId,
      );
      const report = QWorkReportDtoSchema.safeParse(raw);
      if (!report.success) return notFound(request, reply);
      void reply.header("Cache-Control", "no-store");
      const accept = request.headers.accept ?? "";
      if (accept.includes("application/pdf")) {
        const bytes = await documentToPdf(reportDocument(report.data), {
          title: `First-stage report: ${report.data.counterpartName}`,
        });
        return reply
          .type("application/pdf")
          .header(
            "Content-Disposition",
            `attachment; filename="first-stage-report.pdf"`,
          )
          .send(Buffer.from(bytes));
      }
      return report.data;
    },
  );

  app.put(
    Q_PRESENCE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = QPresenceRequestSchema.safeParse(request.body);
      if (!body.success) return invalid(request, reply);
      await work.setAway(getActorContext(request), body.data.away);
      void reply.header("Cache-Control", "no-store");
      return QWorkAcceptedDtoSchema.parse({ accepted: true });
    },
  );
}
