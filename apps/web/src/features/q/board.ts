import type { QTurn, QTurnObjectBlock } from "./conversation";

/**
 * The Board (ADR 0017 F3; spec §7.1): every answer Q gives lands as typed
 * objects -- a note for what it said, and one object per thing it
 * referred to or made -- newest first, with the ones the person pinned on
 * top. A pure projection of the conversation's turns, so what the Board
 * shows is exactly what the server sent, and it is tested without a
 * browser.
 *
 * What is NOT an object here: a question Q asks back (CLARIFICATION_REQUEST)
 * and an approval waiting on the person (ACTION_PROPOSAL, the run's
 * approval). Those need the person, so they live in "Now / Needs you",
 * with the exact payload, once.
 */

export type BoardObjectKind =
  "NOTE" | "COMPANIES" | "INVESTORS" | "COMPARISON" | "ARTIFACT" | "INTENT";

export type BoardObject = {
  /** Stable across renders: the turn and the object's place in it. */
  readonly key: string;
  readonly kind: BoardObjectKind;
  /** The answer this came from. */
  readonly turn: Extract<QTurn, { kind: "Q" }>;
  /** What the person said that produced it, when there was a question. */
  readonly question: string | undefined;
  /** The blocks behind it (none for a note). */
  readonly blocks: readonly QTurnObjectBlock[];
};

export function boardObjects(turns: readonly QTurn[]): BoardObject[] {
  const objects: BoardObject[] = [];
  let question: string | undefined;
  for (const turn of turns) {
    if (turn.kind === "PERSON") {
      question = turn.text;
      continue;
    }
    // An answer still arriving is on the stage; it lands here once whole.
    if (turn.streaming) continue;
    const at = objects.length;
    const add = (
      kind: BoardObjectKind,
      suffix: string,
      blocks: readonly QTurnObjectBlock[],
    ) => {
      objects.push({
        key: `${turn.id}:${suffix}`,
        kind,
        turn,
        question,
        blocks,
      });
    };
    if (turn.text.trim().length > 0) add("NOTE", "note", []);
    const companies = turn.blocks.filter(
      (block) => block.kind === "COMPANY_REFERENCE",
    );
    if (companies.length > 0) add("COMPANIES", "companies", companies);
    const investors = turn.blocks.filter(
      (block) => block.kind === "INVESTOR_REFERENCE",
    );
    if (investors.length > 0) add("INVESTORS", "investors", investors);
    turn.blocks.forEach((block, index) => {
      if (block.kind === "COMPARISON") {
        add("COMPARISON", `comparison-${String(index)}`, [block]);
      } else if (block.kind === "ARTIFACT_REFERENCE") {
        add("ARTIFACT", `artifact-${block.artifactId}`, [block]);
      } else if (block.kind === "UI_INTENT") {
        add("INTENT", `intent-${String(index)}`, [block]);
      }
    });
    // Newest first: this answer's objects go ahead of the earlier ones,
    // in the order the answer gave them.
    const mine = objects.splice(at);
    objects.unshift(...mine);
  }
  return objects;
}

/** Pinned objects first, in the order they were pinned; dismissed ones gone. */
export function arrangeBoard(
  objects: readonly BoardObject[],
  pinned: readonly string[],
  dismissed: readonly string[],
): BoardObject[] {
  const shown = objects.filter((object) => !dismissed.includes(object.key));
  const byKey = new Map(shown.map((object) => [object.key, object]));
  const top = pinned.flatMap((key) => {
    const object = byKey.get(key);
    return object === undefined ? [] : [object];
  });
  return [...top, ...shown.filter((object) => !pinned.includes(object.key))];
}

/** What waits on the person from the latest answer: Q's questions back. */
export function openQuestions(
  turns: readonly QTurn[],
): readonly Extract<QTurnObjectBlock, { kind: "CLARIFICATION_REQUEST" }>[] {
  const latest = turns.findLast((turn) => turn.kind === "Q");
  if (latest === undefined || latest.kind !== "Q" || latest.streaming) {
    return [];
  }
  // A question the person has since answered is not open.
  const latestAt = turns.indexOf(latest);
  if (turns.slice(latestAt + 1).some((turn) => turn.kind === "PERSON")) {
    return [];
  }
  return latest.blocks.filter(
    (
      block,
    ): block is Extract<QTurnObjectBlock, { kind: "CLARIFICATION_REQUEST" }> =>
      block.kind === "CLARIFICATION_REQUEST",
  );
}
