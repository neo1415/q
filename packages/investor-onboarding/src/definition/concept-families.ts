import { INVESTOR_STEPS } from "./investor-v1.js";

/**
 * Steps that ask about one concept in more than one way (journey data; G,
 * "one concept, one answer"). Once the person has answered or declined any
 * of them, the concept is settled: the others are there for them to add
 * to, never a question Q asks again (ACC 2026-09-25: after gambling was
 * recorded, Q asked whether any sectors should be excluded outright).
 */
export type ConceptFamily = {
  readonly concept: string;
  readonly stepKeys: readonly string[];
};

export const INVESTOR_CONCEPT_FAMILIES: readonly ConceptFamily[] = [
  {
    concept: "what they do not want to see",
    stepKeys: [
      INVESTOR_STEPS.sectorsAvoid,
      INVESTOR_STEPS.avoid,
      INVESTOR_STEPS.hardExclusions,
      INVESTOR_STEPS.sectorExclusions,
    ],
  },
];
