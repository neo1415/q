import type { Metadata } from "next";
import Link from "next/link";

import { getQWorkReport } from "@capital-q/api-client";
import type { QWorkReportDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { qApiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "First-stage report" };

const VERDICT = {
  PROCEED: "Q suggests you proceed",
  MAYBE: "Q is unsure",
  PASS: "Q suggests you pass",
} as const;

/**
 * The first-stage interview report (AUTO, ADR 0030; spec auto.md §3.1):
 * the verdict first, then how it went, strengths and concerns each
 * labelled as the founder's claim or Q's inference, open questions, and
 * the interview word for word. Downloadable as a PDF.
 */
export default async function WorkReportPage({
  params,
}: {
  readonly params: Promise<{ delegationId: string; laneId: string }>;
}) {
  const { delegationId, laneId } = await params;
  const session = await qApiSession();
  let report: QWorkReportDto | null = null;
  if (session !== null) {
    report = await getQWorkReport(session, delegationId, laneId).catch(
      () => null,
    );
  }
  if (report === null) {
    return (
      <PageContainer width="reading">
        <PageHeader title="First-stage report" />
        <ErrorState
          title="This report isn't available"
          description="It may not be written yet, or it isn't yours."
          action={
            <Link
              href="/work"
              className="cq-body-sm underline underline-offset-4"
            >
              Open Q&rsquo;s work
            </Link>
          }
        />
      </PageContainer>
    );
  }
  const basis = (value: "CLAIM" | "INFERENCE") =>
    value === "CLAIM" ? "Their claim, not verified" : "Q's inference";
  return (
    <PageContainer width="reading">
      <PageHeader title={report.counterpartName} description={report.headline}>
        <a
          href={`/api/q-work-report/${delegationId}/${laneId}`}
          className={buttonClassName("secondary", "compact")}
        >
          Download PDF
        </a>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <PageSection id="verdict" title={VERDICT[report.recommendation]}>
          <p className="cq-body text-(--cq-text-primary)">{report.why}</p>
        </PageSection>
        <PageSection id="how" title="How it went">
          <p className="cq-body text-(--cq-text-primary)">{report.howItWent}</p>
        </PageSection>
        {[
          { id: "strengths", title: "Strengths", items: report.strengths },
          { id: "concerns", title: "Concerns", items: report.concerns },
        ].map((group) => (
          <PageSection key={group.id} id={group.id} title={group.title}>
            {group.items.length === 0 ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                None stated.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <li key={item.point} className="flex flex-col gap-0.5">
                    <span className="cq-body text-(--cq-text-primary)">
                      {item.point}
                    </span>
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {basis(item.basis)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>
        ))}
        {report.openQuestions.length === 0 ? null : (
          <PageSection id="open" title="Ask next">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {report.openQuestions.map((question) => (
                <li key={question} className="cq-body text-(--cq-text-primary)">
                  {question}
                </li>
              ))}
            </ul>
          </PageSection>
        )}
        <PageSection id="interview" title="The interview">
          <dl className="flex flex-col gap-4">
            {report.interview.map((item) => (
              <div key={item.question} className="flex flex-col gap-1">
                <dt className="cq-body-sm font-medium text-(--cq-text-primary)">
                  {item.question}
                </dt>
                <dd className="cq-body whitespace-pre-line text-(--cq-text-secondary)">
                  {item.answer}
                  {item.byQ ? (
                    <span className="cq-caption block text-(--cq-text-tertiary)">
                      Answered by their Q, standing in from their approved brief
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </PageSection>
        <p className="cq-caption text-(--cq-text-tertiary)">
          Written by Q from a chat interview it ran for you. What the founder
          said is their own claim; nothing here is verified, and it is not
          investment advice.
        </p>
        <Link
          href="/work"
          className="cq-body-sm inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Back to Q&rsquo;s work
        </Link>
      </div>
    </PageContainer>
  );
}
