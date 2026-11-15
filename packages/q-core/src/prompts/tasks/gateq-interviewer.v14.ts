import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResultV3,
  GateQInterviewerVariablesV7,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V13 } from "./gateq-interviewer.v13.js";

/**
 * GATEQ_INTERVIEWER v14: a count of customers in the founder's own noun,
 * and no figure read as nothing (live re-certification 84ac9afa7,
 * Storeelle, audits/2026-11-15-gateq-metric-capture.md).
 *
 * In the ninth run "500 weekly active shops" and "about 1,300 weekly active
 * shops" were each read with no metric (the listed unit is "weekly active
 * user", and v10 told the reader to give a different noun no quantity), so
 * the two figures were never compared. v14 says a customer or user metric
 * holds the founder's own noun for who the customers are: quantity
 * weekly_active_users, unit "weekly active shop". A count of something
 * that is not a customer (patient records, crates) still has none.
 *
 * "Actually, CAC is about $12 per shop." was read as nothing at all. v14
 * says a figure they state is always a statement, with that very example.
 * The platform also keeps a figure no reading took up as their note, and
 * never lets a reply call it an update.
 *
 * Same variables and output schema as v13.
 */
const swaps: readonly (readonly [string, string])[] = [
  [
    'When it counts something else, their own noun in the singular and quantity null: "2,300 patient records digitised" is unit "patient record", quantity null, never customers or users.',
    'A customer or user metric (customers, paying_customers, users, daily_active_users, weekly_active_users, monthly_active_users) also counts the company\'s customers in their own noun: "500 weekly active shops" is quantity weekly_active_users, unit "weekly active shop"; "12 paying clinics" is quantity paying_customers, unit "paying clinic". When it counts something that is not a customer or user, their own noun in the singular and quantity null: "2,300 patient records digitised" is unit "patient record", quantity null, never customers or users.',
  ],
  [
    'CAC is on the list: "we don\'t know our CAC yet" carries quantity cac.',
    'CAC is on the list: "we don\'t know our CAC yet" carries quantity cac. A figure they state is always a statement, never nothing, also when it updates something they said earlier: "Actually, CAC is about $12 per shop." is MONEY 12 USD on company.business_model, quantity cac, unit "$".',
  ],
];
let template = GATEQ_INTERVIEWER_V13.template;
for (const [from, to] of swaps) {
  if (!template.includes(from))
    throw new Error(`GATEQ_INTERVIEWER_V14: anchor moved: ${from}`);
  template = template.replace(from, to);
}

export const GATEQ_INTERVIEWER_V14: PromptDefinition<
  GateQInterviewerVariablesV7,
  GateQInterviewerResultV3
> = {
  ...GATEQ_INTERVIEWER_V13,
  version: 14,
  effectiveFrom: "2026-11-15",
  changeDescription:
    'A customer or user metric holds the founder\'s own customer noun ("500 weekly active shops" is weekly_active_users, unit "weekly active shop"); a figure they state is always a statement, never nothing ("Actually, CAC is about $12 per shop." is MONEY 12 USD, quantity cac).',
  template,
};
