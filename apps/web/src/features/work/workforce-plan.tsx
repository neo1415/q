import type { WorkforcePlanProgress } from "@capital-q/contracts";
import { useT } from "@/features/i18n/language";

/**
 * The approved plan as it stands (wf 2026-10-16): the outcome Q's team is
 * working towards, each step with why it is there and the facts it rests
 * on, what is missing or not known, what the steps found, and what comes
 * next -- each next action saying whether it needs the person's approval.
 * Every word is the server's, derived by code from the approved plan and
 * what its steps recorded; nothing here is generated in the browser.
 */

const STATUS_WORDS: Readonly<
  Record<WorkforcePlanProgress["steps"][number]["status"], string>
> = {
  DONE: "Done",
  HELD: "Needs you",
  FAILED: "Did not finish",
  SKIPPED: "Did not run",
  WAITING: "Waiting",
  NOT_NEEDED: "Not needed",
};

const PREREQUISITE_WORDS = {
  MET: "In place",
  MISSING: "Missing",
  UNKNOWN: "Not known yet",
} as const;

export function WorkforcePlan({
  plan,
}: {
  readonly plan: WorkforcePlanProgress | undefined;
}) {
  const t = useT();

  if (plan === undefined || plan.total === 0) return null;
  const missing = plan.prerequisites.filter((one) => one.status !== "MET");
  const steps = new Map(plan.steps.map((step) => [step.key, step.who]));
  return (
    <details
      className="border-t border-(--cq-border-subtle) px-4 py-1"
      data-workforce-plan
    >
      <summary className="cq-label flex min-h-11 cursor-pointer items-center gap-2 font-normal">
        <span className="font-medium">{t("The plan")}</span>
        <span className="cq-numeric text-(--cq-text-secondary)">
          {plan.done} {t(`of ${String(plan.total)} steps done`)}
        </span>
      </summary>
      <div className="pb-3">
        {plan.outcome === null ? null : (
          <p className="cq-body-sm m-0 mb-3">
            <span className="text-(--cq-text-secondary)">
              {t("Working towards:")}{" "}
            </span>
            {t(plan.outcome)}
          </p>
        )}
        <ol className="m-0 mb-3 list-none space-y-2.5 p-0">
          {plan.steps.map((step) => (
            <li key={step.key} data-plan-step={step.status}>
              <p className="cq-body-sm m-0">
                <span className="font-medium">{step.who}</span>
                {": "}
                {t(step.does)}
              </p>
              <p className="m-0 text-[13px] text-(--cq-text-secondary)">
                {t(STATUS_WORDS[step.status])}
                {step.fallbackFor === null
                  ? ""
                  : t(
                      ` · only if ${steps.get(step.fallbackFor) ?? "an earlier step"} cannot`,
                    )}
                {step.dependsOn.length === 0
                  ? ""
                  : t(
                      ` · after ${step.dependsOn.map((key) => steps.get(key) ?? key).join(", ")}`,
                    )}
                {step.summary === null ? "" : t(` · ${step.summary}`)}
              </p>
              {step.why === null ? null : (
                <p className="m-0 text-[13px] text-(--cq-text-secondary)">
                  {t("Why:")} {t(step.why)}
                </p>
              )}
              {step.evidence.length === 0 ? null : (
                <ul className="m-0 mt-0.5 list-none p-0 text-[13px] text-(--cq-text-tertiary)">
                  {step.evidence.map((fact) => (
                    <li key={fact.ref}>
                      {t("Based on:")} {fact.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        {missing.length === 0 ? null : (
          <section aria-label={t("Missing or not known")} className="mb-3">
            <h5 className="cq-label m-0 mb-1 font-medium">
              {t("Missing or not known")}
            </h5>
            <ul className="cq-body-sm m-0 list-disc space-y-1 ps-5">
              {missing.map((one) => (
                <li key={one.what}>
                  {t(one.what)}{" "}
                  <span className="text-(--cq-text-secondary)">
                    ({t(PREREQUISITE_WORDS[one.status])}
                    {one.blocking ? t(", needed for the outcome") : ""}
                    {one.resolvedBy === null
                      ? ""
                      : t(`; ${steps.get(one.resolvedBy) ?? "a step"} gets it`)}
                    )
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.signals.length === 0 ? null : (
          <section aria-label={t("What the team found")} className="mb-3">
            <h5 className="cq-label m-0 mb-1 font-medium">
              {t("What the team found")}
            </h5>
            <ul className="cq-body-sm m-0 list-disc space-y-1 ps-5">
              {plan.signals.map((one) => (
                <li key={`${one.stepKey}:${one.note}`}>
                  <span className="font-medium">
                    {one.kind === "CONTRADICTION"
                      ? t("Contradiction")
                      : one.kind === "MISSING_INFORMATION"
                        ? t("Not known")
                        : t("Changed")}
                    :
                  </span>{" "}
                  {one.note}
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.nextActions.length === 0 ? null : (
          <section aria-label={t("What comes next")}>
            <h5 className="cq-label m-0 mb-1 font-medium">
              {t("What comes next")}
            </h5>
            <ol className="cq-body-sm m-0 list-decimal space-y-1.5 ps-5">
              {plan.nextActions.map((one) => (
                <li key={one.action}>
                  {t(one.action)}
                  <span className="block text-[13px] text-(--cq-text-secondary)">
                    {t(one.why)}
                    {one.needsApproval ? t(" Needs your approval.") : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </details>
  );
}
