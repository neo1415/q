import type {
  ApplicationTranscriptTurnDto,
  GateqDossierV1,
} from "@capital-q/contracts";
import {
  ChevronDown,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";

import { FitGlyph } from "../fit-glyph";
import {
  CRITERION_STATUS_GLYPH,
  CRITERION_STATUS_WORDS,
  DILIGENCE_BASIS_WORDS,
  factProvenanceWords,
  MISSING_WORDS,
  OUTCOME_WORDS,
  receivedWords,
  speakerWords,
} from "./inbox-model";
import { summaryWords } from "./summary-words";
import { useT } from "@/features/i18n/language";

/**
 * GateQ slice 1: the dossier frozen with a submission, inside the existing
 * inbox detail (no new dashboard).
 *
 * Everything here is the deterministic v1 brief: the published criteria's
 * labels and statuses, the founder's facts with their provenance, what is
 * unknown, declined, missing or contradictory, and diligence questions
 * built from those gaps. No model wrote any of it. `synthesis` is reserved
 * for a later, nonbinding Q reading and is null in v1: the placeholder
 * says so rather than inventing one.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

const CHANNEL_WORDS = { EMAIL: "email", PHONE: "phone" } as const;

export function DossierSection({
  dossier,
}: {
  readonly dossier: GateqDossierV1;
}) {
  const t = useT();

  const company = dossier.company;
  const contact = dossier.contact;
  const q = dossier.qualification;
  const gaps =
    dossier.unknowns.length +
    dossier.declined.length +
    dossier.missing.length +
    dossier.contradictions.length;
  return (
    <section
      className="gq-sect"
      aria-labelledby="gq-dossier-h"
      data-testid="gq-dossier"
    >
      <div className="gq-sect-h">
        <h3 id="gq-dossier-h" className="cq-title-sm">
          {t("Dossier")}
        </h3>
        <span className="cq-caption gq-t3">
          {t("Frozen at submission ·")} {t(dossier.application.reference)}
        </span>
      </div>

      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}
      >
        <div className="flex flex-col gap-1">
          <h4 className="cq-label">{t("Company")}</h4>
          <p className="cq-body">{company.name ?? t("Name not given")}</p>
          {company.description === null ? null : (
            <p className="cq-body-sm gq-t2">{t(company.description)}</p>
          )}
          <p className="cq-caption gq-t2">
            {t(
              [
                company.stage,
                company.country,
                company.sectorPhrases.join(", ") || null,
                company.website,
              ]
                .filter((part) => part !== null && part !== "")
                .join(" · "),
            )}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <h4 className="cq-label">{t("Contact")}</h4>
          {contact === null ? (
            <p className="cq-body-sm gq-t2">{t("No contact on record.")}</p>
          ) : (
            <>
              <p className="cq-body">
                {contact.name}
                <span className="gq-t2">
                  {" "}
                  · {t(contact.role)}, {contact.companyName}
                </span>
              </p>
              <p className="cq-body-sm">
                {contact.email}{" "}
                <span className="gq-t2">
                  {contact.emailConfirmed
                    ? contact.confirmedVia === "ACCOUNT"
                      ? t("(confirmed by their account)")
                      : t("(confirmed by email code)")
                    : t("(not confirmed)")}
                </span>
              </p>
              {contact.phone === null ? null : (
                <p className="cq-body-sm">
                  {t(contact.phone)}{" "}
                  <span className="gq-t2">{t("(not confirmed)")}</span>
                </p>
              )}
              {contact.preferredChannel === null ? null : (
                <p className="cq-caption gq-t2">
                  {t("Prefers")} {t(CHANNEL_WORDS[contact.preferredChannel])}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="cq-label">{t("Qualification")}</h4>
        <p className="cq-body-sm">{t(OUTCOME_WORDS[q.outcome])}</p>
        {q.criteria.length === 0 ? (
          <p className="cq-body-sm gq-t2">
            {t("No published rules, so nothing was checked.")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">
              {t("Your published rules, criterion by criterion")}
            </caption>
            <thead>
              <tr className="gq-t2 text-start">
                <th scope="col" className="py-1.5 font-medium">
                  {t("Rule")}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {t("Type")}
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  {t("Status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {q.criteria.map((criterion) => (
                <tr
                  key={criterion.label}
                  className="border-t border-(--cq-border-subtle)"
                >
                  <td className="py-2 pe-2">{t(criterion.label)}</td>
                  <td className="gq-t2 py-2 pe-2">
                    {criterion.requiredness === "REQUIRED"
                      ? t("Required")
                      : t("Preferred")}
                  </td>
                  <td className="py-2">
                    <span className="flex items-center gap-1.5">
                      <FitGlyph
                        kind={CRITERION_STATUS_GLYPH[criterion.status]}
                      />
                      {t(CRITERION_STATUS_WORDS[criterion.status])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="cq-label">{t("What the founder told you")}</h4>
        {dossier.dimensions.length === 0 ? (
          <p className="cq-body-sm gq-t2">{t("No facts recorded.")}</p>
        ) : (
          dossier.dimensions.map((group) => (
            <div key={group.group} className="flex flex-col gap-1">
              <h5 className="cq-caption gq-t2 font-medium">{t(group.label)}</h5>
              <ul className="gq-hair">
                {group.facts.map((fact) => (
                  <li
                    key={fact.sourceFactId}
                    className="flex flex-col gap-0.5 py-2"
                  >
                    <span className="flex flex-wrap items-baseline gap-2">
                      <b className="font-medium">{t(fact.label)}</b>
                      <span className="gq-prefill">
                        {t(factProvenanceWords(fact))}
                      </span>
                      {fact.sourceTurnSeq === null ? null : (
                        <span className="cq-caption gq-t3">
                          {t("Interview turn")} {fact.sourceTurnSeq}
                        </span>
                      )}
                    </span>
                    <span className="cq-body-sm gq-t2">
                      {t(summaryWords(fact.summary))}
                    </span>
                    {fact.derivation === undefined ? null : (
                      <span className="cq-caption gq-t3">
                        {t(fact.derivation)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        <p className="cq-caption gq-t3">
          {t(
            "The founder's claims and documents. Capital Q hasn't verified them.",
          )}
        </p>
      </div>

      {gaps === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h4 className="cq-label">{t("Open questions")}</h4>
          <ul className="gq-hair">
            {dossier.contradictions.map((line) => (
              <li key={`c-${line}`} className="flex items-start gap-2 py-2">
                <FitGlyph kind="part" />
                <span className="flex-1 text-sm">{t(line)}</span>
                <span className="gq-status">{t("Answers disagree")}</span>
              </li>
            ))}
            {dossier.missing.map((gap) => (
              <li
                key={`m-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1 text-sm">{t(gap.label)}</span>
                <span className="gq-status">
                  {t("Missing ·")} {t(MISSING_WORDS[gap.reason])}
                </span>
              </li>
            ))}
            {dossier.unknowns.map((gap) => (
              <li
                key={`u-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1 text-sm">{t(gap.label)}</span>
                <span className="gq-status">{t("Unknown to the founder")}</span>
              </li>
            ))}
            {dossier.declined.map((gap) => (
              <li
                key={`d-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1 text-sm">{t(gap.label)}</span>
                <span className="gq-status">{t("Preferred not to say")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <h4 className="cq-label">{t("Documents")}</h4>
        {dossier.documents.length === 0 ? (
          <p className="cq-body-sm gq-t2">
            {t("No documents with the dossier.")}
          </p>
        ) : (
          <ul className="gq-hair">
            {dossier.documents.map((document) => (
              <li
                key={document.documentId}
                className="flex min-h-11 items-center gap-3"
              >
                <FileText {...icon} size={18} />
                <span className="flex-1 text-sm">{t(document.title)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dossier.diligenceQuestions.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h4 className="cq-label">{t("Suggested diligence questions")}</h4>
          <ol className="flex list-decimal flex-col gap-1.5 ps-5">
            {dossier.diligenceQuestions.map((question, index) => (
              <li key={`${question.basis}-${index}`} className="text-sm">
                {t(question.question)}{" "}
                <span className="cq-caption gq-t3">
                  ({t(DILIGENCE_BASIS_WORDS[question.basis])})
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {dossier.synthesis === null ? (
        <p className="cq-body-sm gq-t2" data-testid="gq-synthesis-placeholder">
          {t("Q synthesis: not yet available.")}
        </p>
      ) : null}
    </section>
  );
}

export function TranscriptSection({
  turns,
}: {
  readonly turns: readonly ApplicationTranscriptTurnDto[];
}) {
  const t = useT();

  return (
    <section className="gq-sect">
      <details className="gq-transcript">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2">
          <h3 className="cq-title-sm">{t("Interview transcript")}</h3>
          <span className="cq-caption gq-t3">
            {turns.length} {t("turn")}
            {turns.length === 1 ? "" : "s"}
          </span>
          <ChevronDown {...icon} />
        </summary>
        {turns.length === 0 ? (
          <p className="cq-body-sm gq-t2">
            {t("The founder skipped the interview.")}
          </p>
        ) : (
          <ol className="flex flex-col gap-2.5 pt-2">
            {turns.map((turn) => (
              <li key={turn.seq} className="flex flex-col gap-0.5">
                <span className="cq-caption gq-t3">
                  <b className="font-medium">{t(speakerWords(turn.role))}</b> ·{" "}
                  {t(receivedWords(turn.at))}
                </span>
                <span className="cq-body-sm whitespace-pre-line">
                  {turn.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
