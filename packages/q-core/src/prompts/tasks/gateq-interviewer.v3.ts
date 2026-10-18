import { z } from "zod";
import type { PromptDefinition } from "../definition.js";
import {
  GateQInterviewerVariablesSchema,
  type GateQInterviewerResult,
  type GateQInterviewerVariables,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V2 } from "./gateq-interviewer.v2.js";

/** The inventory comes from intake's canonical contract, not question priority. */
export const GATEQ_INTERVIEWER_V3: PromptDefinition<
  GateQInterviewerVariables & { readonly recordableDimensions: string },
  GateQInterviewerResult
> = {
  ...GATEQ_INTERVIEWER_V2,
  version: 3,
  effectiveFrom: "2026-10-14",
  changeDescription:
    "Capture every stated supported application claim independently of the next-question priorities; preserve typed qualification and evidence authority.",
  variables: {
    ...GATEQ_INTERVIEWER_V2.variables,
    schema: GateQInterviewerVariablesSchema.extend({
      recordableDimensions: z.string().min(1).max(2000),
    }),
  },
  template: GATEQ_INTERVIEWER_V2.template
    .replace(
      "Only dimensions that appear in KNOWN FACTS or QUESTION NEEDS.",
      "Use only RECORDABLE DIMENSIONS below. QUESTION NEEDS prioritizes what to ask next; it does not restrict which supported claims you may capture. Record stated traction, revenue, business model and use of funds even when another topic is the next question. Do not invent a value merely because a dimension is available.",
    )
    .replace(
      "QUESTION NEEDS (trusted; most useful first)\n{{questionNeeds}}",
      "RECORDABLE DIMENSIONS (trusted; names only, not evidence or investor requirements)\n{{recordableDimensions}}\nQUESTION NEEDS (trusted; next-question priorities, most useful first)\n{{questionNeeds}}",
    ),
};
