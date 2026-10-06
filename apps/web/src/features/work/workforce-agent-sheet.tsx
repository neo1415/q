"use client";

import type { WorkforceJobDetailDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Button } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { AgentRing, StateLabel } from "./workforce-map";
import type { AgentNode } from "./workforce-agents";
import { ApproveButton } from "./workforce-panel";
import { dollars, jobLines, type StepState } from "./workforce-view";

/**
 * One specialist, opened from the map or the list (P7): what it is doing
 * or waiting on, in plain words; the decision it needs, inline (approve
 * binds to the exact draft text shown, through the Approval Engine); and
 * what happened on its job so far. A side panel on a desktop, a bottom
 * sheet on a phone.
 */

const DOT: Readonly<Record<StepState, string>> = {
  done: "border-(--cq-positive) bg-(--cq-positive)",
  run: "border-(--cq-accent) bg-(--cq-surface-raised)",
  back: "border-(--cq-warning) bg-(--cq-surface-raised)",
  you: "border-(--cq-accent) bg-(--cq-accent)",
  wait: "border-dashed border-(--cq-border-strong) bg-(--cq-surface-raised)",
};
const DOT_WORDS: Readonly<Record<StepState, string>> = {
  done: "Done",
  run: "Working",
  back: "Sent back",
  you: "Needs you",
  wait: "Waiting",
};

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function AgentSheet({
  node,
  job,
  since,
  onClose,
  onReadDraft,
  onGoTo,
  onDecided,
}: {
  readonly node: AgentNode | null;
  readonly job: WorkforceJobDetailDto | null;
  /** "4 min ago", from the page's clock. */
  readonly since: string | null;
  readonly onClose: () => void;
  readonly onReadDraft: (job: WorkforceJobDetailDto, draftId: string) => void;
  readonly onGoTo: (view: "cost" | "progress") => void;
  readonly onDecided: () => void;
}) {
  const draft =
    node?.draftId == null || job === null
      ? undefined
      : job.drafts.find((one) => one.id === node.draftId);
  const lines =
    job === null
      ? []
      : jobLines(job)
          .filter((line) => line.kind === "step")
          .slice(-8);

  return (
    <SheetRoot
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {node === null ? null : (
        <SheetContent
          side="side"
          title={node.name}
          className="flex flex-col"
        >
          <div className="flex flex-col gap-4 pb-4" data-agent-sheet={node.role}>
            <div className="flex items-center gap-3.5">
              <AgentRing node={node} size={44} />
              <StateLabel node={node} className="text-[14px]" />
            </div>

            <Callout node={node} />

            {draft === undefined ? null : (
              <div className="rounded-[12px] border border-(--cq-border) bg-(--cq-surface) px-3.5 py-3 text-[14px] whitespace-pre-line">
                {draft.counterpartName === null ? null : (
                  <span className="mb-1 block text-[12.5px] text-(--cq-text-tertiary)">
                    To {draft.counterpartName} · draft {draft.attempt}
                  </span>
                )}
                {draft.body}
              </div>
            )}

            <Actions
              node={node}
              job={job}
              onClose={onClose}
              onReadDraft={onReadDraft}
              onGoTo={onGoTo}
              onDecided={onDecided}
            />

            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
              <dt className="text-(--cq-text-tertiary)">Job</dt>
              <dd className="m-0 text-right">{node.job ?? "—"}</dd>
              <dt className="text-(--cq-text-tertiary)">Since</dt>
              <dd className="cq-numeric m-0 text-right" suppressHydrationWarning>
                {since ?? "—"}
              </dd>
              <dt className="text-(--cq-text-tertiary)">Runs today</dt>
              <dd className="cq-numeric m-0 text-right">{node.runs}</dd>
              <dt className="text-(--cq-text-tertiary)">This month</dt>
              <dd className="cq-numeric m-0 text-right">{dollars(node.monthUsd)}</dd>
            </dl>

            {lines.length === 0 ? null : (
              <section aria-labelledby="agent-sheet-log">
                <h3 id="agent-sheet-log" className="mb-1.5 text-[14px] font-semibold">
                  What happened
                </h3>
                <ol className="m-0 list-none p-0">
                  {lines.map((line, index) =>
                    line.kind === "step" ? (
                      <li
                        key={line.key}
                        className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2.5 py-1.5 text-[13.5px]"
                      >
                        {index === lines.length - 1 ? null : (
                          <span aria-hidden="true" className="absolute top-[22px] -bottom-2 left-2 w-px bg-(--cq-border-subtle)" />
                        )}
                        <span
                          className={cx("mt-[5px] ml-1 h-2.5 w-2.5 rounded-full border-2", DOT[line.state])}
                        >
                          <span className="sr-only">{DOT_WORDS[line.state]}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="text-(--cq-text-tertiary)">{line.who}: </span>
                          {line.title}
                        </span>
                        <time
                          className="cq-numeric text-[12.5px] text-(--cq-text-tertiary)"
                          dateTime={line.at ?? undefined}
                          suppressHydrationWarning
                        >
                          {line.at === null ? (line.state === "you" ? "now" : "") : clock(line.at)}
                        </time>
                      </li>
                    ) : null,
                  )}
                </ol>
              </section>
            )}
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}

function Callout({ node }: { readonly node: AgentNode }) {
  const tone =
    node.state === "asking"
      ? "bg-(--cq-accent-soft)"
      : node.state === "held"
        ? "bg-(--cq-warning-soft)"
        : node.state === "failed"
          ? "bg-(--cq-danger-soft)"
          : "bg-(--cq-surface-subtle)";
  let lead: string | null = null;
  switch (node.state) {
    case "asking":
      lead = "Nothing is sent until you approve this exact text.";
      break;
    case "held":
      lead = "Q didn’t send it.";
      break;
    case "failed":
      lead = "This step didn’t finish.";
      break;
    case "working":
    case "thinking":
      lead = "Doing now:";
      break;
    case "paused":
      lead =
        node.pause === "budget"
          ? "Paused at your monthly limit. Nothing is lost."
          : node.pause === "hours"
            ? "Outside your working hours. It picks up when they start."
            : "You paused it.";
      break;
    case "waiting":
    case "done":
    case "idle":
      lead = null;
      break;
  }
  return (
    <p className={cx("m-0 rounded-[12px] px-3.5 py-3 text-[14px]", tone)}>
      {lead === null ? null : <b className="font-semibold">{lead} </b>}
      {node.now}
    </p>
  );
}

function Actions({
  node,
  job,
  onClose,
  onReadDraft,
  onGoTo,
  onDecided,
}: {
  readonly node: AgentNode;
  readonly job: WorkforceJobDetailDto | null;
  readonly onClose: () => void;
  readonly onReadDraft: (job: WorkforceJobDetailDto, draftId: string) => void;
  readonly onGoTo: (view: "cost" | "progress") => void;
  readonly onDecided: () => void;
}) {
  const read =
    job !== null && node.draftId !== null ? (
      <Button
        variant="secondary"
        onClick={() => {
          if (node.draftId !== null) onReadDraft(job, node.draftId);
        }}
      >
        {node.state === "held" ? "Read the drafts" : "Compare drafts"}
      </Button>
    ) : null;
  if (node.state === "asking" && node.approval !== null) {
    return (
      <div className="flex flex-wrap gap-2">
        <ApproveButton approvalId={node.approval.approvalId} onDone={onDecided} />
        {read}
        <Button variant="quiet" onClick={onClose}>
          Not now
        </Button>
      </div>
    );
  }
  if (node.state === "held") return read === null ? null : <div className="flex flex-wrap gap-2">{read}</div>;
  if (node.state === "paused" && node.pause === "budget") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onGoTo("cost")}>
          See the limit
        </Button>
      </div>
    );
  }
  if (node.state === "paused" && node.pause === "you") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onGoTo("progress")}>
          Resume it in In progress
        </Button>
      </div>
    );
  }
  return null;
}
