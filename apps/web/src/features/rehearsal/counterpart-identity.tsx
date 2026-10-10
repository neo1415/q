import type { ExternalSimulationDto } from "@capital-q/contracts";

import { initialsOf } from "./meet";

/**
 * Who the founder is rehearsing with, for a researched external entity: the
 * permitted portrait or official logo (our own stored asset only), else a
 * monogram; the name, role or category and one sourced line; a small
 * "Research-informed simulation" chip; and a quiet sources/details control.
 * Semantic tokens only. Without a simulation (a connected investor or
 * company) it is the plain initials as before.
 */

export type IdentitySize = "stage" | "card";

export function CounterpartMark({
  name,
  simulation,
  size,
}: {
  readonly name: string;
  readonly simulation: ExternalSimulationDto | undefined;
  readonly size: IdentitySize;
}) {
  const box =
    size === "stage"
      ? "size-20 sm:size-28 text-3xl sm:text-4xl"
      : "size-28 text-4xl";
  // Organisations and agencies sit in a rounded square (a logo's shape);
  // people in a circle.
  const shape =
    simulation?.entityKind === undefined || simulation.entityKind === "PERSON"
      ? "rounded-(--cq-radius-full)"
      : "rounded-(--cq-radius-lg)";
  if (simulation?.imageUrl) {
    return (
      // Our stored asset: an <img> keeps it a direct CDN read, never proxied.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={simulation.imageUrl}
        alt={`${name}`}
        width={112}
        height={112}
        decoding="async"
        referrerPolicy="no-referrer"
        className={`${box} ${shape} bg-(--cq-stage-surface-strong) object-cover`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`${box} ${shape} flex items-center justify-center border border-(--cq-stage-text-muted) bg-(--cq-stage-surface-strong) font-medium tracking-tight text-(--cq-stage-text)`}
    >
      {initialsOf(name)}
    </div>
  );
}

export function SimulationChip({
  simulation,
}: {
  readonly simulation: ExternalSimulationDto;
}) {
  return (
    <span className="cq-caption inline-flex w-fit items-center rounded-(--cq-radius-full) border border-(--cq-stage-text-muted) px-2 py-0.5 text-(--cq-stage-text-muted)">
      {simulation.label}
    </span>
  );
}

/** The sources and details control: the label in full, sources, public quotes. */
export function SimulationDetails({
  simulation,
}: {
  readonly simulation: ExternalSimulationDto;
}) {
  const sources = simulation.sources ?? [];
  const quotes = simulation.quotes ?? [];
  return (
    <details className="cq-caption text-(--cq-stage-text-muted)">
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline-offset-2 hover:underline">
        Sources and details
      </summary>
      <div className="mt-1 flex max-w-sm flex-col gap-2 text-left">
        <p>{simulation.disclaimer}</p>
        {quotes.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {quotes.map((quote) => (
              <li key={quote.sourceUrl}>
                <span>Public quote (not Q’s words): “{quote.quote}” </span>
                <a
                  href={quote.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {quote.sourceLabel}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {sources.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

/** The left-side identity: mark, name, role or category, one line, chip, details. */
export function CounterpartIdentity({
  name,
  simulation,
}: {
  readonly name: string;
  readonly simulation: ExternalSimulationDto;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <CounterpartMark name={name} simulation={simulation} size="card" />
      <p className="cq-title-md text-(--cq-stage-text)">{name}</p>
      {simulation.headline ? (
        <p className="cq-body-sm text-(--cq-stage-text-muted)">
          {simulation.headline}
        </p>
      ) : null}
      {simulation.description ? (
        <p className="cq-caption line-clamp-2 max-w-sm text-(--cq-stage-text-muted)">
          {simulation.description}
        </p>
      ) : null}
      <SimulationChip simulation={simulation} />
      <SimulationDetails simulation={simulation} />
    </div>
  );
}
