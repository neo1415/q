import { z } from "zod";

import {
  CloseDealRequestSchema,
  DealActionResultDtoSchema,
  GenerateRelationshipReportRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MarkDealSignedRequestSchema,
  NETWORK_RELATIONSHIP_DEAL_CHECKLIST_PATH,
  NETWORK_RELATIONSHIP_DEAL_CLOSE_PATH,
  NETWORK_RELATIONSHIP_DEAL_SIGNED_PATH,
  NETWORK_RELATIONSHIP_DEAL_TERMS_PATH,
  NETWORK_RELATIONSHIP_REPORTS_PATH,
  RecordDealTermsRequestSchema,
  RelationshipReportKindSchema,
  RelationshipReportSummaryDtoSchema,
  TickDealChecklistRequestSchema,
  type DealViewDto,
  type KnownErrorCode,
  type QTaskClass,
  type RecordDealTermsRequest,
} from "@capital-q/contracts";
import {
  moneyText,
  type DealRefusal,
  type DealResult,
  type ReportResult,
} from "@capital-q/network";

import {
  defineAppAction,
  defineAppActionFamily,
  portMissing,
  refusal,
  relationshipTarget,
  type AnyAppAction,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Deal close (founder, 2026-10-08; ADR 0040). After the meeting, to a clean
 * end, on the ONE relationship: the terms both sides see, the signature
 * recorded against the signed copy, and the close; reports at every stage;
 * and Q's answer to "where are we with Tensorgate?".
 *
 * Terms, signature and close are CONSEQUENTIAL with consequence TERMS
 * (ADR 0043): on the screen a button with its confirm, and when Q prepares
 * one the person approves exactly the card -- the card shows every term,
 * and a signature names the exact terms version it binds to, so a revision
 * since the card was prepared is refused (TERMS_CHANGED), never silently
 * signed. Money itself stays with the commitment actions (spec 6.6.14).
 * Each carries the screen's Idempotency-Key, or the run's for Q.
 */

const deal = (ports: AppActionPorts) => ports.deal ?? portMissing("deal");
const servicesDecide = () => Promise.resolve({ ok: true as const });
const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];

const REFUSALS: Readonly<
  Record<
    DealRefusal,
    { readonly code: KnownErrorCode; readonly detail: string }
  >
> = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  NOT_ALLOWED: {
    code: "PERMISSION_DENIED",
    detail: "That's for the other side of this relationship.",
  },
  NOT_IN_STAGE: {
    code: "RESOURCE_CONFLICT",
    detail: "That isn't possible where this deal is now.",
  },
  DOCUMENT_NOT_SHARED: {
    code: "VALIDATION_FAILED",
    detail:
      "Share the document with this relationship first (data room), then attach it.",
  },
  TERMS_CHANGED: {
    code: "RESOURCE_CONFLICT",
    detail:
      "The terms changed since this was prepared. Review the new version and sign that.",
  },
  UNKNOWN_ITEM: {
    code: "VALIDATION_FAILED",
    detail: "That isn't one of the checklist items.",
  },
};

const problemOf = (out: DealResult | ReportResult) =>
  out.outcome === "OK" ? null : REFUSALS[out.code];

const http = {
  status: (out: DealResult) =>
    out.outcome === "OK" && out.deduplicated ? (200 as const) : (201 as const),
  problem: problemOf,
  notFound: (out: DealResult) =>
    out.outcome === "REFUSED" && out.code === "NOT_FOUND",
  respond: (out: DealResult) =>
    out.outcome === "OK"
      ? DealActionResultDtoSchema.parse({
          relationshipId: out.relationshipId,
          deduplicated: out.deduplicated,
        })
      : undefined,
};

const succeeded = (out: DealResult | ReportResult) => out.outcome === "OK";

const PURPOSES: readonly QTaskClass[] = [
  "RELATIONSHIP_QUESTION",
  "ACTION_PREPARATION",
];

const INSTRUMENT: Readonly<
  Record<RecordDealTermsRequest["instrument"], string>
> = {
  SAFE: "SAFE",
  CONVERTIBLE_NOTE: "convertible note",
  PRICED_EQUITY: "priced equity round",
  OTHER: "other instrument",
};

/** Every term on the card: the approval binds to exactly these. */
export function termsPreview(terms: RecordDealTermsRequest): string {
  const parts = [
    `${INSTRUMENT[terms.instrument]}, ${moneyText(terms.amount, terms.currencyCode)}`,
  ];
  if (terms.valuationCap !== undefined) {
    parts.push(
      `cap ${moneyText(terms.valuationCap, terms.currencyCode)} ${terms.valuationBasis === "PRE_MONEY" ? "pre-money" : "post-money"}`,
    );
  }
  if (terms.preMoneyValuation !== undefined) {
    parts.push(
      `pre-money ${moneyText(terms.preMoneyValuation, terms.currencyCode)}`,
    );
  }
  if (terms.discountPercent !== undefined)
    parts.push(`${terms.discountPercent}% discount`);
  if (terms.proRata !== undefined)
    parts.push(terms.proRata ? "pro-rata right" : "no pro-rata right");
  if (terms.otherTerms !== undefined) parts.push(terms.otherTerms);
  if (terms.termsDocumentId !== undefined) parts.push("document attached");
  return `Both sides see these terms on the relationship: ${parts.join("; ")}. A revision later is a new version; nothing is edited.`;
}

const Terms = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: RecordDealTermsRequestSchema,
  })
  .strict();

const RECORD_TERMS = defineAppAction<z.infer<typeof Terms>, DealResult>({
  name: "relationship.deal.terms",
  consequence: "TERMS",
  short: "record the deal terms",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Records the terms of an investment (SAFE, note or priced round: amount, cap, discount, pro-rata) on a relationship after a soft commit, as the relationship page does; both sides see them.",
  input: Terms,
  output: z.custom<DealResult>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    deal(ports).recordTerms({
      actor: context.actor,
      relationshipId: input.relationshipId,
      terms: input.input,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input) => ({
    summary: "Record the terms",
    preview: termsPreview(input.input),
  }),
  done: (out) =>
    out.outcome === "OK"
      ? "Done. The terms are on the relationship for both sides."
      : (problemOf(out)?.detail ?? "That couldn't be recorded."),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_DEAL_TERMS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    idempotencyKeyOf: (input) => input.idempotencyKey,
    ...http,
  },
});

const Signed = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: MarkDealSignedRequestSchema,
  })
  .strict();

const MARK_SIGNED = defineAppAction<z.infer<typeof Signed>, DealResult>({
  name: "relationship.deal.signed",
  consequence: "TERMS",
  short: "record terms as signed",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Records the current terms as signed, against the signed copy shared with the relationship (e-signature happens elsewhere), as the relationship page does.",
  input: Signed,
  output: z.custom<DealResult>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    deal(ports).markSigned({
      actor: context.actor,
      relationshipId: input.relationshipId,
      termsId: input.input.termsId,
      signedDocumentId: input.input.signedDocumentId,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: () => ({
    summary: "Record the terms as signed",
    preview:
      "Both sides see the terms marked signed, with the signed copy attached. It applies to exactly the version on this card; if the terms changed since, nothing is recorded.",
  }),
  done: (out) =>
    out.outcome === "OK"
      ? "Done. The terms are recorded as signed."
      : (problemOf(out)?.detail ?? "That couldn't be recorded."),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_DEAL_SIGNED_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    idempotencyKeyOf: (input) => input.idempotencyKey,
    ...http,
  },
});

const Close = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: CloseDealRequestSchema,
  })
  .strict();

const CLOSE = defineAppAction<z.infer<typeof Close>, DealResult>({
  name: "relationship.deal.close",
  consequence: "TERMS",
  short: "close the investment",
  area: "relationships",
  classification: "CONSEQUENTIAL",
  does: "Closes an investment once its terms are signed and the money was confirmed received: the relationship's clean end, and the closing report, as the relationship page does.",
  input: Close,
  output: z.custom<DealResult>(),
  authorize: servicesDecide,
  run: async (ports, context, input) => {
    const out = await deal(ports).close({
      actor: context.actor,
      relationshipId: input.relationshipId,
      note: input.input.note,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    });
    // The closing report at the close (founder: reports at every point).
    // Best effort: a failed compile never undoes the close, and the page
    // can generate it again.
    if (out.outcome === "OK" && !out.deduplicated) {
      await deal(ports)
        .generateReport({
          actor: context.actor,
          relationshipId: input.relationshipId,
          kind: "CLOSING",
          idempotencyKey: `${input.idempotencyKey}:closing`,
          correlationId: context.correlationId,
        })
        .catch(() => undefined);
    }
    return out;
  },
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input) => ({
    summary: "Close the investment",
    preview: `Both sides see the investment closed, with the signed terms and the money received${
      input.input.note === undefined ? "" : ` ("${input.input.note}")`
    }. This is the relationship's final state, and a closing report is filed.`,
  }),
  done: (out) =>
    out.outcome === "OK"
      ? "Done. The investment is closed, and the closing report is on the relationship."
      : (problemOf(out)?.detail ?? "That couldn't be closed."),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_DEAL_CLOSE_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body ?? {},
    }),
    idempotencyKeyOf: (input) => input.idempotencyKey,
    ...http,
  },
});

const Named = z
  .object({
    relationship: z
      .string()
      .min(1)
      .max(200)
      .describe("The company (or investor) as the person named it."),
  })
  .strict();

const DealTool = Named.extend({
  operation: z
    .enum(["RECORD_TERMS", "MARK_SIGNED", "CLOSE"])
    .describe(
      "RECORD_TERMS: the terms they agreed (instrument and amount at least). MARK_SIGNED: the current terms were signed. CLOSE: the investment closed (terms signed, money received).",
    ),
  terms: RecordDealTermsRequestSchema.optional().describe(
    "RECORD_TERMS only: exactly the terms they stated; leave out anything they did not say.",
  ),
  note: z
    .string()
    .min(1)
    .max(1000)
    .optional()
    .describe("CLOSE only: their own closing note, if any."),
}).strict();

async function viewOf(
  ports: AppActionPorts,
  actor: Parameters<NonNullable<AppActionPorts["deal"]>["view"]>[0],
  relationshipId: string,
): Promise<DealViewDto | null> {
  return deal(ports)
    .view(actor, relationshipId)
    .catch(() => null);
}

export const DEAL_ACTIONS: readonly AnyAppAction[] = defineAppActionFamily<
  z.infer<typeof DealTool>
>({
  name: "relationship.deal.change",
  consequence: "TERMS",
  short: "deal terms, signing and close",
  area: "relationships",
  does: "Records where an investment stands after a soft commit: the terms, that they were signed, or that it closed, as the relationship page does.",
  members: { RECORD_TERMS, MARK_SIGNED, CLOSE },
  tool: {
    name: "relationship_deal",
    description:
      "Use when the person states a deal fact about one of their own relationships: the terms (\"we agreed a SAFE, $250k at an $8m post-money cap with Tensorgate\"), that the documents were signed, or that the investment closed. Prepares it for the person's approval; nothing changes until they approve exactly the card. Never for money sent or received (that is the commitment's own step), never for an opinion.",
    input: DealTool,
    references: { relationship: "RELATIONSHIP" },
    purposes: PURPOSES,
    eval: {
      say: [
        "We agreed a SAFE with {name}: 250,000 dollars at an 8 million post-money cap.",
        "The investment with {name} has closed.",
      ],
      names: "RELATIONSHIP",
      orSays: "isn't possible where this deal is|soft commit|not found",
    },
    toCanonical: async (tool, context, ports) => {
      const relationshipId = tool.relationship;
      switch (tool.operation) {
        case "RECORD_TERMS":
          return tool.terms === undefined
            ? refusal("Which terms: the instrument and the amount at least?")
            : {
                operation: "RECORD_TERMS",
                input: {
                  relationshipId,
                  idempotencyKey: context.idempotencyKey,
                  input: tool.terms,
                },
              };
        case "MARK_SIGNED": {
          const view = await viewOf(ports, context.actor, relationshipId);
          if (view === null) return null;
          if (view.terms === null)
            return refusal("There are no terms on record to sign yet.");
          // Q never guesses which document is the signed copy: only one
          // candidate is unambiguous.
          const candidates = view.sharedDocumentIds.filter(
            (id) => id !== view.terms?.termsDocumentId,
          );
          if (candidates.length !== 1 || candidates[0] === undefined) {
            return refusal(
              "Choose the signed copy on the relationship page: it has to be a document shared with this relationship.",
            );
          }
          return {
            operation: "MARK_SIGNED",
            input: {
              relationshipId,
              idempotencyKey: context.idempotencyKey,
              input: {
                termsId: view.terms.termsId,
                signedDocumentId: candidates[0],
              },
            },
          };
        }
        case "CLOSE":
          return {
            operation: "CLOSE",
            input: {
              relationshipId,
              idempotencyKey: context.idempotencyKey,
              input: tool.note === undefined ? {} : { note: tool.note },
            },
          };
      }
    },
  },
});

const REPORT_WORDS: Readonly<
  Record<z.infer<typeof RelationshipReportKindSchema>, string>
> = {
  MEETING_SUMMARY: "meeting summary",
  DILIGENCE: "diligence report",
  INVESTMENT_MEMO: "investment memo",
  CLOSING: "closing report",
  PASS: "pass report",
};

const Report = z
  .object({
    relationshipId: z.string().max(64),
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: GenerateRelationshipReportRequestSchema,
  })
  .strict();

export const REPORT_ACTION = defineAppAction<
  z.infer<typeof Report>,
  ReportResult,
  z.infer<typeof Named> & { kind: z.infer<typeof RelationshipReportKindSchema> }
>({
  name: "relationship.report.generate",
  short: "file a relationship report",
  area: "relationships",
  classification: "INSTANT",
  does: "Compiles a report from the relationship's record now (meeting summary, diligence, investment memo, closing or pass) and files it as the next version; the memo and pass report stay private to the investor.",
  input: Report,
  output: z.custom<ReportResult>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    deal(ports).generateReport({
      actor: context.actor,
      relationshipId: input.relationshipId,
      kind: input.input.kind,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: (input) => ({
    summary: `File a ${REPORT_WORDS[input.input.kind]}`,
    preview:
      "Compiled from the record as it stands; earlier versions are kept.",
  }),
  done: (out, input) =>
    out.outcome === "OK"
      ? `Filed: ${REPORT_WORDS[input.input.kind]}, version ${String(out.report.version)}. It's listed under Reports on the relationship, with its PDF.`
      : (problemOf(out)?.detail ?? "That report couldn't be filed."),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_REPORTS_PATH,
    fromRequest: (params, body, headers) => ({
      relationshipId: params["relationshipId"],
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    idempotencyKeyOf: (input) => input.idempotencyKey,
    status: (out) => (out.outcome === "OK" && out.deduplicated ? 200 : 201),
    problem: problemOf,
    notFound: (out) => out.outcome === "REFUSED" && out.code === "NOT_FOUND",
    respond: (out) =>
      out.outcome === "OK"
        ? RelationshipReportSummaryDtoSchema.parse(out.report)
        : undefined,
  },
  tool: {
    name: "relationship_report",
    description:
      'Files a report on one of their relationships from the record as it stands: MEETING_SUMMARY, DILIGENCE (asked, answered, open), INVESTMENT_MEMO (investor only, private), CLOSING (after close) or PASS (investor only, private, after a pass). Use for "make a diligence report for Tensorgate" or "file the closing report".',
    input: Named.extend({ kind: RelationshipReportKindSchema }).strict(),
    references: { relationship: "RELATIONSHIP" },
    purposes: PURPOSES,
    eval: {
      say: [
        "Make a diligence report for {name}.",
        "File an investment memo on {name}.",
      ],
      names: "RELATIONSHIP",
      orSays: "not found|other side|isn't possible",
    },
    toCanonical: (tool, context) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        idempotencyKey: context.idempotencyKey,
        input: { kind: tool.kind },
      }),
  },
});

const Tick = z
  .object({
    relationshipId: z.string().max(64),
    input: TickDealChecklistRequestSchema,
  })
  .strict();

export const CHECKLIST_ACTION = defineAppAction<
  z.infer<typeof Tick>,
  DealResult,
  z.infer<typeof Named> & { item: string }
>({
  name: "relationship.deal.checklist",
  short: "tick a close checklist item",
  area: "relationships",
  classification: "INSTANT",
  does: "Ticks one post-close onboarding item (cap table updated, update list, cadence agreed, portfolio entry) for their own side of a closed investment.",
  input: Tick,
  output: z.custom<DealResult>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    deal(ports).tick({
      actor: context.actor,
      relationshipId: input.relationshipId,
      item: input.input.item,
    }),
  targets: (input) => relationshipTarget(input.relationshipId),
  card: () => ({ summary: "Tick a checklist item", preview: "" }),
  done: (out) =>
    out.outcome === "OK"
      ? "Ticked."
      : (problemOf(out)?.detail ?? "That couldn't be ticked."),
  succeeded,
  http: {
    method: "POST",
    path: NETWORK_RELATIONSHIP_DEAL_CHECKLIST_PATH,
    fromRequest: (params, body) => ({
      relationshipId: params["relationshipId"],
      input: body,
    }),
    ...http,
  },
  tool: {
    name: "deal_checklist",
    description:
      "Ticks a post-close onboarding item on a closed investment for their own side: SIGNED_DOCS_FILED, CAP_TABLE_UPDATED, UPDATE_LIST_ADDED, UPDATE_CADENCE_AGREED, SIDE_LETTER_RIGHTS_NOTED (company); PORTFOLIO_ENTRY_CONFIRMED, REPORTING_CADENCE_SET (investor).",
    input: Named.extend({
      item: z.string().regex(/^[A-Z][A-Z_]{2,47}$/),
    }).strict(),
    references: { relationship: "RELATIONSHIP" },
    purposes: ["ACTION_PREPARATION"],
    eval: {
      say: [
        "Tick cap table updated for {name}.",
        "Mark {name} as added to our update list.",
      ],
      names: "RELATIONSHIP",
      orSays: "isn't possible|not found",
    },
    toCanonical: (tool) =>
      Promise.resolve({
        relationshipId: tool.relationship,
        input: { item: tool.item },
      }),
  },
});

const STAGE_WORDS: Readonly<Record<string, string>> = {
  MET: "met",
  DILIGENCE: "in diligence",
  SOFT_COMMIT: "soft commit confirmed",
  TERMS: "terms recorded",
  SIGNED: "terms signed",
  FUNDS_RECEIVED: "funds received",
  CLOSED: "closed",
};
const STEP_WORDS: Readonly<Record<string, string>> = {
  START_DILIGENCE: "start diligence",
  SOFT_COMMIT: "a soft commit (on the Commitment card)",
  RECORD_TERMS: "record the terms",
  MARK_SIGNED: "record the signed copy",
  SEND_FUNDS: "mark the money sent",
  CONFIRM_FUNDS: "confirm the money arrived",
  CLOSE: "close the investment",
  PASS: "decide not to proceed",
};

/** Q's answer to "where are we with X?": the record, in plain words. */
export function dealStatusSentence(view: DealViewDto): string {
  const day = (iso: string) => iso.slice(0, 10);
  if (view.end?.kind === "CLOSED") {
    const open = view.checklist.filter((item) => !item.done).length;
    return `Closed on ${day(view.end.at)}${
      view.terms === null
        ? ""
        : `: ${moneyText(view.terms.amount, view.terms.currencyCode)} on a ${view.terms.instrument.toLowerCase().replaceAll("_", " ")}`
    }. ${open === 0 ? "Onboarding is done." : `${String(open)} onboarding item(s) left.`}`;
  }
  if (view.end?.kind === "PASSED") {
    return `Not proceeding since ${day(view.end.at)}. The relationship is archived; nothing further is open.`;
  }
  const reached = view.stages.filter((stage) => stage.reachedAt !== null);
  const last = reached.at(-1);
  const where =
    last === undefined || last.reachedAt === null
      ? "No deal step is recorded yet"
      : `${STAGE_WORDS[last.stage] ?? last.stage} on ${day(last.reachedAt)}`;
  const terms =
    view.terms === null
      ? ""
      : ` Terms v${String(view.terms.version)}: ${moneyText(view.terms.amount, view.terms.currencyCode)}${view.terms.signedAt === null ? " (not signed yet)" : " (signed)"}.`;
  const next = view.nextSteps.map((step) => STEP_WORDS[step] ?? step);
  const said = `${where.charAt(0).toUpperCase()}${where.slice(1)}`;
  return `${said}.${terms}${next.length === 0 ? "" : ` Next: ${next.join(", or ")}.`}`;
}

export const DEAL_STATUS_ACTION = defineAppAction<
  { readonly relationshipId: string },
  DealViewDto | null,
  z.infer<typeof Named>
>({
  name: "relationship.deal.status",
  short: "where a deal stands",
  area: "relationships",
  classification: "READ",
  does: "Reads where an investment stands on one relationship: the stage strip, the terms, what is next, and the reports on file.",
  input: z.object({ relationshipId: z.string().max(64) }).strict(),
  output: z.custom<DealViewDto | null>(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    viewOf(ports, context.actor, input.relationshipId),
  targets: () => [],
  card: () => ({ summary: "Deal status", preview: "" }),
  done: (out) =>
    out === null ? "I can't find that relationship." : dealStatusSentence(out),
  tool: {
    name: "relationship_deal_status",
    description:
      'Reads where an investment stands on one of their relationships (the stage strip: met, diligence, soft commit, terms, signed, funds received, closed or passed), the current terms, what is next and the reports on file. Use for "where are we with Tensorgate?".',
    input: Named,
    references: { relationship: "RELATIONSHIP" },
    purposes: ["RELATIONSHIP_QUESTION"],
    eval: {
      say: ["Where are we with {name}?", "What's left to close {name}?"],
      names: "RELATIONSHIP",
    },
    toCanonical: (tool) =>
      Promise.resolve({ relationshipId: tool.relationship }),
  },
});

export const DEAL_CLOSE_ACTIONS: readonly AnyAppAction[] = [
  ...DEAL_ACTIONS,
  REPORT_ACTION,
  CHECKLIST_ACTION,
  DEAL_STATUS_ACTION,
];
