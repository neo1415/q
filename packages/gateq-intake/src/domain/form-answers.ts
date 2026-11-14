import {
  ApplicationAnswersRequestSchema,
  GATEQ_DECLINED,
  type ApplicationAnswersRequest,
} from "@capital-q/contracts";

import type { NewApplicationFact } from "../contracts/index.js";
import type {
  ApplicationStatementView,
  DimensionViewItem,
} from "../contracts/statements.js";

/**
 * The GateQ form's answers as application facts (F1, 2026-10-06).
 *
 * The form replaces the conversation as the way a founder tells a gateway
 * about themselves; it does not replace how the answer is decided. Every
 * answer becomes the same bounded, provenance-carrying fact a conversation
 * turn would have recorded, and GATE-001's engine then judges the
 * application under its frozen policy exactly as before.
 *
 * Two rules carry the weight:
 *
 * - **"I'd rather not say" is an answer.** It is recorded as UNKNOWN with
 *   no value (marked declined, apart from "don't know"), so the rule it feeds reads UNKNOWN (never a no) and the
 *   history shows the founder was asked.
 * - **A field left out is untouched.** Answers arrive a step at a time, and
 *   step two must not erase step one.
 *
 * Pure: no store, no clock, no model.
 */
export function factsFromAnswers(
  answers: ApplicationAnswersRequest,
): NewApplicationFact[] {
  const facts: NewApplicationFact[] = [];
  const given = (fact: NewApplicationFact) => facts.push(fact);
  const declined = (dimension: NewApplicationFact["dimension"]) =>
    facts.push({
      dimension,
      value: { kind: "NONE", declined: true },
      provenance: "UNKNOWN",
    });
  const text = (dimension: NewApplicationFact["dimension"], value: string) =>
    given({
      dimension,
      value: { kind: "TEXT", text: value },
      provenance: "APPLICANT_PROVIDED",
    });
  const code = (dimension: NewApplicationFact["dimension"], value: string) =>
    given({
      dimension,
      value: { kind: "CODE", code: value },
      provenance: "APPLICANT_PROVIDED",
    });

  if (answers.companyName !== undefined) {
    text("company.name", answers.companyName);
  }
  if (answers.oneLiner !== undefined) {
    text("company.description", answers.oneLiner);
  }
  if (answers.website !== undefined) text("company.website", answers.website);
  if (answers.contactName !== undefined) {
    text("contact.name", answers.contactName);
  }
  if (answers.contactEmail !== undefined) {
    text("contact.email", answers.contactEmail);
  }

  if (answers.stage === GATEQ_DECLINED) declined("company.stage");
  else if (answers.stage !== undefined) code("company.stage", answers.stage);

  if (answers.country === GATEQ_DECLINED) declined("company.country");
  else if (answers.country !== undefined) {
    code("company.country", answers.country);
  }

  if (answers.sectors === GATEQ_DECLINED) declined("company.sector_phrases");
  else if (answers.sectors !== undefined) {
    // Words, not classifications: the taxonomy resolver decides what they
    // mean, and an ambiguous word leaves the sector rule UNKNOWN.
    given({
      dimension: "company.sector_phrases",
      value: { kind: "PHRASES", phrases: [...new Set(answers.sectors)] },
      provenance: "APPLICANT_PROVIDED",
    });
  }

  if (answers.raise === GATEQ_DECLINED) {
    declined("raise.amount");
    declined("raise.currency");
  } else if (answers.raise !== undefined) {
    // Money is a decimal string with its own currency; never a float.
    given({
      dimension: "raise.amount",
      value: {
        kind: "AMOUNT",
        amount: answers.raise.amount,
        currency: answers.raise.currency,
      },
      provenance: "APPLICANT_PROVIDED",
    });
    code("raise.currency", answers.raise.currency);
  }

  if (answers.instrument === GATEQ_DECLINED) declined("raise.instrument");
  else if (answers.instrument !== undefined) {
    code("raise.instrument", answers.instrument);
  }

  if (answers.lead === GATEQ_DECLINED) declined("raise.lead_status");
  else if (answers.lead !== undefined) code("raise.lead_status", answers.lead);

  if (answers.note !== undefined && answers.note !== "") {
    text("application.note", answers.note);
  }
  return facts;
}

/**
 * The form's answers as they stand on record, from the one statement view
 * (live 2026-11-14): a resumed form shows what the application holds, not
 * a blank or profile-prefilled form whose save would overwrite it. Per
 * field, the latest current form answer, else the latest current answer of
 * the field's shape; a field with nothing usable is left out (the founder
 * fills it). Read only: showing these writes nothing, and saving them
 * unchanged writes nothing either (`formStatementPlan`).
 */
export function answersFromView(
  view: ApplicationStatementView,
): ApplicationAnswersRequest {
  const shape = ApplicationAnswersRequestSchema.shape;
  const itemsOf = (dimension: string): readonly DimensionViewItem[] =>
    view.dimensions.find((d) => d.dimension === dimension)?.items ?? [];
  const formLike = (item: DimensionViewItem) =>
    item.origin === "FORM" || item.origin === "BACKFILL";
  const pick = (
    dimension: string,
    usable: (item: DimensionViewItem) => boolean,
  ): DimensionViewItem | undefined => {
    const items = itemsOf(dimension).filter(usable);
    return items.filter(formLike).at(-1) ?? items.at(-1);
  };
  // Only "rather not say" with nothing held beside it reads as declined.
  const declined = (dimension: string) => {
    const items = itemsOf(dimension);
    return (
      items.length > 0 &&
      items.every((i) => i.value.kind === "UNKNOWN") &&
      items.some((i) => i.value.kind === "UNKNOWN" && i.value.declined === true)
    );
  };
  const valid = <K extends keyof ApplicationAnswersRequest>(
    key: K,
    value: unknown,
  ): Partial<ApplicationAnswersRequest> => {
    if (value === undefined) return {};
    const parsed = shape[key].safeParse(value);
    return parsed.success && parsed.data !== undefined
      ? { [key]: parsed.data }
      : {};
  };
  const text = (dimension: string): string | undefined => {
    const item = pick(dimension, (i) => i.value.kind === "TEXT");
    return item?.value.kind === "TEXT" ? item.value.text : undefined;
  };
  const code = (dimension: string): string | undefined => {
    if (declined(dimension)) return GATEQ_DECLINED;
    const item = pick(dimension, (i) => i.value.kind === "CODE");
    return item?.value.kind === "CODE" ? item.value.code : undefined;
  };
  const sectors = (): readonly string[] | typeof GATEQ_DECLINED | undefined => {
    if (declined("company.sector_phrases")) return GATEQ_DECLINED;
    const items = itemsOf("company.sector_phrases").filter(
      (i) => i.value.kind === "TEXT",
    );
    const form = items.filter(formLike);
    const chosen = (form.length > 0 ? form : items).flatMap((i) =>
      i.value.kind === "TEXT" ? [i.value.text] : [],
    );
    return chosen.length === 0 ? undefined : [...new Set(chosen)].slice(0, 6);
  };
  const raise = ():
    | { readonly amount: string; readonly currency: string }
    | typeof GATEQ_DECLINED
    | undefined => {
    if (declined("raise.amount")) return GATEQ_DECLINED;
    const item = pick(
      "raise.amount",
      (i) =>
        (i.value.kind === "MONEY" && i.value.currency !== null) ||
        (i.value.kind === "ZERO" && i.value.currency !== undefined),
    );
    if (item?.value.kind === "MONEY" && item.value.currency !== null)
      return { amount: item.value.amount, currency: item.value.currency };
    if (item?.value.kind === "ZERO" && item.value.currency !== undefined)
      return { amount: "0", currency: item.value.currency };
    return undefined;
  };
  return {
    ...valid("companyName", text("company.name")),
    ...valid("oneLiner", text("company.description")),
    ...valid("website", text("company.website")),
    ...valid("stage", code("company.stage")),
    ...valid("sectors", sectors()),
    ...valid("country", code("company.country")),
    ...valid("raise", raise()),
    ...valid("instrument", code("raise.instrument")),
    ...valid("lead", code("raise.lead_status")),
    ...valid("note", text("application.note")),
    ...valid("contactName", text("contact.name")),
    ...valid("contactEmail", text("contact.email")),
  };
}
