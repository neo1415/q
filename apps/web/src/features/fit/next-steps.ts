import type { RelationshipStateV2 } from "@capital-q/contracts";

/**
 * The few next steps Q's view should offer, from the relationship as it
 * stands.
 *
 * Executive review 2026-10-17: Q's view named the right open questions but
 * left the investor to work out what to do with them. These turn the
 * questions into the next action the relationship actually allows. Every
 * consequential one is a request for Q to *prepare* the existing action
 * (diligence questions, a document request, a meeting) for the investor's
 * approval; nothing here sends anything. Express interest and Pass already
 * sit in the page header, so they are never repeated here, and a closed
 * relationship offers nothing to do.
 */
export type NextStep =
  | { readonly kind: "ASK"; readonly label: string; readonly ask: string }
  | { readonly kind: "LINK"; readonly label: string; readonly href: string };

const MAX_STEPS = 3;

function numbered(questions: readonly string[]): string {
  return questions.map((q, i) => `${String(i + 1)}. ${q}`).join(" ");
}

export function nextStepsFor(input: {
  readonly name: string;
  readonly companyId: string;
  readonly state: RelationshipStateV2 | null;
  readonly questions: readonly string[];
}): readonly NextStep[] {
  const { name, state } = input;
  const questions = input.questions.slice(0, 3);
  const asked = questions.length > 0;
  // Asked as a question to answer here: live 2026-10-17, "Draft the
  // questions..." sent Q to the send-questions action, which an unconnected
  // company refuses, so the investor got a refusal instead of the draft.
  const draft: NextStep = {
    kind: "ASK",
    label: "Draft questions for the founder",
    ask: asked
      ? `What questions should I put to ${name}'s founder? Start from: ${numbered(questions)} Write them out here for me to review; nothing goes to the founder.`
      : `What questions should I put to ${name}'s founder, from the evidence I can see? Write them out here for me to review; nothing goes to the founder.`,
  };
  const send: NextStep = {
    kind: "ASK",
    label: "Send these questions to the founder",
    ask: `Prepare a diligence question request to ${name} with these questions, for my approval: ${numbered(questions)}`,
  };
  const documents: NextStep = {
    kind: "ASK",
    label: "Request the documents that would answer them",
    ask: asked
      ? `Prepare a document request to ${name} for the documents that would answer these questions, for my approval: ${numbered(questions)}`
      : `Prepare a document request to ${name} for what I still need to assess them, for my approval.`,
  };
  const call: NextStep = {
    kind: "ASK",
    label: "Book a first call",
    ask: `Prepare a first call with ${name}'s founder for my approval, with times that suit us both this week.`,
  };
  const diligence: NextStep = {
    kind: "LINK",
    label: "Open diligence",
    href: `/company/${encodeURIComponent(input.companyId)}?tab=diligence`,
  };

  const steps: NextStep[] = (() => {
    switch (state) {
      case null:
      case "DISCOVERED":
      case "INTEREST_EXPRESSED":
        // Not yet connected: nothing can be sent to the founder, but the
        // thinking can start.
        return [draft];
      case "CONNECTED":
        return asked ? [call, send, documents] : [call, documents];
      case "MEETING_HELD":
      case "PAUSED":
        return asked ? [send, documents] : [documents];
      case "IN_DILIGENCE":
        return asked ? [send, documents, diligence] : [documents, diligence];
      case "DECLINED":
      case "PASSED":
      case "INVESTED":
        return [];
    }
  })();
  return steps.slice(0, MAX_STEPS);
}
