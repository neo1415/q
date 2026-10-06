import {
  GATEQ_DECLINED,
  type ApplicationAnswersRequest,
} from "@capital-q/contracts";

import type { NewApplicationFact } from "../contracts/index.js";

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
 *   no value, so the rule it feeds reads UNKNOWN (never a no) and the
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
    facts.push({ dimension, value: { kind: "NONE" }, provenance: "UNKNOWN" });
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
