import type {
  GateqDossierV1,
  ApplicationTranscriptTurnDto,
} from "@capital-q/contracts";

import { FitGlyph } from "../fit-glyph";

const STATUS = {
  MATCH: "Meets",
  NO_MATCH: "Doesn't meet",
  UNKNOWN: "Not answered",
  NOT_APPLICABLE: "Not applicable",
} as const;
const PROVENANCE = {
  APPLICANT_PROVIDED: "Applicant provided",
  DOCUMENT_SUPPORTED: "Document supported",
  ESTIMATED: "Estimated",
  UNKNOWN: "Unknown",
} as const;
const TRUTH = {
  USER_CLAIM: "Applicant claim",
  ESTIMATE: "Estimate",
  UNKNOWN: "Unknown",
} as const;
const EVIDENCE = {
  NO_EVIDENCE: "No evidence recorded",
  SELF_REPORTED: "Self reported",
  DOCUMENT_SUPPORTED: "Document support recorded",
} as const;
const BASIS = {
  MISSING: "Missing answer",
  UNKNOWN: "Unknown answer",
  DECLINED: "Founder declined",
  CONTRADICTION: "Conflicting answers",
} as const;
const REASON = {
  REQUIRED_BY_GATEWAY: "Required by the published mandate",
  PREFERRED_BY_GATEWAY: "Preferred by the published mandate",
  CONTRADICTION: "Conflicting answers",
  UNDERSTANDING: "Needed to understand the company",
} as const;
const OUTCOME = {
  QUALIFIED: "Meets the published mandate",
  NOT_QUALIFIED: "Outside the published mandate",
  INSUFFICIENT_INFORMATION: "More information needed for mandate qualification",
} as const;

function dateWords(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      });
}
function websiteHref(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Only the saved dossier is rendered: no inferred strengths, scores or sources. */
export function SubmittedBrief({
  dossier,
}: {
  readonly dossier: GateqDossierV1;
}) {
  const website = websiteHref(dossier.company.website);
  const contact = dossier.contact;
  const hasSupportedClaims = dossier.dimensions.some((group) =>
    group.facts.some((fact) => fact.evidenceStatus === "DOCUMENT_SUPPORTED"),
  );
  return (
    <section
      className="flex flex-col gap-5"
      aria-label="Submitted investment brief"
    >
      <header className="flex flex-col gap-1">
        <h3 className="cq-title-md">Submitted investment brief</h3>
        <p className="cq-caption gq-t2">
          Deterministic summary · {dossier.application.reference} · Submitted{" "}
          <time dateTime={dossier.application.submittedAt}>
            {dateWords(dossier.application.submittedAt)} UTC
          </time>
        </p>
        <p className="cq-body-sm gq-t2">
          Frozen from the founder&apos;s submission. Investment decisions remain
          with your team.
        </p>
      </header>

      <section className="gq-sect" aria-label="Submitted company and contact">
        <h4 className="cq-title-sm">Company and founder</h4>
        <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-2 cq-body-sm">
          <dt className="gq-t2">Company</dt>
          <dd className="min-w-0 break-words">
            {dossier.company.name ?? "Not provided"}
          </dd>
          <dt className="gq-t2">Description</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words">
            {dossier.company.description ?? "Not provided"}
          </dd>
          <dt className="gq-t2">Stage</dt>
          <dd>{dossier.company.stage ?? "Unknown"}</dd>
          <dt className="gq-t2">Country</dt>
          <dd>{dossier.company.country ?? "Unknown"}</dd>
          <dt className="gq-t2">Sectors</dt>
          <dd>
            {dossier.company.sectorPhrases.length === 0
              ? "Unknown"
              : dossier.company.sectorPhrases.join(", ")}
          </dd>
          <dt className="gq-t2">Website</dt>
          <dd className="min-w-0 break-words">
            {website === null ? (
              (dossier.company.website ?? "Not provided")
            ) : (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                {dossier.company.website}
              </a>
            )}
          </dd>
          {contact === null ? (
            <>
              <dt className="gq-t2">Contact</dt>
              <dd>Not recorded in this submission</dd>
            </>
          ) : (
            <>
              <dt className="gq-t2">Founder</dt>
              <dd>
                {contact.name} · {contact.role}
              </dd>
              <dt className="gq-t2">Contact company</dt>
              <dd>{contact.companyName}</dd>
              <dt className="gq-t2">Email</dt>
              <dd className="min-w-0 break-words">
                {contact.email}
                <span className="cq-caption gq-t2 block">
                  {contact.emailConfirmed
                    ? "Email ownership confirmed"
                    : "Email ownership not confirmed"}
                </span>
              </dd>
              {contact.phone === null ? null : (
                <>
                  <dt className="gq-t2">Phone</dt>
                  <dd>{contact.phone}</dd>
                </>
              )}
              {contact.preferredChannel === null ? null : (
                <>
                  <dt className="gq-t2">Preferred contact</dt>
                  <dd>
                    {contact.preferredChannel === "EMAIL" ? "Email" : "Phone"}
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
        {dossier.company.note === null ? null : (
          <div className="mt-3">
            <h4 className="cq-label">Founder&apos;s note</h4>
            <p className="cq-body-sm whitespace-pre-wrap">
              {dossier.company.note}
            </p>
          </div>
        )}
      </section>

      <section className="gq-sect" aria-label="Submitted mandate qualification">
        <h4 className="cq-title-sm">Published mandate qualification</h4>
        <p className="cq-body-sm mb-2">
          {dossier.qualification.criteria.length === 0
            ? "No published criteria were checked"
            : OUTCOME[dossier.qualification.outcome]}
        </p>
        <ul>
          {dossier.qualification.criteria.map((criterion) => (
            <li key={criterion.label} className="gq-check cq-body-sm">
              <FitGlyph
                kind={
                  criterion.status === "MATCH"
                    ? "fit"
                    : criterion.status === "NO_MATCH"
                      ? "no"
                      : "unk"
                }
              />
              <span className="flex-1">
                {criterion.label}
                <span className="cq-caption gq-t2 block">
                  {criterion.requiredness === "REQUIRED"
                    ? "Required"
                    : "Preferred"}
                </span>
              </span>
              <span className="gq-status">{STATUS[criterion.status]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="gq-sect" aria-label="Submitted investment dimensions">
        <h4 className="cq-title-sm">
          Company evidence by investment dimension
        </h4>
        <p className="cq-caption gq-t2 mb-3">
          Claims, estimates and their recorded evidence are shown separately.
        </p>
        {dossier.dimensions.length === 0 ? (
          <p className="cq-body-sm gq-t2">
            No investment-dimension claims were recorded.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {dossier.dimensions.map((group) => (
              <section key={group.group} aria-label={group.label}>
                <h5 className="cq-label">{group.label}</h5>
                <ul className="gq-hair">
                  {group.facts.map((fact) => (
                    <li key={fact.dimension} className="py-3">
                      <h6 className="cq-body-sm font-medium">{fact.label}</h6>
                      <p className="cq-body-sm whitespace-pre-wrap break-words">
                        {fact.summary}
                      </p>
                      <dl className="cq-caption gq-t2 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <div>
                          <dt className="inline">Origin: </dt>
                          <dd className="inline">
                            {PROVENANCE[fact.provenance]}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline">Truth: </dt>
                          <dd className="inline">{TRUTH[fact.truthClass]}</dd>
                        </div>
                        <div>
                          <dt className="inline">Evidence: </dt>
                          <dd className="inline">
                            {EVIDENCE[fact.evidenceStatus]}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {hasSupportedClaims ? (
          <p className="cq-caption gq-t2 mt-3">
            Document support is recorded for some claims. Exact document, page
            or section references are not available in this brief.
          </p>
        ) : null}
      </section>

      <section
        className="gq-sect"
        aria-label="Evidence gaps and contradictions"
      >
        <h4 className="cq-title-sm">Evidence gaps and contradictions</h4>
        <div className="flex flex-col gap-3">
          {(
            [
              ["Unknown", dossier.unknowns],
              ["Founder declined", dossier.declined],
            ] as const
          ).map(([label, gaps]) =>
            gaps.length === 0 ? null : (
              <div key={label}>
                <h5 className="cq-label">{label}</h5>
                <ul className="cq-body-sm">
                  {gaps.map((gap) => (
                    <li key={gap.dimension}>{gap.label}</li>
                  ))}
                </ul>
              </div>
            ),
          )}
          {dossier.missing.length === 0 ? null : (
            <div>
              <h5 className="cq-label">Missing information</h5>
              <ul className="cq-body-sm flex flex-col gap-1">
                {dossier.missing.map((gap) => (
                  <li key={gap.dimension}>
                    {gap.label}
                    <span className="cq-caption gq-t2 block">
                      {REASON[gap.reason]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dossier.contradictions.length === 0 ? null : (
            <div>
              <h5 className="cq-label">Conflicting answers</h5>
              <ul className="cq-body-sm flex flex-col gap-1">
                {dossier.contradictions.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {dossier.unknowns.length +
            dossier.declined.length +
            dossier.missing.length +
            dossier.contradictions.length ===
          0 ? (
            <p className="cq-body-sm gq-t2">
              No gaps or contradictions were recorded. This does not establish
              independent verification.
            </p>
          ) : null}
        </div>
      </section>

      <section className="gq-sect" aria-label="Submitted diligence questions">
        <h4 className="cq-title-sm">Questions for diligence</h4>
        {dossier.diligenceQuestions.length === 0 ? (
          <p className="cq-body-sm gq-t2">
            No diligence questions were recorded.
          </p>
        ) : (
          <ol className="flex flex-col gap-3 cq-body-sm">
            {dossier.diligenceQuestions.map((question, index) => (
              <li key={index}>
                <span className="cq-caption gq-t2 block">
                  {BASIS[question.basis]}
                </span>
                {question.question}
              </li>
            ))}
          </ol>
        )}
        <p className="cq-caption gq-t2 mt-3">
          Q investment synthesis has not been recorded for this submission.
        </p>
      </section>
    </section>
  );
}

/** The submitted snapshot's ordered transcript; no current draft conversation. */
export function SubmittedTranscript({
  turns,
  recordedTurnCount,
}: {
  readonly turns: readonly ApplicationTranscriptTurnDto[] | null | undefined;
  readonly recordedTurnCount?: number | undefined;
}) {
  if (turns === null || turns === undefined)
    return (
      <section className="gq-sect">
        <h3 className="cq-title-sm">Interview transcript</h3>
        <p className="cq-body-sm gq-t2">
          {recordedTurnCount !== undefined && recordedTurnCount > 0
            ? `This submission records ${recordedTurnCount} interview turns. The transcript is unavailable in this response.`
            : "No interview transcript was included in this submission."}
        </p>
      </section>
    );
  if (turns.length === 0)
    return (
      <section className="gq-sect">
        <h3 className="cq-title-sm">Interview transcript</h3>
        <p className="cq-body-sm gq-t2">
          The submitted interview contains no turns.
        </p>
      </section>
    );
  return (
    <details className="gq-sect group">
      <summary className="cq-title-sm min-h-11 cursor-pointer py-2">
        Interview transcript · {turns.length} turns
      </summary>
      <p className="cq-caption gq-t2 mb-3">
        The founder&apos;s interview exactly as submitted. Claims and Q&apos;s
        questions retain their original wording.
      </p>
      <ol
        className="flex flex-col gap-4"
        aria-label="Submitted interview transcript"
      >
        {turns.map((turn) => (
          <li
            key={turn.seq}
            className="border-l border-(--cq-border-subtle) pl-3"
          >
            <p className="cq-caption gq-t2 mb-1">
              {turn.role === "PERSON" ? "Founder" : "Q"} · Turn {turn.seq} ·{" "}
              <time dateTime={turn.at}>{dateWords(turn.at)} UTC</time>
            </p>
            <p className="cq-body-sm whitespace-pre-wrap break-words">
              {turn.text}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}
