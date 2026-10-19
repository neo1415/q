"use client";

import { useState } from "react";

import { GlobalQInline } from "@/components/app-shell/global-q";
import { useQSessionOptional } from "@/features/q/q-session";
import { useT } from "@/features/i18n/language";

/** Questions an investor asks of a company first (Discover A's Ask Q). */
const DOSSIER_QUESTIONS = [
  "What's verified so far?",
  "How does this fit my mandate?",
  "What should I ask the founder?",
] as const;

/**
 * Q over the dossier: three first questions, then the one conversation.
 * The company is already Q's subject (QPageSubject above), so a question
 * is about it without saying so.
 */
export function DossierQ({ companyName }: { readonly companyName: string }) {
  const t = useT();
  const session = useQSessionOptional();
  // The first questions are a way in; once one is asked they step aside.
  const [asked, setAsked] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {session === null || asked ? null : (
        <div className="flex flex-col gap-2" data-feed-ask-suggested>
          <span className="cq-caption text-(--cq-text-secondary)">
            {t("Suggested")}
          </span>
          <div className="flex flex-wrap gap-2">
            {DOSSIER_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                className="cq-feed-toast-chip"
                disabled={session.q.working}
                onClick={() => {
                  setAsked(true);
                  void session.q.ask(t(question));
                }}
              >
                {t(question)}
              </button>
            ))}
          </div>
        </div>
      )}
      <GlobalQInline placeholder={`${t("Ask about")} ${companyName}…`} />
    </div>
  );
}
