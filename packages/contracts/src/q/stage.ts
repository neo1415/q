import { z } from "zod";

/**
 * The small approved vocabulary of progress a person may see while Q works
 * (doc 12 §2.10, §9.2, §37.1, §69.1; doc 17 §13; TM-Q-12).
 *
 * This is NOT the run's machine status. QRunStatus says where the runtime is;
 * a visible stage says what the person is told, and the mapping between them
 * is many-to-one and chosen by the orchestrator, never by a model. There is
 * no free-text stage, no "thinking..." string a model can fill in, and no
 * stage that names a specialist, a graph node or a prompt. If a run needs to
 * tell the person something this vocabulary cannot say, the answer is a new
 * approved member here, reviewed -- not a text field.
 *
 * Wire values are stable machine identifiers. The words a person reads come
 * from Q_VISIBLE_STAGE_LABELS and may be reworded without a contract change.
 */
export const Q_VISIBLE_STAGES = [
  "UNDERSTANDING_REQUEST",
  "REVIEWING_COMPANY",
  "CHECKING_EVIDENCE",
  "SEARCHING_PUBLIC_SOURCES",
  "REVIEWING_INVESTOR_CRITERIA",
  "COMPARING_OPPORTUNITIES",
  "REVIEWING_RELATIONSHIP",
  "PREPARING_ANALYSIS",
  "PREPARING_DOCUMENT",
  "REVISING_DOCUMENT",
  // Q room W5 (R8): the document pipeline's own stages, so the silence
  // ladder can say what is happening while a deck is made.
  "DESIGNING_DOCUMENT",
  "FINDING_DOCUMENT_IMAGES",
  "CHECKING_DOCUMENT",
  "WAITING_FOR_REPLY",
  "WAITING_FOR_APPROVAL",
  "COMPLETING_APPROVED_ACTION",
  // Situation-first planning (owner 2026-10-28): a plan's own stages.
  // Public sources are checked under SEARCHING_PUBLIC_SOURCES ("Looking
  // into it", R38: no search theatre), so it has no planning twin.
  "GATHERING_SITUATION",
  "READING_DOCUMENTS",
  "DRAFTING_PLAN",
  "REVIEWING_PLAN",
] as const;

export type QVisibleStage = (typeof Q_VISIBLE_STAGES)[number];

export const QVisibleStageSchema = z.enum(Q_VISIBLE_STAGES);

/**
 * Plain-English labels (doc 12 §9.2). Short, calm, specific, non-technical.
 * A UI renders these; it never renders the enum value.
 */
export const Q_VISIBLE_STAGE_LABELS: Readonly<Record<QVisibleStage, string>> = {
  UNDERSTANDING_REQUEST: "Understanding your request",
  // Owner 2026-10-20 (artifacts live): Q says where it is, the way a
  // colleague would ("reading their deck", "comparing the two"). Web
  // research stays neutral (R38, no search theatre): "Looking into it",
  // then Sources.
  REVIEWING_COMPANY: "Looking at the company",
  // The deck, data room and document reads (q-tools) show this stage.
  CHECKING_EVIDENCE: "Reading their deck and documents",
  SEARCHING_PUBLIC_SOURCES: "Looking into it",
  REVIEWING_INVESTOR_CRITERIA: "Reading the investor's mandate",
  COMPARING_OPPORTUNITIES: "Comparing them side by side",
  REVIEWING_RELATIONSHIP: "Checking where things stand",
  PREPARING_ANALYSIS: "Pulling it together",
  // Founder live 2026-09-29: a document takes a while; say so and to wait.
  PREPARING_DOCUMENT: "Writing your document. This takes a moment.",
  REVISING_DOCUMENT: "Making your changes to the document. One moment.",
  DESIGNING_DOCUMENT: "Laying out each page",
  FINDING_DOCUMENT_IMAGES: "Finding pictures and drawing your charts",
  CHECKING_DOCUMENT: "Checking every page",
  WAITING_FOR_REPLY: "Waiting for your reply",
  WAITING_FOR_APPROVAL: "Waiting for your approval",
  COMPLETING_APPROVED_ACTION: "Completing the approved action",
  GATHERING_SITUATION: "Gathering your situation",
  READING_DOCUMENTS: "Reading your documents",
  DRAFTING_PLAN: "Drafting the plan",
  REVIEWING_PLAN: "Reviewing the plan",
};

export function qVisibleStageLabel(stage: QVisibleStage): string {
  return Q_VISIBLE_STAGE_LABELS[stage];
}

/**
 * Round 4 (owner 2026-10-21, ux-direction §5.1 and §6.1): what a stage is
 * about, so the one live line can say "Looking at Nixo" rather than "the
 * company", and a durable task can say "Deck for Nixo · 2 of 4".
 *
 * `subjects` are display names from this run's own authorised reads (never
 * a model's words, never a person's typed text), at most three. `task` is
 * set only by a durable pipeline whose steps are fixed, so `step` of `of`
 * is that pipeline's real count, never an estimate. Both optional; a stage
 * without them reads its approved label. Web research is never "about"
 * anything (R38): it says "Looking into it".
 */
export const Q_STAGE_SUBJECTS_MAX = 3;
export const Q_STAGE_TASK_KINDS = [
  "INVESTMENT_BRIEF",
  "PITCH_DECK",
  "ONE_PAGER",
  "MEMO",
] as const;
export type QStageTaskKind = (typeof Q_STAGE_TASK_KINDS)[number];

export const QStageAboutSchema = z
  .object({
    subjects: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(Q_STAGE_SUBJECTS_MAX)
      .optional(),
    task: z
      .object({
        kind: z.enum(Q_STAGE_TASK_KINDS),
        step: z.number().int().min(1).max(12).optional(),
        of: z.number().int().min(1).max(12).optional(),
      })
      .strict()
      .refine(
        (task) =>
          (task.step === undefined) === (task.of === undefined) &&
          (task.step === undefined ||
            task.of === undefined ||
            task.step <= task.of),
        { message: "a step needs its total, and is never past it" },
      )
      .optional(),
  })
  .strict();
export type QStageAbout = z.infer<typeof QStageAboutSchema>;
