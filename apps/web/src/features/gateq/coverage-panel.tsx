"use client";

import type { ApplicationCoverageDto } from "@capital-q/contracts";
import { ChevronDown } from "@capital-q/ui/icons";

import { coveragePanelModel } from "./coverage-panel-model";

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="cq-label text-(--cq-text-primary)">{title}</h3>
      {children}
    </div>
  );
}

/**
 * The live "What we have / What's still needed" beside the interview
 * (directive C2). It re-renders from the server's coverage check, which the
 * page re-reads after every completed turn, so a line appears here only once
 * the fact is durably recorded. Restrained on purpose: plain lists, no
 * progress bar or percentage (a number would read as a score).
 */
export function CoveragePanel({
  coverage,
  fund,
}: {
  readonly coverage: ApplicationCoverageDto;
  readonly fund: string;
}) {
  const model = coveragePanelModel(coverage, fund);
  const content = (
    <div className="flex flex-col gap-4">
      <p role="status" className="cq-caption text-(--cq-text-tertiary)">
        {model.status}
      </p>
      <Section title="What we have">
        {model.have.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Nothing recorded yet. Answers appear here once they are saved.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-coverage-have>
            {model.have.map((item) => (
              <li key={item.dimension} className="cq-body-sm">
                <span className="text-(--cq-text-primary)">{item.label}</span>
                <span className="block text-(--cq-text-secondary)">
                  {item.summary.length > 140
                    ? `${item.summary.slice(0, 139)}…`
                    : item.summary}
                </span>
                <span className="cq-caption block text-(--cq-text-tertiary)">
                  {item.source}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="What's still needed">
        {model.needed.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Nothing outstanding for {fund}&apos;s published mandate.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-coverage-needed>
            {model.needed.map((item) => (
              <li key={item.dimension} className="cq-body-sm">
                <span className="text-(--cq-text-primary)">
                  {item.label}
                  {item.required ? (
                    <span className="text-(--cq-text-secondary)">
                      {" "}
                      · required
                    </span>
                  ) : null}
                </span>
                <span className="cq-caption block text-(--cq-text-tertiary)">
                  {item.why}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {model.conflicts.length === 0 ? null : (
        <Section title="To clarify">
          <ul className="cq-body-sm flex flex-col gap-1 text-(--cq-text-secondary)">
            {model.conflicts.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      )}
      {model.evidenceFollowUps.length === 0 ? null : (
        <Section title="A document would support">
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {model.evidenceFollowUps.join(", ")}. These stay your stated claims
            until evidence is shared.
          </p>
        </Section>
      )}
      {model.notKnown.length + model.declined.length === 0 ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">
          {[
            model.notKnown.length === 0
              ? null
              : `Not known yet: ${model.notKnown.join(", ")}.`,
            model.declined.length === 0
              ? null
              : `Preferred not to say: ${model.declined.join(", ")}.`,
          ]
            .filter((line) => line !== null)
            .join(" ")}{" "}
          Unknown is never counted as a no.
        </p>
      )}
    </div>
  );
  return (
    <aside
      aria-label="What we have, what's still needed"
      className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-4 lg:border-t-0 lg:border-s lg:pt-0 lg:ps-6"
      data-coverage-panel
    >
      {/* Phones and tablets: folded under the conversation, one tap away. */}
      <details className="group lg:hidden">
        <summary className="cq-title-sm flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-(--cq-text-primary) [&::-webkit-details-marker]:hidden">
          What we have, what&apos;s still needed
          <ChevronDown
            size={18}
            aria-hidden="true"
            className="shrink-0 transition-transform duration-(--cq-motion-fast) group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="pt-2">{content}</div>
      </details>
      <div className="max-lg:hidden">
        <h2 className="cq-title-sm mb-3 text-(--cq-text-primary)">
          What we have, what&apos;s still needed
        </h2>
        {content}
      </div>
    </aside>
  );
}
