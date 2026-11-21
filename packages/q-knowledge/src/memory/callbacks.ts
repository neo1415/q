import type { QSubjectRef } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { MemoryItem } from "./contracts.js";
import { memoryTruthClass } from "./provenance.js";

/**
 * HQ-7 (conversation audit slice 7): what Q may call back to, at most once
 * an answer ("you mentioned you'd rather see seed rounds"). Only what the
 * person themselves said or confirmed (truth class USER_CLAIM), only a
 * fact, preference or correction, never Q's own reading of their words,
 * and only from the memory bundle this run already recalled under its
 * plan: the person's own items, in this tenant, owned by this person.
 * An item about a company or an investor organisation is called back only
 * when this run is about that same subject, so what they said while acting
 * for one organisation never surfaces in another's conversation.
 */
export type MemoryCallbackCandidate = {
  readonly memoryType: "fact" | "preference" | "correction";
  /** What they said, as remembered: the answer paraphrases it. */
  readonly content: string;
  /** Their own words, when kept: a callback never copies them. */
  readonly quote: string | null;
};

export const CALLBACK_CANDIDATES_MAX = 5;

const isCallbackType = (
  type: MemoryItem["memoryType"],
): type is MemoryCallbackCandidate["memoryType"] =>
  type === "fact" || type === "preference" || type === "correction";

const LIVE: ReadonlySet<MemoryItem["status"]> = new Set([
  "active",
  "confirmed",
]);

function subjectInRun(
  subject: MemoryItem["subject"],
  subjects: readonly QSubjectRef[],
): boolean {
  if (subject === null) return true;
  return subjects.some((one) =>
    subject.subjectType === "COMPANY"
      ? one.kind === "COMPANY" && one.companyId === subject.subjectId
      : subject.subjectType === "INVESTOR_ORGANISATION"
        ? one.kind === "INVESTOR_ORGANISATION" &&
          one.investorOrganisationId === subject.subjectId
        : false,
  );
}

export function callbackCandidates(
  items: readonly MemoryItem[],
  scope: {
    readonly actor: Pick<ActorContext, "tenantId" | "userId">;
    readonly subjects: readonly QSubjectRef[];
  },
): readonly MemoryCallbackCandidate[] {
  const out: MemoryCallbackCandidate[] = [];
  for (const item of items) {
    if (
      item.tenantId !== scope.actor.tenantId ||
      item.ownerContextType !== "user" ||
      item.ownerContextId !== scope.actor.userId ||
      !LIVE.has(item.status) ||
      memoryTruthClass(item) !== "USER_CLAIM" ||
      !subjectInRun(item.subject, scope.subjects)
    ) {
      continue;
    }
    const type = item.memoryType;
    if (!isCallbackType(type)) continue;
    const content = item.content.replace(/\s+/gu, " ").trim();
    if (content.length < 3) continue;
    out.push({
      memoryType: type,
      content: content.slice(0, 300),
      quote: item.quote,
    });
    if (out.length >= CALLBACK_CANDIDATES_MAX) break;
  }
  return out;
}
