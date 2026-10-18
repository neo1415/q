import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminQRun } from "@capital-q/api-client";
import { EmptyState, InlineNotice } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { RunBreakGlass } from "@/features/admin/run-break-glass";
import { usd, when, words } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Q run · Admin") };
}

/**
 * One Q run, step by step: stages, every model call, every firewall
 * decision. Q's words are redacted unless the viewer holds an approved
 * break-glass for this run; that read is logged by the API.
 */
export default async function AdminQRunPage({
  params,
}: {
  readonly params: Promise<{ readonly runId: string }>;
}) {
  const t = await serverT();

  const context = await adminContext();
  if (context === null || !context.can("q.trace.read")) notFound();
  const { runId } = await params;
  const trace = await getAdminQRun(context.session, runId).catch(() => null);
  if (trace === null) notFound();
  const { run } = trace;
  const facts = [
    { term: "Asked by", value: run.userName ?? "A member" },
    { term: "Capability", value: words(run.capability) },
    { term: "Consequence", value: words(run.consequenceClass) },
    {
      term: "Status",
      value: `${words(run.status)}${run.failureCode === null ? "" : ` · ${words(run.failureCode)}`}`,
    },
    { term: "Started", value: when(run.createdAt) },
    { term: "Finished", value: when(run.completedAt) },
    { term: "Prompt bundle", value: run.versions.promptBundle ?? "Not stated" },
    { term: "Model policy", value: run.versions.modelPolicy ?? "Not stated" },
    { term: "Correlation", value: run.correlationId },
  ];
  return (
    <div className="flex flex-col gap-10">
      <PageSection id="run" title={t("Q run")}>
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.term} className="flex min-w-0 flex-col gap-1">
                <dt className="cq-caption text-(--cq-text-secondary)">
                  {t(fact.term)}
                </dt>
                <dd className="cq-body-sm break-all text-(--cq-text-primary)">
                  {t(fact.value)}
                </dd>
              </div>
            ))}
          </dl>
          {trace.redacted ? (
            <InlineNotice title={t("Words redacted")}>
              {t("What the person asked and what Q said are hidden.")}
              {context.can("breakglass.request") ? (
                <span className="mt-2 block">
                  <RunBreakGlass runId={run.runId} />
                </span>
              ) : null}
            </InlineNotice>
          ) : (
            <InlineNotice tone="warning" title={t("Private words shown")}>
              {t("Under an approved request until")}{" "}
              {t(when(trace.breakGlass?.expiresAt))}
              {t(". This read is logged.")}
              {run.objective === null ? null : (
                <span className="mt-2 block">
                  {t("Asked: “")}
                  {t(run.objective)}&rdquo;
                </span>
              )}
            </InlineNotice>
          )}
        </div>
      </PageSection>

      <PageSection id="firewall" title={t("Context firewall")}>
        {trace.firewall.length === 0 ? (
          <EmptyState
            compact
            title={t("No decision recorded")}
            description={t("Runs before the firewall log began have none.")}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {trace.firewall.map((decision, index) => (
              <li
                key={`${decision.at}-${String(index)}`}
                className="flex flex-col gap-1"
              >
                <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                  {decision.outcome === "AUTHORISED"
                    ? t("Allowed")
                    : t("Refused")}
                  {decision.reason === null
                    ? ""
                    : t(`: ${words(decision.reason)}`)}{" "}
                  · {t(when(decision.at))}
                </span>
                {decision.allowed.length === 0 ? null : (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {t("Allowed:")} {t(decision.allowed.map(words).join(", "))}
                  </span>
                )}
                {decision.denied.length === 0 ? null : (
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {t("Refused:")}{" "}
                    {t(
                      decision.denied
                        .map((d) => `${words(d.label)} (${words(d.reason)})`)
                        .join(", "),
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection id="calls" title={t("Model calls")}>
        {trace.calls.length === 0 ? (
          <EmptyState compact title={t("No model calls")} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="cq-body-sm w-full min-w-[40rem] text-start">
              <thead className="cq-caption text-(--cq-text-secondary)">
                <tr>
                  <th className="py-2 pe-4 font-normal">{t("Task")}</th>
                  <th className="py-2 pe-4 font-normal">{t("Model")}</th>
                  <th className="py-2 pe-4 text-end font-normal">{t("Try")}</th>
                  <th className="py-2 pe-4 text-end font-normal">
                    {t("Time")}
                  </th>
                  <th className="py-2 pe-4 text-end font-normal">
                    {t("Tokens in/out")}
                  </th>
                  <th className="py-2 pe-4 text-end font-normal">
                    {t("Cost")}
                  </th>
                  <th className="py-2 font-normal">{t("Outcome")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--cq-border-subtle) tabular-nums text-(--cq-text-primary)">
                {trace.calls.map((call, index) => (
                  <tr key={`${call.at}-${String(index)}`}>
                    <td className="py-2 pe-4">{t(words(call.taskClass))}</td>
                    <td className="py-2 pe-4">{t(call.model)}</td>
                    <td className="py-2 pe-4 text-end">{call.attempt}</td>
                    <td className="py-2 pe-4 text-end">
                      {t((call.latencyMs / 1000).toFixed(1))} s
                    </td>
                    <td className="py-2 pe-4 text-end">
                      {call.inputTokens} / {call.outputTokens}
                    </td>
                    <td className="py-2 pe-4 text-end">
                      {call.costUsd === null ? "—" : t(usd(call.costUsd))}
                    </td>
                    <td className="py-2">
                      {call.success
                        ? t("Succeeded")
                        : t(`Failed · ${words(call.errorCode)}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>

      <PageSection id="stages" title={t("Stages")}>
        {trace.events.length === 0 ? (
          <EmptyState compact title={t("No stage events")} />
        ) : (
          <ol className="flex flex-col gap-2">
            {trace.events.map((event) => (
              <li key={event.sequence} className="flex flex-col gap-0.5">
                <span className="cq-body-sm text-(--cq-text-primary)">
                  {event.sequence}. {t(words(event.type.replace(/^q\./, "")))}
                  {event.stage === null ? "" : t(` · ${words(event.stage)}`)}
                </span>
                {event.text === null ? null : (
                  <span className="cq-body-sm whitespace-pre-wrap text-(--cq-text-secondary)">
                    {event.text}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </PageSection>
    </div>
  );
}
