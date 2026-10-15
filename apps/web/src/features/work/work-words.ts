import type { QWorkDto } from "@capital-q/contracts";

/**
 * Q's work in words (AUTO; spec auto.md §3.4), shared by the Work page and
 * a CRM record's Q Work section, so both say the same thing. A plain
 * module: no client hooks, reachable from Server Components.
 */

type Lane = QWorkDto["lanes"][number];

export const STAGE_WORDS: Readonly<Record<Lane["stage"], string>> = {
  SHORTLISTED: "Picked",
  WAITING_ACCEPTANCE: "Waiting for them to accept",
  CHATTING: "Talking with them",
  INTERVIEWING: "First-stage interview",
  REPORT_READY: "Report ready",
  NEEDS_TIMES: "Needs your time",
  CALL_BOOKED: "Call booked",
  STANDING_IN: "Q answered while you were away",
  DECLINED: "They declined",
  DONE: "Done",
  STOPPED: "Stopped",
  FAILED: "Couldn't continue",
};

export const WORK_KIND_LABELS: Readonly<Record<QWorkDto["kind"], string>> = {
  INVESTOR_OUTREACH: "Outreach",
  FOUNDER_STAND_IN: "Stand-in",
  STANDING_INSTRUCTION: "Standing instruction",
};

export const STATUS_WORDS: Readonly<Record<QWorkDto["status"], string>> = {
  ACTIVE: "Running",
  DONE: "Finished",
  STOPPED: "Stopped",
  FAILED: "Couldn't finish",
  EXPIRED: "Time's up",
};

export const VERDICT = {
  PROCEED: "Q suggests you proceed",
  MAYBE: "Q is unsure",
  PASS: "Q suggests you pass",
} as const;
