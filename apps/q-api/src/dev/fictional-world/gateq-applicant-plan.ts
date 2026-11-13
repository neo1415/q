import { founderEmail } from "./accounts.js";
import { FICTIONAL_COMPANIES } from "./companies.js";
import { FICTIONAL_ACCOUNT_DOMAIN, SeedError } from "./http.js";
import type { FictionalCompany } from "./types.js";

/**
 * A run-scoped fictional GateQ applicant (B6 audit, 2026-11-14 journey
 * map): one founder account, one company and one document the founder
 * owns, so the signed-in account-email contact path can certify the GateQ
 * applicant journey again and again. GateQ allows one application per
 * company per gateway in 180 days, so each certification run needs a
 * company that has never applied: a fresh run id gives one.
 *
 * Pure: no network, no clock. The CLI (gateq-applicant.ts) does the writes.
 */

/** Lowercase letters and digits; short enough to read in an inbox. */
export const RUN_ID = /^[a-z0-9]{4,24}$/u;

/** Only ever an account on the reserved fictional domain. */
export const FICTIONAL_EMAIL =
  /^[a-z0-9._+-]+@fictional\.capitalq\.local$/u;

export function assertRunId(runId: string): string {
  if (!RUN_ID.test(runId)) {
    throw new SeedError(
      "the run id is 4-24 lowercase letters or digits (it becomes part of an email address)",
    );
  }
  return runId;
}

export function assertFictionalEmail(email: string): string {
  if (!FICTIONAL_EMAIL.test(email)) {
    throw new SeedError(
      `refusing ${email}: only @${FICTIONAL_ACCOUNT_DOMAIN} accounts are created`,
    );
  }
  return email;
}

/** A fresh run id: base 36 from the given random source. */
export function newRunId(random: () => number = Math.random): string {
  let id = "";
  while (id.length < 8) {
    id += Math.floor(random() * 36).toString(36);
  }
  return id;
}

export type ApplicantDocument = {
  readonly title: string;
  readonly filename: string;
  readonly mimeType: "text/plain";
  readonly documentType: "COMPANY_PROFILE";
  readonly body: string;
};

export type ApplicantPlan = {
  readonly runId: string;
  readonly email: string;
  readonly company: FictionalCompany;
  readonly document: ApplicantDocument;
};

const TEMPLATE = FICTIONAL_COMPANIES[0];

/**
 * The applicant for one run. The company borrows a seeded company's
 * answers to the founder journey (stage, country, team, raise), so the
 * journey completes without inventing anything new, and gets its own
 * name, founder, website and story so it is never mistaken for that one.
 */
export function applicantPlan(runId: string): ApplicantPlan {
  assertRunId(runId);
  if (TEMPLATE === undefined) {
    throw new SeedError("the fictional world has no company to start from");
  }
  const key = `gq-${runId}`;
  const email = assertFictionalEmail(founderEmail(key));
  const name = `Gatepath Applicant ${runId.toUpperCase()}`;
  const story = (subject: string) =>
    `${subject} for ${name}, a fictional company created only to certify the GateQ applicant journey (run ${runId}). Nothing here is real.`;
  const company: FictionalCompany = {
    ...TEMPLATE,
    key,
    name,
    legalName: `${name} Ltd (fictional)`,
    // Reserved TLD: can never resolve to a real site.
    website: `https://${key}.example`,
    shortDescription: `A fictional company for GateQ certification run ${runId}. Not a real business.`,
    founder: {
      ...TEMPLATE.founder,
      displayName: `Gatepath Founder ${runId.toUpperCase()}`,
      headline: `Founder, ${name} (fictional certification account)`,
      professionalSummary: story("Professional summary"),
      backgroundSummary: story("Background"),
    },
    story: {
      problem: story("The problem statement"),
      solution: story("The solution"),
      traction: story("Traction"),
      team: story("The team"),
      market: story("The market"),
      competition: story("Competition"),
      risks: story("Risks"),
      raise: story("The raise"),
      unknowns: ["Everything: this company is fictional"],
    },
    claims: [],
    deck: [],
  };
  const document: ApplicantDocument = {
    title: `${name} one-pager (fictional)`,
    filename: `${key}-one-pager.txt`,
    mimeType: "text/plain",
    documentType: "COMPANY_PROFILE",
    body: [
      `${name} — one-pager (FICTIONAL)`,
      "",
      `Created by the GateQ certification seed, run ${runId}.`,
      "Every name and figure here is invented. Not a real company.",
      "",
      company.shortDescription,
      "",
    ].join("\n"),
  };
  return { runId, email, company, document };
}
