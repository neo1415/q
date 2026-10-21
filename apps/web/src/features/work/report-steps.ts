import type { QWorkReportDto } from "@capital-q/contracts";

import { bestMatch } from "@/features/rehearsal/review-moments";

/**
 * The first-stage report's prepared next steps (chosen design 2026-10-21,
 * option 3, warm charcoal): three ways forward, each drafted by code from
 * the report's own words, shown word for word, and sent only on the
 * person's yes. Q's recommendation decides which is offered first; it
 * never decides for them.
 */

export type ReportStep = "CALL" | "QUESTIONS" | "PASS";

export const STEP_WORDS: Readonly<
  Record<
    ReportStep,
    { readonly title: string; readonly sheet: string; readonly why: string }
  >
> = {
  CALL: {
    title: "Ask for a call",
    sheet: "Ask them for a call with you",
    why: "Pick up what is still open with the founder directly.",
  },
  QUESTIONS: {
    title: "Send the open questions",
    sheet: "Send them the open questions",
    why: "Written questions before any call.",
  },
  PASS: {
    title: "Pass, politely",
    sheet: "Pass, politely",
    why: "A short, kind no. Q stops working this one.",
  },
};

/** Q's recommended step first: proceed is a call, unsure is questions. */
export function stepOrder(
  recommendation: QWorkReportDto["recommendation"],
): readonly ReportStep[] {
  switch (recommendation) {
    case "PROCEED":
      return ["CALL", "QUESTIONS", "PASS"];
    case "MAYBE":
      return ["QUESTIONS", "CALL", "PASS"];
    case "PASS":
      return ["PASS", "QUESTIONS", "CALL"];
  }
}

/** A finding's first letter lowered, to sit inside a sentence. */
function inline(point: string): string {
  const trimmed = point.trim().replace(/[.!?]+$/u, "");
  return trimmed.length > 1 && /^[A-Z][a-z]/u.test(trimmed)
    ? `${trimmed[0]?.toLowerCase() ?? ""}${trimmed.slice(1)}`
    : trimmed;
}

/** What the step would send, word for word, before any edit. */
export function draftFor(step: ReportStep, report: QWorkReportDto): string {
  switch (step) {
    case "CALL": {
      const open = report.concerns
        .slice(0, 2)
        .map((item) => inline(item.point));
      const topic =
        open.length === 0
          ? "a few points"
          : open.length === 1
            ? (open[0] ?? "")
            : `${open[0] ?? ""}, and ${open[1] ?? ""}`;
      return `Hi, thank you for the conversation with Q. I’d like to pick up ${topic} with you directly. Would 30 minutes next week work?`;
    }
    case "QUESTIONS": {
      const lines = report.openQuestions.map(
        (question, index) => `${String(index + 1)}. ${question.trim()}`,
      );
      return `Hi, thank you for the conversation with Q. ${
        lines.length === 1 ? "One question" : "A few questions"
      } before we talk:\n\n${lines.join("\n")}`;
    }
    case "PASS":
      return "Hi, thank you for the time with Q. It isn’t the right fit for us at this stage, and we’d be glad to hear how the next year goes.";
  }
}

/** Why a step cannot be prepared from this report, or null when it can. */
export function stepBlocked(
  step: ReportStep,
  report: QWorkReportDto,
): string | null {
  if (report.relationshipId === null) {
    return "There is no conversation with them yet, so nothing can be sent.";
  }
  if (step === "QUESTIONS" && report.openQuestions.length === 0) {
    return "This report has no open questions to send.";
  }
  return null;
}

export type FindingRow = {
  readonly kind: "Strength" | "Concern";
  readonly point: string;
  readonly basis: "CLAIM" | "INFERENCE";
  /** Where it was said, or how Q came to it, in words. */
  readonly where: string;
};

/**
 * Each finding with what it rests on and where. A claim is located at the
 * interview answer that shares most of its words (by code); an inference
 * says it is Q's reading. Nothing is located that cannot be.
 */
export function findingRows(report: QWorkReportDto): readonly FindingRow[] {
  const answers = report.interview.map((item) => item.answer);
  const where = (point: string, basis: "CLAIM" | "INFERENCE") => {
    const at = bestMatch(point, answers);
    if (basis === "INFERENCE") {
      return at === null
        ? "Q’s reading of the whole interview"
        : `Q’s reading, mainly of answer ${String(at + 1)}`;
    }
    if (at === null) return "Said in the interview";
    return report.interview[at]?.byQ === true
      ? `Answer ${String(at + 1)}, given by their Q from their brief`
      : `Said in answer ${String(at + 1)}`;
  };
  return [
    ...report.strengths.map((item) => ({
      kind: "Strength" as const,
      point: item.point,
      basis: item.basis,
      where: where(item.point, item.basis),
    })),
    ...report.concerns.map((item) => ({
      kind: "Concern" as const,
      point: item.point,
      basis: item.basis,
      where: where(item.point, item.basis),
    })),
  ];
}
