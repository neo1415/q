import {
  Q_COMMUNICATION_PROFILES,
  Q_DEFAULT_COMMUNICATION_PRESET,
  QCommunicationProfileSchema,
  type QCommunicationPreset,
  type QCommunicationProfile,
} from "@capital-q/contracts";

/**
 * Communication guidance rendering (CQ-Q-006 §10-§15, §45-§46).
 *
 * One bounded profile → one bounded guidance block, rendered once and
 * placed in the charter's COMMUNICATION PROFILE section. Task prompts do
 * not carry style text of their own, so changing a default, adding a
 * preset or adding a dimension is one change here. Every sentence below
 * is about presentation; none touches evidence, truth, permissions,
 * methodology or authority — the charter states that the profile is
 * subordinate, and the tests hold this text to it.
 *
 * COMMUNICATION_RENDERING_VERSION is part of the prompt bundle identity.
 */
export const COMMUNICATION_RENDERING_VERSION = 1;

const DEPTH: Readonly<Record<QCommunicationProfile["responseDepth"], string>> =
  {
    CONCISE:
      "Depth: concise. Lead with the answer; keep supporting detail to what the person needs to act; leave out background they already have. Material uncertainty, risks and missing evidence still get stated, briefly.",
    BALANCED:
      "Depth: balanced. Answer first, then the reasoning that matters, sized to the significance of the question.",
    DETAILED:
      "Depth: detailed. Show your working: evidence, alternatives, trade-offs and assumptions, still organised so the conclusion is easy to find.",
  };

const TONE: Readonly<Record<QCommunicationProfile["tone"], string>> = {
  PROFESSIONAL:
    "Register: professional and precise, warm without being casual.",
  CONVERSATIONAL:
    "Register: conversational and natural, as a trusted colleague would speak, without losing precision or institutional rigour.",
};

const CHALLENGE: Readonly<
  Record<QCommunicationProfile["challengeLevel"], string>
> = {
  SUPPORTIVE:
    "Challenge: supportive. Raise concerns constructively and frame them as what would strengthen the position; never omit a material concern.",
  BALANCED:
    "Challenge: balanced. Push back where the evidence warrants, proportionately, and acknowledge what holds up.",
  CHALLENGING:
    "Challenge: challenging. Actively test the person's assumptions against the evidence and name weaknesses directly, while staying respectful and constructive.",
};

const QUESTIONS: Readonly<
  Record<QCommunicationProfile["questionStyle"], string>
> = {
  MINIMAL:
    "Questions: minimal. Ask only when an answer is impossible without it; otherwise state your assumptions and proceed.",
  ADAPTIVE:
    "Questions: adaptive. Ask a focused question when a missing fact would change the answer; otherwise proceed and note the gap.",
  SOCRATIC:
    "Questions: exploratory. Where it helps the person reason, ask one or two thoughtful questions before or alongside your view, one topic at a time.",
};

const EXPLANATION: Readonly<
  Record<QCommunicationProfile["explanationStyle"], string>
> = {
  SUMMARY_FIRST: "Order: conclusion first, then the evidence and implications.",
  ANALYSIS_FIRST:
    "Order: walk through the evidence and reasoning, then state the conclusion.",
};

export function renderCommunicationGuidance(
  profile: QCommunicationProfile,
): string {
  const validated = QCommunicationProfileSchema.parse(profile);
  return [
    DEPTH[validated.responseDepth],
    TONE[validated.tone],
    CHALLENGE[validated.challengeLevel],
    QUESTIONS[validated.questionStyle],
    EXPLANATION[validated.explanationStyle],
  ].join("\n");
}

export function communicationProfileFor(
  preset: QCommunicationPreset,
): QCommunicationProfile {
  return Q_COMMUNICATION_PROFILES[preset];
}

export const DEFAULT_COMMUNICATION_PROFILE: QCommunicationProfile =
  Q_COMMUNICATION_PROFILES[Q_DEFAULT_COMMUNICATION_PRESET];

/**
 * Words the guidance must never contain: a profile is presentation only.
 * Held by tests over every rendered profile.
 */
export const COMMUNICATION_FORBIDDEN_TERMS = [
  "ignore uncertainty",
  "treat as fact",
  "permission",
  "authoris",
  "always agree",
  "never tell",
  "optimis",
  "hide",
] as const;
