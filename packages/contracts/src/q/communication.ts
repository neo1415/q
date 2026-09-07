import { z } from "zod";

/**
 * Bounded communication configuration (Product Specification 2.5-2.6,
 * §Q Controls; PADL Decisions 43 and 85; CQ-Q-006 §10-§15).
 *
 * A profile changes how Q PRESENTS an answer: depth, register, how hard
 * it pushes back, how it asks, what comes first. It cannot change what Q
 * believes, what evidence means, what Q may access, its methodology, its
 * uncertainty requirements, or who holds commercial authority. That is
 * why it is a closed set of enumerations and nothing else: there is no
 * free-text instruction, no "systemPrompt", and no value outside these
 * lists is representable at all. The renderer turns a profile into a
 * bounded guidance block; the Q charter always outranks it.
 *
 * Future user settings produce one of these objects through validation and
 * hand it to the renderer. Storage belongs to the user/settings context,
 * never to the prompt registry.
 */

export const Q_RESPONSE_DEPTHS = ["CONCISE", "BALANCED", "DETAILED"] as const;
export const QResponseDepthSchema = z.enum(Q_RESPONSE_DEPTHS);
export type QResponseDepth = z.infer<typeof QResponseDepthSchema>;

export const Q_TONES = ["PROFESSIONAL", "CONVERSATIONAL"] as const;
export const QToneSchema = z.enum(Q_TONES);
export type QTone = z.infer<typeof QToneSchema>;

export const Q_CHALLENGE_LEVELS = [
  "SUPPORTIVE",
  "BALANCED",
  "CHALLENGING",
] as const;
export const QChallengeLevelSchema = z.enum(Q_CHALLENGE_LEVELS);
export type QChallengeLevel = z.infer<typeof QChallengeLevelSchema>;

export const Q_QUESTION_STYLES = ["MINIMAL", "ADAPTIVE", "SOCRATIC"] as const;
export const QQuestionStyleSchema = z.enum(Q_QUESTION_STYLES);
export type QQuestionStyle = z.infer<typeof QQuestionStyleSchema>;

export const Q_EXPLANATION_STYLES = [
  "SUMMARY_FIRST",
  "ANALYSIS_FIRST",
] as const;
export const QExplanationStyleSchema = z.enum(Q_EXPLANATION_STYLES);
export type QExplanationStyle = z.infer<typeof QExplanationStyleSchema>;

export const QCommunicationProfileSchema = z
  .object({
    responseDepth: QResponseDepthSchema,
    tone: QToneSchema,
    challengeLevel: QChallengeLevelSchema,
    questionStyle: QQuestionStyleSchema,
    explanationStyle: QExplanationStyleSchema,
  })
  .strict();
export type QCommunicationProfile = z.infer<typeof QCommunicationProfileSchema>;

/** Named presentation presets. Presets, not personalities: each is just a profile. */
export const Q_COMMUNICATION_PRESETS = [
  "BALANCED",
  "DIRECT",
  "ANALYTICAL",
  "COACHING",
] as const;
export const QCommunicationPresetSchema = z.enum(Q_COMMUNICATION_PRESETS);
export type QCommunicationPreset = z.infer<typeof QCommunicationPresetSchema>;

export const Q_COMMUNICATION_PROFILES: Readonly<
  Record<QCommunicationPreset, QCommunicationProfile>
> = {
  BALANCED: {
    responseDepth: "BALANCED",
    tone: "PROFESSIONAL",
    challengeLevel: "BALANCED",
    questionStyle: "ADAPTIVE",
    explanationStyle: "SUMMARY_FIRST",
  },
  DIRECT: {
    responseDepth: "CONCISE",
    tone: "PROFESSIONAL",
    challengeLevel: "BALANCED",
    questionStyle: "MINIMAL",
    explanationStyle: "SUMMARY_FIRST",
  },
  ANALYTICAL: {
    responseDepth: "DETAILED",
    tone: "PROFESSIONAL",
    challengeLevel: "CHALLENGING",
    questionStyle: "ADAPTIVE",
    explanationStyle: "ANALYSIS_FIRST",
  },
  COACHING: {
    responseDepth: "BALANCED",
    tone: "CONVERSATIONAL",
    challengeLevel: "SUPPORTIVE",
    questionStyle: "SOCRATIC",
    explanationStyle: "SUMMARY_FIRST",
  },
};

export const Q_DEFAULT_COMMUNICATION_PRESET: QCommunicationPreset = "BALANCED";

/**
 * Q's operating modes (Product Specification 2.8; PADL Decision 12). The
 * mode governs WHAT KIND OF WORK Q is doing — above all whether coaching
 * is permitted. During ASSESSMENT Q understands and records; advice,
 * improvement guidance and debriefing belong to DEBRIEF. This is a
 * workflow concept, distinct from the communication profile (presentation)
 * and from proactivity (attention).
 */
export const Q_OPERATING_MODES = [
  "ASSESSMENT",
  "DEBRIEF",
  "INVESTOR",
  "CONTINUOUS_INTELLIGENCE",
] as const;
export const QOperatingModeSchema = z.enum(Q_OPERATING_MODES);
export type QOperatingMode = z.infer<typeof QOperatingModeSchema>;

/**
 * Q's proactivity modes (PADL Decision 84): how much Q may interrupt.
 * Recorded here as the product's vocabulary; no runtime in this packet
 * interrupts anyone, and no prompt reads it yet.
 */
export const Q_PROACTIVITY_MODES = ["FOCUS", "STANDARD", "PROACTIVE"] as const;
export const QProactivityModeSchema = z.enum(Q_PROACTIVITY_MODES);
export type QProactivityMode = z.infer<typeof QProactivityModeSchema>;
