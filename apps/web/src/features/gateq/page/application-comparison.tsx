"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  GateqInboxDetailDto,
  GateqInvestmentGroup,
  QManifestRef,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { QSection, useQDialog } from "@/features/q/q-section";
import { loadDetailAction } from "./gateq-actions";
import { summaryWords } from "./summary-words";
import { useT } from "@/features/i18n/language";

export const GATEQ_COMPARE_MAX = 6;
const GROUPS: readonly (readonly [GateqInvestmentGroup, string])[] = [
  ["COMPANY", "Company"],
  ["PRODUCT", "Product"],
  ["MARKET", "Market"],
  ["BUSINESS_MODEL", "Business model"],
  ["TRACTION", "Traction"],
  ["TEAM", "Team"],
  ["FUNDRAISING", "Fundraising"],
];
const NOT_RECORDED = "Not recorded";

function Fact({
  fact,
}: {
  readonly fact: NonNullable<
    GateqInboxDetailDto["dossier"]
  >["dimensions"][number]["facts"][number];
}) {
  const t = useT();

  const truth = {
    USER_CLAIM: "Applicant claim",
    ESTIMATE: "Estimate",
    UNKNOWN: "Unknown",
    Q_INFERENCE: "Q inference",
  }[fact.truthClass];
  const evidence = {
    NO_EVIDENCE: "No evidence recorded",
    SELF_REPORTED: "Self reported",
    DOCUMENT_SUPPORTED: "Document support recorded",
  }[fact.evidenceStatus];
  const origin =
    fact.truthClass === "Q_INFERENCE"
      ? "Derived by Q, not said in these words"
      : {
          APPLICANT_PROVIDED: "Applicant provided",
          DOCUMENT_SUPPORTED: "Document supported",
          ESTIMATED: "Estimated",
          UNKNOWN: "Unknown",
        }[fact.provenance];
  return (
    <div className="flex flex-col gap-1">
      <p className="whitespace-pre-wrap break-words">
        {t(summaryWords(fact.summary))}
      </p>
      <p className="cq-caption gq-t2">
        {t("Origin:")} {t(origin)} {t("· Truth:")} {t(truth)} {t("· Evidence:")}{" "}
        {t(evidence)}
      </p>
      {fact.derivation === undefined ? null : (
        <p className="cq-caption gq-t2">{t(fact.derivation)}</p>
      )}
    </div>
  );
}

function ComparisonTable({
  details,
}: {
  readonly details: readonly GateqInboxDetailDto[];
}) {
  const t = useT();

  const row = (
    key: string,
    label: string,
    value: (detail: GateqInboxDetailDto) => ReactNode,
  ) => (
    <tr key={key} className="border-t border-(--cq-border-subtle)">
      <th
        scope="row"
        className="cq-body-sm min-w-44 px-2 py-3 text-start align-top font-medium text-(--cq-text-secondary)"
      >
        {t(label)}
      </th>
      {details.map((detail) => (
        <td
          key={detail.item.applicationId}
          className="cq-body-sm min-w-56 px-4 py-3 align-top"
        >
          {value(detail)}
        </td>
      ))}
    </tr>
  );
  return (
    <div
      className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      tabIndex={0}
      role="region"
      aria-label={t("Application comparison table")}
    >
      <table className="w-full border-collapse text-start">
        <caption className="sr-only">
          {t("Saved submitted applications compared side by side")}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="cq-label px-2 py-3">
              {t("Submitted information")}
            </th>
            {details.map((detail) => (
              <th
                key={detail.item.applicationId}
                scope="col"
                className="cq-label px-4 py-3"
              >
                <span className="block">
                  {detail.dossier?.company.name ?? detail.item.companyName}
                </span>
                <span className="cq-caption gq-t2 block">
                  {t(detail.item.reference)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row(
            "description",
            "Company proposition",
            (detail) =>
              detail.dossier?.company.description ??
              detail.item.oneLiner ??
              NOT_RECORDED,
          )}
          {row(
            "stage",
            "Declared stage",
            (detail) =>
              detail.dossier?.company.stage ??
              detail.item.stage ??
              NOT_RECORDED,
          )}
          {row(
            "country",
            "Declared country",
            (detail) =>
              detail.dossier?.company.country ??
              detail.item.country ??
              NOT_RECORDED,
          )}
          {row("sector", "Declared sectors", (detail) =>
            detail.dossier?.company.sectorPhrases.length
              ? detail.dossier.company.sectorPhrases.join(", ")
              : (detail.item.sector ?? NOT_RECORDED),
          )}
          {row("raise", "Declared raise", (detail) =>
            detail.item.raise === null
              ? NOT_RECORDED
              : `${detail.item.raise.amount} ${detail.item.raise.currency}`,
          )}
          {row("qualification", "Published mandate qualification", (detail) =>
            detail.dossier?.qualification.criteria.length === 0 ||
            (detail.dossier == null && detail.rules.length === 0) ? (
              "No published criteria checked"
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.dossier == null
                  ? detail.rules.map((rule) => (
                      <li key={rule.label}>
                        {t(rule.label)} ·{" "}
                        {rule.standing === "MEETS"
                          ? t("Meets")
                          : rule.standing === "DOES_NOT_MEET"
                            ? t("Doesn't meet")
                            : t("Needs clarification")}{" "}
                        · {rule.required ? t("Required") : t("Preferred")}
                      </li>
                    ))
                  : detail.dossier.qualification.criteria.map((rule) => (
                      <li key={rule.label}>
                        {t(rule.label)} ·{" "}
                        {t(
                          {
                            MATCH: "Meets",
                            NO_MATCH: "Doesn't meet",
                            UNKNOWN: "Needs clarification",
                            NOT_APPLICABLE: "Not applicable",
                          }[rule.status],
                        )}{" "}
                        ·{" "}
                        {rule.requiredness === "REQUIRED"
                          ? t("Required")
                          : t("Preferred")}
                      </li>
                    ))}
              </ul>
            ),
          )}
          {GROUPS.flatMap(([group, label]) => {
            const dimensions = new Map<string, string>();
            for (const detail of details)
              for (const section of detail.dossier?.dimensions ?? [])
                if (section.group === group)
                  for (const fact of section.facts)
                    if (!dimensions.has(fact.dimension))
                      dimensions.set(fact.dimension, fact.label);
            return dimensions.size === 0
              ? [row(group, label, () => NOT_RECORDED)]
              : [...dimensions].map(([dimension, title]) =>
                  row(
                    `${group}:${dimension}`,
                    `${label} · ${title}`,
                    (detail) => {
                      const facts = (detail.dossier?.dimensions ?? [])
                        .filter((section) => section.group === group)
                        .flatMap((section) => section.facts)
                        .filter((fact) => fact.dimension === dimension);
                      return facts.length === 0 ? (
                        NOT_RECORDED
                      ) : (
                        <div className="flex flex-col gap-3">
                          {facts.map((fact, index) => (
                            <Fact key={index} fact={fact} />
                          ))}
                        </div>
                      );
                    },
                  ),
                );
          })}
          {row("legacy-answers", "Submitted form answers", (detail) =>
            detail.answers.length === 0 ? (
              NOT_RECORDED
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.answers.map((answer) => (
                  <li key={answer.label}>
                    <b className="font-medium">{t(answer.label)}:</b>{" "}
                    {t(answer.value)}
                  </li>
                ))}
              </ul>
            ),
          )}
          {row("gaps", "Evidence gaps", (detail) =>
            detail.dossier == null ? (
              "Structured evidence coverage was not recorded for this submission"
            ) : detail.dossier.unknowns.length +
                detail.dossier.declined.length +
                detail.dossier.missing.length ===
              0 ? (
              "No gaps recorded"
            ) : (
              <ul className="flex flex-col gap-1">
                {detail.dossier.unknowns.map((gap) => (
                  <li key={`unknown:${gap.dimension}`}>
                    {t("Unknown ·")} {t(gap.label)}
                  </li>
                ))}
                {detail.dossier.declined.map((gap) => (
                  <li key={`declined:${gap.dimension}`}>
                    {t("Declined ·")} {t(gap.label)}
                  </li>
                ))}
                {detail.dossier.missing.map((gap) => (
                  <li key={`missing:${gap.dimension}`}>
                    {t("Missing ·")} {t(gap.label)}
                  </li>
                ))}
              </ul>
            ),
          )}
          {row("contradictions", "Conflicting answers", (detail) =>
            detail.dossier == null ? (
              NOT_RECORDED
            ) : detail.dossier.contradictions.length === 0 ? (
              "No conflicts recorded"
            ) : (
              <ul className="flex flex-col gap-1">
                {detail.dossier.contradictions.map((line, index) => (
                  <li key={index}>{t(line)}</li>
                ))}
              </ul>
            ),
          )}
          {row("documents", "Submitted documents", (detail) =>
            detail.shared.length === 0 ? (
              "No documents submitted"
            ) : (
              <ul>
                {detail.shared.map((document) => (
                  <li key={document.documentId}>{t(document.title)}</li>
                ))}
              </ul>
            ),
          )}
          {row("questions", "Saved diligence questions", (detail) =>
            detail.dossier == null ||
            detail.dossier.diligenceQuestions.length === 0 ? (
              NOT_RECORDED
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.dossier.diligenceQuestions.map((question, index) => (
                  <li key={index}>{t(question.question)}</li>
                ))}
              </ul>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Reauthorise every selected application, then expose one complete comparison. */
export function ApplicationComparison({
  gatewayId,
  ids,
  allowedIds,
  demoDetails,
}: {
  readonly gatewayId: string;
  readonly ids: readonly string[];
  readonly allowedIds: readonly string[];
  readonly demoDetails?:
    Readonly<Record<string, GateqInboxDetailDto>> | undefined;
}) {
  const t = useT();

  const [details, setDetails] = useState<readonly GateqInboxDetailDto[] | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([gatewayId, ids, allowedIds]);
  useEffect(() => {
    let active = true;
    const [gateway, selected, allowed] = JSON.parse(requestKey) as [
      string,
      string[],
      string[],
    ];
    async function read() {
      try {
        await Promise.resolve();
        if (
          selected.length < 2 ||
          selected.length > GATEQ_COMPARE_MAX ||
          new Set(selected).size !== selected.length ||
          selected.some((id) => !allowed.includes(id))
        )
          throw new Error("Invalid selection");
        const all = await Promise.all(
          selected.map(async (id) => {
            const result =
              demoDetails === undefined
                ? await loadDetailAction(gateway, id)
                : demoDetails[id] === undefined
                  ? { ok: false as const, message: "Unavailable" }
                  : { ok: true as const, value: demoDetails[id] };
            if (
              !result.ok ||
              result.value === undefined ||
              result.value.item.applicationId !== id ||
              result.value.item.submittedAt.trim() === ""
            )
              throw new Error("Unavailable application");
            return result.value;
          }),
        );
        if (active) setDetails(all);
      } catch {
        if (active)
          setProblem(
            "Couldn't load every selected application. Nothing was compared. Check your selection and try again.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [requestKey, demoDetails, attempt]);
  const refs: QManifestRef[] = (details ?? []).map((detail) => ({
    kind: "GATEQ_APPLICATION",
    id: detail.item.applicationId,
  }));
  useQDialog(
    details !== null,
    "gateq-comparison-dialog",
    "OTHER",
    refs,
    "Submitted application comparison",
  );
  if (loading)
    return (
      <p role="status" className="cq-body-sm gq-t2">
        {t("Loading selected submissions…")}
      </p>
    );
  if (problem !== null)
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="cq-body-sm">
          {t(problem)}
        </p>
        <Button
          onClick={() => {
            setProblem(null);
            setDetails(null);
            setLoading(true);
            setAttempt((current) => current + 1);
          }}
        >
          {t("Try again")}
        </Button>
      </div>
    );
  if (details === null) return null;
  return (
    <QSection
      id="gateq-comparison"
      kind="GATEQ_APPLICATION"
      refs={refs}
      label={t("Submitted application comparison")}
    >
      <p className="cq-body-sm gq-t2 mb-4">
        {t(
          "Saved submission data, compared side by side. Claims and evidence retain their recorded status. Your team makes the investment decision.",
        )}
      </p>
      <ComparisonTable details={details} />
    </QSection>
  );
}
