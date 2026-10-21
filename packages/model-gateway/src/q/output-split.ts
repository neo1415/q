/**
 * Turn latency round 5: where an answer's output goes. The answer model
 * writes one object; its time is its length (about 100 tokens a second),
 * so knowing which parts are long says what to make cheaper. Counts only,
 * never content: characters of the JSON each part takes, with the rest
 * (keys, flags, the other fields) as `other`.
 */
export type OutputSplit = {
  readonly total: number;
  readonly answer: number;
  readonly findings: number;
  /** Of the findings: their free-text `basis`. */
  readonly findingsBasis: number;
  readonly cards: number;
  readonly gestures: number;
  readonly other: number;
};

const size = (value: unknown): number =>
  value === undefined || value === null ? 0 : JSON.stringify(value).length;

export function outputSplitOf(
  value: Readonly<Record<string, unknown>>,
): OutputSplit {
  const total = size(value);
  const answer = size(value["answer"]);
  const findings = size(value["findings"]);
  const list = Array.isArray(value["findings"]) ? value["findings"] : [];
  const findingsBasis = list.reduce<number>(
    (sum, finding: unknown) =>
      sum +
      size(
        typeof finding === "object" && finding !== null
          ? (finding as { readonly basis?: unknown }).basis
          : undefined,
      ),
    0,
  );
  const cards = size(value["answerCards"]) + size(value["comparisonCards"]);
  const gestures = size(value["gestures"]);
  return {
    total,
    answer,
    findings,
    findingsBasis,
    cards,
    gestures,
    other: Math.max(0, total - answer - findings - cards - gestures),
  };
}
