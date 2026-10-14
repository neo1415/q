import type { GateqDossierV1, GateqInboxDetailDto } from "@capital-q/contracts";

/** Read the immutable received snapshot; this view never generates or rewrites evidence. */
export function DossierView({
  detail,
}: {
  readonly detail: Pick<GateqInboxDetailDto, "dossier" | "transcript">;
}) {
  const dossier: GateqDossierV1 | null | undefined = detail.dossier;
  if (dossier === undefined || dossier === null) return null;
  const gaps: readonly {
    readonly label: string;
    readonly entries: readonly {
      readonly dimension: string;
      readonly label: string;
    }[];
  }[] = [
    { label: "Unknown", entries: dossier.unknowns },
    { label: "Declined", entries: dossier.declined },
    { label: "Missing evidence or answers", entries: dossier.missing },
  ];
  return (
    <section
      className="gq-sect flex flex-col gap-5"
      aria-label="Received investment dossier"
    >
      <header>
        <h3 className="cq-title-sm">Investment dossier as submitted</h3>
        <p className="cq-caption gq-t3">
          {dossier.schemaVersion} · {dossier.application.reference} · Received{" "}
          {dossier.application.submittedAt}. Deterministic preparation; the
          investment decision remains yours.
        </p>
      </header>
      {dossier.dimensions.map((group) =>
        group.facts.length === 0 ? null : (
          <section key={group.group}>
            <h4 className="cq-label">{group.label}</h4>
            <dl className="flex flex-col gap-3 pt-2">
              {group.facts.map((fact) => (
                <div key={fact.dimension}>
                  <dt className="cq-body-sm font-medium">{fact.label}</dt>
                  <dd className="cq-body-sm whitespace-pre-wrap">
                    {fact.summary}
                  </dd>
                  <dd className="cq-caption gq-t3">
                    {fact.truthClass.replaceAll("_", " ").toLowerCase()} ·{" "}
                    {fact.evidenceStatus.replaceAll("_", " ").toLowerCase()} ·
                    source: {fact.provenance}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ),
      )}
      {gaps.map(({ label, entries }) =>
        entries.length === 0 ? null : (
          <section key={label}>
            <h4 className="cq-label">{label}</h4>
            <ul className="cq-body-sm">
              {entries.map((entry) => (
                <li key={entry.dimension}>{entry.label}</li>
              ))}
            </ul>
          </section>
        ),
      )}
      {dossier.contradictions.length === 0 ? null : (
        <section>
          <h4 className="cq-label">Contradictions</h4>
          <ul className="cq-body-sm">
            {dossier.contradictions.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      {dossier.diligenceQuestions.length === 0 ? null : (
        <section>
          <h4 className="cq-label">Priority diligence questions</h4>
          <ol className="list-decimal pl-5 cq-body-sm">
            {dossier.diligenceQuestions.map((item, index) => (
              <li key={`${item.dimension}-${index}`} className="py-1">
                {item.question}
                <span className="cq-caption gq-t3">
                  {" "}
                  · {item.basis.toLowerCase()}
                  {item.dimension ? `: ${item.dimension}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <details>
        <summary className="cq-label cursor-pointer">
          Submitted interview transcript (
          {detail.transcript?.length ?? dossier.transcript.turnCount} turns)
        </summary>
        {detail.transcript === null || detail.transcript === undefined ? (
          <p className="cq-body-sm gq-t2">
            This submission has no available transcript.
          </p>
        ) : (
          <div className="flex max-h-96 flex-col gap-3 overflow-auto py-3">
            {detail.transcript.map((turn) => (
              <article key={turn.seq}>
                <b className="cq-label">
                  {turn.role === "Q" ? "Q" : "Applicant"} · {turn.seq}
                </b>
                <p className="cq-body-sm whitespace-pre-wrap break-words">
                  {turn.text}
                </p>
              </article>
            ))}
          </div>
        )}
      </details>
      <details>
        <summary className="cq-label cursor-pointer">
          Source documents ({dossier.documents.length})
        </summary>
        <ul className="cq-body-sm py-2">
          {dossier.documents.map((document) => (
            <li key={document.documentId}>
              {document.title}
              <span className="block cq-caption gq-t3">
                Source ID: {document.documentId}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
