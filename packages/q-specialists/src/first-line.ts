/**
 * HQ-1 (conversation audit §2.2, playbook target: the first line within a
 * second): a typed turn shows a line within FIRST_LINE_BUDGET_MS of being
 * accepted, whatever the reading is doing. The line is a holding line: it
 * names no one and claims nothing (true of whatever the reading decides),
 * is never stored, and the answer's own words replace it. The skim's named
 * line ("Looking into Nixo now.") replaces it when the skim lands.
 *
 * Nothing is said when something already was (a holding line on arrival,
 * the skim's named line) or when the turn is decided first (the reading
 * landed, a fast lane answered, the turn ended).
 */

export const FIRST_LINE_BUDGET_MS = 1_000;

export type FirstLineBudget = {
  /** Something was said or decided: the budget's line is no longer needed. */
  readonly cancel: () => void;
};

export function startFirstLineBudget(input: {
  readonly say: () => void;
  readonly budgetMs?: number | undefined;
  /** Injectable for tests (fake timers work with the default too). */
  readonly setTimer?:
    | ((run: () => void, ms: number) => { readonly clear: () => void })
    | undefined;
}): FirstLineBudget {
  const setTimer =
    input.setTimer ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return { clear: () => clearTimeout(timer) };
    });
  let done = false;
  const timer = setTimer(() => {
    if (done) return;
    done = true;
    input.say();
  }, input.budgetMs ?? FIRST_LINE_BUDGET_MS);
  return {
    cancel: () => {
      if (done) return;
      done = true;
      timer.clear();
    },
  };
}
