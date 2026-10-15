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
          Dossier
        </h3>
        <span className="cq-caption gq-t3">
          Frozen at submission · {dossier.application.reference}
        </span>
      </div>

      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}
      >
        <div className="flex flex-col gap-1">
          <h4 className="cq-label">Company</h4>
          <p className="cq-body">{company.name ?? "Name not given"}</p>
          {company.description === null ? null : (
            <p className="cq-body-sm gq-t2">{company.description}</p>
          )}
          <p className="cq-caption gq-t2">
            {[
              company.stage,
              company.country,
              company.sectorPhrases.join(", ") || null,
              company.website,
            ]
              .filter((part) => part !== null && part !== "")
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <h4 className="cq-label">Contact</h4>
          {contact === null ? (
            <p className="cq-body-sm gq-t2">No contact on record.</p>
          ) : (
            <>
              <p className="cq-body">
                {contact.name}
                <span className="gq-t2">
                  {" "}
                  · {contact.role}, {contact.companyName}
                </span>
              </p>
              <p className="cq-body-sm">
                {contact.email}{" "}
                <span className="gq-t2">
                  {contact.emailConfirmed
                    ? contact.confirmedVia === "ACCOUNT"
                      ? "(confirmed by their account)"
                      : "(confirmed by email code)"
                    : "(not confirmed)"}
                </span>
              </p>
              {contact.phone === null ? null : (
                <p className="cq-body-sm">
                  {contact.phone} <span className="gq-t2">(not confirmed)</span>
                </p>
              )}
              {contact.preferredChannel === null ? null : (
                <p className="cq-caption gq-t2">
                  Prefers {CHANNEL_WORDS[contact.preferredChannel]}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="cq-label">Qualification</h4>
        <p className="cq-body-sm">{OUTCOME_WORDS[q.outcome]}</p>
        {q.criteria.length === 0 ? (
          <p className="cq-body-sm gq-t2">
            No published rules, so nothing was checked.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">
              Your published rules, criterion by criterion
            </caption>
            <thead>
              <tr className="gq-t2 text-left">
                <th scope="col" className="py-1.5 font-medium">
                  Rule
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Type
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {q.criteria.map((criterion) => (
                <tr
                  key={criterion.label}
                  className="border-t border-(--cq-border-subtle)"
                >
                  <td className="py-2 pr-2">{criterion.label}</td>
                  <td className="gq-t2 py-2 pr-2">
                    {criterion.requiredness === "REQUIRED"
                      ? "Required"
                      : "Preferred"}
                  </td>
                  <td className="py-2">
                    <span className="flex items-center gap-1.5">
                      <FitGlyph
                        kind={CRITERION_STATUS_GLYPH[criterion.status]}
                      />
                      {CRITERION_STATUS_WORDS[criterion.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="cq-label">What the founder told you</h4>
        {dossier.dimensions.length === 0 ? (
          <p className="cq-body-sm gq-t2">No facts recorded.</p>
        ) : (
          dossier.dimensions.map((group) => (
            <div key={group.group} className="flex flex-col gap-1">
              <h5 className="cq-caption gq-t2 font-medium">{group.label}</h5>
              <ul className="gq-hair">
                {group.facts.map((fact) => (
                  <li
                    key={fact.sourceFactId}
                    className="flex flex-col gap-0.5 py-2"
                  >
                    <span className="flex flex-wrap items-baseline gap-2">
                      <b className="font-medium">{fact.label}</b>
                      <span className="gq-prefill">
                        {factProvenanceWords(fact)}
                      </span>
                      {fact.sourceTurnSeq === null ? null : (
                        <span className="cq-caption gq-t3">
                          Interview turn {fact.sourceTurnSeq}
                        </span>
                      )}
                    </span>
                    <span className="cq-body-sm gq-t2">{fact.summary}</span>
                    {fact.derivation === undefined ? null : (
                      <span className="cq-caption gq-t3">
                        {fact.derivation}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        <p className="cq-caption gq-t3">
          The founder&apos;s claims and documents. Capital Q hasn&apos;t
          verified them.
        </p>
      </div>

      {gaps === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h4 className="cq-label">Open questions</h4>
          <ul className="gq-hair">
            {dossier.contradictions.map((line) => (
              <li key={`c-${line}`} className="flex items-start gap-2 py-2">
                <FitGlyph kind="part" />
                <span className="flex-1 text-sm">{line}</span>
                <span className="gq-status">Answers disagree</span>
              </li>
            ))}
            {dossier.missing.map((gap) => (
              <li
                key={`m-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1 text-sm">{gap.label}</span>
                <span className="gq-status">
                  Missing · {MISSING_WORDS[gap.reason]}
                </span>
              </li>
            ))}
            {dossier.unknowns.map((gap) => (
              <li
                key={`u-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1 text-sm">{gap.label}</span>
                <span className="gq-status">Unknown to the founder</span>
              </li>
            ))}
            {dossier.declined.map((gap) => (
              <li
                key={`d-${gap.dimension}`}
                className="flex items-center gap-2 py-2"
              >
                <FitGlyph kind="unk" />
                <span className="flex-1 text-sm">{gap.label}</span>
                <span className="gq-status">Preferred not to say</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <h4 className="cq-label">Documents</h4>
        {dossier.documents.length === 0 ? (
          <p className="cq-body-sm gq-t2">No documents with the dossier.</p>
        ) : (
          <ul className="gq-hair">
            {dossier.documents.map((document) => (
              <li
                key={document.documentId}
                className="flex min-h-11 items-center gap-3"
              >
                <FileText {...icon} size={18} />
                <span className="flex-1 text-sm">{document.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dossier.diligenceQuestions.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <h4 className="cq-label">Suggested diligence questions</h4>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            {dossier.diligenceQuestions.map((question, index) => (
              <li key={`${question.basis}-${index}`} className="text-sm">
                {question.question}{" "}
                <span className="cq-caption gq-t3">
                  ({DILIGENCE_BASIS_WORDS[question.basis]})
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {dossier.synthesis === null ? (
        <p className="cq-body-sm gq-t2" data-testid="gq-synthesis-placeholder">
          Q synthesis: not yet available.
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
  return (
    <section className="gq-sect">
      <details className="gq-transcript">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2">
          <h3 className="cq-title-sm">Interview transcript</h3>
          <span className="cq-caption gq-t3">
            {turns.length} turn{turns.length === 1 ? "" : "s"}
          </span>
          <ChevronDown {...icon} />
        </summary>
        {turns.length === 0 ? (
          <p className="cq-body-sm gq-t2">The founder skipped the interview.</p>
        ) : (
          <ol className="flex flex-col gap-2.5 pt-2">
            {turns.map((turn) => (
              <li key={turn.seq} className="flex flex-col gap-0.5">
                <span className="cq-caption gq-t3">
                  <b className="font-medium">{speakerWords(turn.role)}</b> ·{" "}
                  {receivedWords(turn.at)}
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
