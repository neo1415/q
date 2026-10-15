import type { ReactNode } from "react";

import type { RaiseWords } from "./raise-words";

/**
 * A raise as one reader may see it: the amount, then where it came from
 * in plain words ("Disclosed raise", "From their pitch"). The same element
 * on the Discover card and the profile; the label is text, never colour
 * alone. `source` may wrap the label (the profile links it to the moment
 * in the pitch).
 */
export function RaiseFact({
  words,
  source,
}: {
  readonly words: RaiseWords;
  readonly source?: (label: string) => ReactNode;
}) {
  if (words.amount === null) {
    return (
      <span className="text-(--cq-text-secondary)" data-raise-fact="NONE">
        {words.label}
      </span>
    );
  }
  return (
    <span data-raise-fact={words.source}>
      <span title={words.exact ?? undefined} data-raise-amount>
        {words.amount}
      </span>{" "}
      <span
        className="cq-caption block font-normal text-(--cq-text-secondary)"
        data-raise-label
      >
        {source === undefined ? words.label : source(words.label)}
      </span>
    </span>
  );
}
