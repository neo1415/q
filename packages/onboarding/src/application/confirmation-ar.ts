import type { OnboardingCoverageSource } from "@capital-q/contracts";

import type { OnboardingCopyCatalog } from "./confirmation.js";

/**
 * Arabic onboarding copy (lane ml, multilingual Q, 2026-10-16): Modern
 * Standard Arabic, the register a Gulf professional uses at work. The same
 * promises as the English catalog, word for word in meaning: a group is
 * offered, never assumed; "saved" is said only of what was saved; a
 * sensitive document is acknowledged without being read; public findings
 * are proposed, never presented as verified. Field labels and values are
 * shown as recorded (a company name, a figure, a currency code is never
 * translated or converted).
 */

const list = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join("، ")} و${items[items.length - 1] ?? ""}`;

function sourcePhrase(sources: readonly OnboardingCoverageSource[]): string {
  const unique = [...new Set(sources)];
  const only = unique.length === 1 ? unique[0] : undefined;
  if (only === "DOCUMENT") return "من مستندك";
  if (only === "PUBLIC_RESEARCH") return "من صفحات عامة (غير موثّقة)";
  if (only === "CONVERSATION" || only === "Q_RECOMMENDATION") {
    return "مما أخبرتني به";
  }
  return "مما لديّ حتى الآن";
}

export const ARABIC_ONBOARDING_COPY: OnboardingCopyCatalog = {
  confirmGroup: ({ items, sources }) =>
    `هذا ما لديّ ${sourcePhrase(sources)}: ${items
      .map((i) => `${i.label}: ${i.display}`)
      .join(
        "؛ ",
      )}. هل أحفظ ${items.length === 1 ? "ذلك" : "هذه المعلومات"}، أم أن هناك ما يحتاج إلى تصحيح؟`,
  saved: (labels) =>
    labels.length === 0 ? "لم يُحفظ شيء جديد." : `تم الحفظ: ${list(labels)}.`,
  heldForRetry: (labels) =>
    `تعذّر عليّ حفظ ${list(labels)} الآن. لم يضِع شيء: ${labels.length === 1 ? "أحتفظ به" : "أحتفظ بها"} وسأحفظ فور تمكّني من ذلك.`,
  documentAcknowledged: ({ filename, outstanding }) =>
    `استلمتُ ${filename} وأبقيته خاصاً. سجّلتُ بياناته الوصفية فقط ولم أقرأ محتواه.${
      outstanding.length === 0 ? "" : ` ما زال علينا: ${list(outstanding)}.`
    }`,
  researchProposal: ({ label, display, where }) =>
    `وجدتُ وصفاً عاماً ${where}: ${label}: ${display}. هل ما زال دقيقاً؟`,
};
