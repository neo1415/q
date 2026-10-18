"use client";

import { Button } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { useT } from "@/features/i18n/language";

/**
 * Follow-up questions to Q about the one application being read.
 *
 * Executive review 2026-10-17: Q already receives the open application as
 * its page focus (GATEQ_APPLICATION), but nothing on the dossier said so;
 * the investor had to know to open Q and phrase the question. These ask
 * Q about this exact submission, keep the founder's claims apart from what
 * is evidenced, and keep mandate fit apart from business quality.
 */
export function applicationAsks(
  company: string,
): readonly (readonly [string, string])[] {
  return [
    [
      "What should we ask next?",
      `For ${company}'s submitted GateQ application: what are the most material unanswered investment questions, and what would you ask the founder next? Keep what they claimed apart from what is evidenced.`,
    ],
    [
      "What is still unverified?",
      `For ${company}'s submitted GateQ application: which claims rest only on the founder's word, which are supported by a document, and what evidence should we request first?`,
    ],
    [
      "Fit versus quality",
      `For ${company}'s submitted GateQ application: how does it stand against our published rules and our mandate, and separately, what do you make of the business itself from the evidence? Don't merge the two.`,
    ],
  ];
}

export function ApplicationAsks({ company }: { readonly company: string }) {
  const t = useT();
  const { askNow } = useGlobalQ();
  return (
    <div
      className="flex flex-col gap-1.5"
      data-application-asks
      aria-label={t("Ask Q about this application")}
      role="group"
    >
      <span className="cq-caption gq-t2">
        {t("Ask Q about this application")}
      </span>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {applicationAsks(company).map(([label, ask]) => (
          <Button key={label} variant="secondary" onClick={() => askNow(ask)}>
            {t(label)}
          </Button>
        ))}
      </div>
    </div>
  );
}
