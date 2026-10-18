"use client";

import type { GateqInboxDetailDto } from "@capital-q/contracts";

import { UnicornPotential } from "@/features/scores/unicorn-potential";
import { useT } from "@/features/i18n/language";

/** Optional server-authorized assessment; never computed from application names. */
export function GateqUnicornAssessment({
  value,
}: {
  readonly value: GateqInboxDetailDto["unicornPotential"];
}) {
  const t = useT();
  if (value === undefined) return null;
  return (
    <section
      className="flex min-w-0 w-full flex-col gap-3 py-4"
      aria-label={t("Current company assessment")}
      data-testid="gateq-unicorn-assessment"
    >
      <div>
        <h3 className="cq-title-sm text-(--cq-text-primary)">
          {t("Current company assessment")}
        </h3>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t(
            "Based on currently available company evidence. Separate from the application frozen at submission, mandate fit and the investor's decision.",
          )}
        </p>
      </div>
      <UnicornPotential companyId={value.companyId} score={value.assessment} />
    </section>
  );
}
