import { z } from "zod";

import {
  Q_TASK_CLASSES,
  RESULTS_RANGES,
  type PermittedContextPlan,
  type ResultsDto,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * ADMIN (spec docs/specs/2026-10/admin.md §5): "how is my raise going",
 * "what does my deal flow look like", "download my pipeline report". The
 * same read model as the person's Results page, for their own organisation
 * only (the port reads the actor's server-resolved context, nothing from
 * the model). Read-only; the report is a link the person opens.
 */

export const GET_MY_RESULTS = "results.own.summary" as const;
export const GET_MY_RESULTS_REPORT = "results.own.report" as const;

export type ResultsToolPort = {
  readonly read: (
    actor: ActorContext,
    query: {
      readonly range?: (typeof RESULTS_RANGES)[number] | undefined;
      readonly from?: string | undefined;
      readonly to?: string | undefined;
    },
  ) => Promise<ResultsDto>;
};

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

const OWN = {
  version: 1,
  status: "ACTIVE",
  requiredCapabilities: [],
  supportedPurposes: [...Q_TASK_CLASSES],
  requiredScopeKinds: ["OWN_Q_CONVERSATION"],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: null,
  classification: "READ_ONLY",
  riskClass: "SAFE_READ",
} as const;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ResultsToolInputSchema = z
  .object({
    range: z
      .enum(RESULTS_RANGES)
      .optional()
      .describe(
        "30d, 90d, 12m or all. Default 30d. Ignored when from is given.",
      ),
    from: Day.optional().describe("Custom start day, YYYY-MM-DD."),
    to: Day.optional().describe("Custom end day, YYYY-MM-DD (inclusive)."),
  })
  .strict();
export type ResultsToolInput = z.infer<typeof ResultsToolInputSchema>;

export const ResultsToolOutputSchema = z
  .object({
    side: z.enum(["FOUNDER", "INVESTOR", "NONE"]),
    organisationName: z.string().max(300).nullable(),
    period: z.string().max(60).nullable(),
    figures: z
      .array(
        z
          .object({ label: z.string().max(80), value: z.string().max(120) })
          .strict(),
      )
      .max(40),
    pipeline: z
      .array(
        z
          .object({
            name: z.string().max(300),
            stage: z.string().max(60),
            detail: z.string().max(300),
          })
          .strict(),
      )
      .max(20),
    resultsPage: z.literal("/results"),
  })
  .strict();
export type ResultsToolOutput = z.infer<typeof ResultsToolOutputSchema>;

const STATE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "Discovered",
  INTEREST_EXPRESSED: "Interest expressed",
  CONNECTED: "Connected",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

function words(code: string): string {
  const text = code.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The read model as figures Q can say, every one a recorded count. */
export function summariseResults(results: ResultsDto): ResultsToolOutput {
  if (results.side === "NONE") {
    return {
      side: "NONE",
      organisationName: null,
      period: null,
      figures: [],
      pipeline: [],
      resultsPage: "/results",
    };
  }
  const figures: { label: string; value: string }[] = [];
  const add = (label: string, value: string | number) =>
    figures.push({ label, value: String(value).slice(0, 120) });
  if (results.side === "FOUNDER") {
    const raise = results.raise;
    if (raise === null) {
      add("Raise", "Not stated");
    } else {
      add(
        "Target",
        raise.target === null
          ? "Not stated"
          : `${raise.target.currencyCode} ${raise.target.amount}`,
      );
      for (const total of raise.totals) {
        add(`Confirmed (${total.currencyCode})`, total.confirmed);
        add(`Soft (${total.currencyCode})`, total.soft);
      }
      add("Remaining", raise.remaining ?? "Not stated");
      add("In conversation without a commitment", raise.inConversation);
    }
    add("Interests received", results.engagement.interestsReceived);
    add("Connections", results.engagement.connections);
    add("Meetings held", results.engagement.meetingsHeld);
    add(
      "Investor firms that opened the profile",
      results.engagement.profileOpens.belowFloor
        ? "Fewer than 3"
        : (results.engagement.profileOpens.value ?? 0),
    );
    add("Rehearsals finished", results.rehearsals.length);
    add(
      "Documents made",
      results.documents.reduce((sum, d) => sum + d.count, 0),
    );
    return {
      side: "FOUNDER",
      organisationName: results.organisationName,
      period: results.window.label,
      figures: figures.slice(0, 40),
      pipeline: results.pipeline.rows.slice(0, 20).map((row) => ({
        name: row.investorName,
        stage: STATE_WORDS[row.state] ?? words(row.state),
        detail: `since ${row.since.slice(0, 10)}`,
      })),
      resultsPage: "/results",
    };
  }
  const f = results.funnel;
  add("Seen", f.seen);
  add("Saved", f.saved);
  add("Interest expressed", f.interest);
  add("Connected", f.connected);
  add("Met", f.met);
  add("Committed", f.committed);
  add("Meetings held", results.meetings.held);
  add("Upcoming meetings", results.meetings.upcoming.length);
  for (const run of results.qWork.runs)
    add(`Q ${words(run.capability).toLowerCase()} runs`, run.runs);
  add("Errands Q ran", results.qWork.errands);
  add("Documents Q prepared", results.qWork.documents);
  return {
    side: "INVESTOR",
    organisationName: results.organisationName,
    period: results.window.label,
    figures: figures.slice(0, 40),
    pipeline: results.pipelineFit.slice(0, 20).map((row) => ({
      name: row.companyName,
      stage: STATE_WORDS[row.state] ?? words(row.state),
      detail: row.excluded
        ? "hits a declared exclusion"
        : row.reasons.length === 0
          ? results.hasMandate
            ? "no declared overlap with the mandate yet"
            : "no mandate on file"
          : row.reasons
              .map((r) => `${words(r.kind).toLowerCase()} ${r.detail}`)
              .join(", ")
              .slice(0, 300),
    })),
    resultsPage: "/results",
  };
}

export function createGetMyResultsTool(
  port: ResultsToolPort,
): AnyQToolDefinition {
  return defineQTool<ResultsToolInput, ResultsToolOutput, null>({
    ...OWN,
    id: GET_MY_RESULTS,
    providerName: "get_my_results",
    description:
      "Reads the person's own results on Capital Q for a period, from recorded events only: for a founder, raise progress (target, confirmed and soft commitments, what remains, investors in conversation), investor engagement (interests, connections, meetings held) and their pipeline by stage; for an investor, their deal flow funnel (seen, saved, interest, connected, met, committed), meetings, the work Q did for them and how their pipeline fits their mandate. Call it for 'how is my raise going', 'how is my deal flow', 'what have I done this month'. Their Results page is /results. Never estimate beyond these figures.",
    input: ResultsToolInputSchema,
    output: ResultsToolOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) =>
      summariseResults(await port.read(context.actor, input)),
  });
}

export const ResultsReportOutputSchema = z
  .object({
    available: z.boolean(),
    period: z.string().max(60).nullable(),
    pdf: z.string().max(200).nullable(),
    csv: z.string().max(200).nullable(),
  })
  .strict();
export type ResultsReportOutput = z.infer<typeof ResultsReportOutputSchema>;

export function resultsReportLinks(input: ResultsToolInput): {
  readonly pdf: string;
  readonly csv: string;
} {
  const search = new URLSearchParams();
  if (input.from !== undefined) {
    search.set("from", input.from);
    if (input.to !== undefined) search.set("to", input.to);
  } else {
    search.set("range", input.range ?? "30d");
  }
  return {
    pdf: `/results/report?format=pdf&${search.toString()}`,
    csv: `/results/report?format=csv&${search.toString()}`,
  };
}

export function createGetMyResultsReportTool(
  port: ResultsToolPort,
): AnyQToolDefinition {
  return defineQTool<ResultsToolInput, ResultsReportOutput, null>({
    ...OWN,
    id: GET_MY_RESULTS_REPORT,
    providerName: "get_my_results_report",
    description:
      "Gives the person download links for their own results report for a period: a branded Capital Q PDF and a CSV they can use in their business (raise progress and pipeline for a founder; deal flow, meetings and mandate fit for an investor). Call it for 'download my pipeline report', 'send me a report of my raise', 'export my deal flow'. Share both links exactly as returned; they open in the app.",
    input: ResultsToolInputSchema,
    output: ResultsReportOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: async (input, context) => {
      const results = await port.read(context.actor, input);
      if (results.side === "NONE") {
        return { available: false, period: null, pdf: null, csv: null };
      }
      const links = resultsReportLinks(input);
      return {
        available: true,
        period: results.window.label,
        pdf: links.pdf,
        csv: links.csv,
      };
    },
  });
}

export function createResultsTools(ports: {
  readonly results?: ResultsToolPort | undefined;
}): readonly AnyQToolDefinition[] {
  return ports.results === undefined
    ? []
    : [
        createGetMyResultsTool(ports.results),
        createGetMyResultsReportTool(ports.results),
      ];
}
