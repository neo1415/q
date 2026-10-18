# Evidence: packages/q-orchestrator/src/workforce/review-loop.ts lines 1-448

- Original path: `packages/q-orchestrator/src/workforce/review-loop.ts`
- Line range: 1-448 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Writer/reviewer loop: rubric weights, threshold 75, REVIEW_ROUNDS_MAX 2, near-miss handling, hold reasons. Complete module.

```ts
    1  import type {
    2    DraftIntegrityRuleV2,
    3    DraftRubricCriterion,
    4  } from "@capital-q/q-core";
    5
    6  /**
    7   * The writer → reviewer loop (founder brief J2, 2026-10-06).
    8   *
    9   * Every outward draft is graded before it can go anywhere. Code first
   10   * checks that it responds to what their latest message left open (thread
   11   * consistency); the reviewer (a model) scores each rubric criterion 0-5
   12   * and passes or fails each integrity rule; this code turns that into one
   13   * score, out of 100, by fixed weights, and decides. Below the bar, a
   14   * numbered fix list goes back to the writer for one redraft (two rounds
   15   * at most). Only a draft that passes comes out as PASSED; anything else
   16   * is HELD with the reason, for the person to see. An integrity or thread
   17   * failure is never averaged away, and a reviewer that cannot be reached
   18   * holds the draft: nothing outward goes ungraded.
   19   */
   20
   21  export const RUBRIC_VERSION = "workforce-rubric/v1" as const;
   22
   23  /** Weights out of 100. The person's own style counts as much as warmth. */
   24  export const RUBRIC_WEIGHTS: Readonly<Record<DraftRubricCriterion, number>> = {
   25    WARM_OPENING: 15,
   26    ASK_TIMING: 20,
   27    ANSWERS_THEM: 20,
   28    CONCISE_AND_CALM: 15,
   29    READS_SIGNALS: 15,
   30    PERSONAL_STYLE: 15,
   31  };
   32
   33  export type ReviewPolicy = {
   34    /** The least score, out of 100, a draft needs to pass. */
   35    readonly threshold: number;
   36    readonly maxRedrafts: number;
   37  };
   38
   39  /**
   40   * At most two rounds: the first draft and one redraft from the fix list
   41   * (Zino, 2026-10-08: "Draft 1 below the bar 6.0/7.5" over and over). A
   42   * draft that still misses after the second round is held with its reason,
   43   * whatever a job's stored `maxRedrafts` says.
   44   */
   45  export const REVIEW_ROUNDS_MAX = 2;
   46
   47  export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
   48    threshold: 75,
   49    maxRedrafts: REVIEW_ROUNDS_MAX - 1,
   50  };
   51
   52  /** The reviewer's sheet, as either prompt version returns it. */
   53  export type ReviewSheet = {
   54    readonly criteria: readonly {
   55      readonly criterion: DraftRubricCriterion;
   56      readonly score: number;
   57      readonly note: string;
   58    }[];
   59    readonly integrity: readonly {
   60      readonly rule: DraftIntegrityRuleV2;
   61      readonly ok: boolean;
   62      readonly note: string;
   63    }[];
   64    readonly feedback: string;
   65  };
   66
   67  export type Grade = {
   68    readonly score: number;
   69    readonly passed: boolean;
   70    readonly failedIntegrity: readonly DraftIntegrityRuleV2[];
   71    readonly criteria: ReviewSheet["criteria"];
   72    readonly integrity: ReviewSheet["integrity"];
   73    /** Below the bar: the numbered fix list the writer was given. */
   74    readonly feedback: string;
   75    /** Code's thread-consistency fixes; any one fails the draft. */
   76    readonly threadProblems?: readonly string[] | undefined;
   77  };
   78
   79  const NOTE_MAX = 300;
   80  const FEEDBACK_MAX = 1_000;
   81
   82  function firstOf<T, K>(items: readonly T[], key: (item: T) => K): T[] {
   83    const seen = new Set<K>();
   84    return items.filter((item) => {
   85      const id = key(item);
   86      if (seen.has(id)) return false;
   87      seen.add(id);
   88      return true;
   89    });
   90  }
   91
   92  /**
   93   * One score from the reviewer's grades. A criterion the reviewer did not
   94   * grade counts as 0 (unknown is not a pass); a rule it did not check
   95   * counts as failed. RESPONDS_TO_THREAD is required only when code found
   96   * something open in their latest message; a reviewer that reports it
   97   * failed fails the draft either way. Free text is cut to what the record
   98   * keeps, never refused (live 2026-10-07: a long note refused the grade).
   99   */
  100  export function gradeOf(
  101    review: ReviewSheet,
  102    threshold: number,
  103    options: { readonly threadRule?: boolean | undefined } = {},
  104  ): Grade {
  105    const criteria = firstOf(review.criteria, (one) => one.criterion);
  106    const integrity = firstOf(review.integrity, (one) => one.rule);
  107    let score = 0;
  108    for (const [criterion, weight] of Object.entries(RUBRIC_WEIGHTS) as [
  109      DraftRubricCriterion,
  110      number,
  111    ][]) {
  112      const graded = criteria.find((one) => one.criterion === criterion);
  113      score += ((graded?.score ?? 0) / 5) * weight;
  114    }
  115    const rules: readonly DraftIntegrityRuleV2[] = [
  116      "GROUNDED",
  117      "NO_COMMITMENTS",
  118      "NOTHING_PRIVATE",
  119      "HONEST_IDENTITY",
  120      ...(options.threadRule === true ? (["RESPONDS_TO_THREAD"] as const) : []),
  121    ];
  122    const failedIntegrity: DraftIntegrityRuleV2[] = rules.filter(
  123      (rule) => integrity.find((one) => one.rule === rule)?.ok !== true,
  124    );
  125    if (
  126      options.threadRule !== true &&
  127      integrity.some((one) => one.rule === "RESPONDS_TO_THREAD" && !one.ok)
  128    ) {
  129      failedIntegrity.push("RESPONDS_TO_THREAD");
  130    }
  131    const rounded = Math.round(score);
  132    return {
  133      score: rounded,
  134      passed: failedIntegrity.length === 0 && rounded >= threshold,
  135      failedIntegrity,
  136      criteria: criteria.map((one) => ({
  137        ...one,
  138        note: one.note.slice(0, NOTE_MAX),
  139      })),
  140      integrity: integrity.map((one) => ({
  141        ...one,
  142        note: one.note.slice(0, NOTE_MAX),
  143      })),
  144      feedback: review.feedback.slice(0, FEEDBACK_MAX),
  145    };
  146  }
  147
  148  /**
  149   * The writer's fix list, concrete and numbered: code's thread fixes
  150   * first, then each failed integrity rule's note, then each criterion the
  151   * reviewer scored 2 or less, then the reviewer's own feedback.
  152   */
  153  export function fixList(grade: Grade, threshold: number): string {
  154    const fixes: string[] = [...(grade.threadProblems ?? [])];
  155    for (const rule of grade.failedIntegrity) {
  156      const note = grade.integrity.find((one) => one.rule === rule)?.note.trim();
  157      fixes.push(
  158        `${rule}: ${note === undefined || note === "" ? "the draft breaks this rule." : note}`,
  159      );
  160    }
  161    for (const one of grade.criteria) {
  162      if (one.score <= 2 && one.note.trim() !== "") {
  163        fixes.push(`${one.criterion}: ${one.note.trim()}`);
  164      }
  165    }
  166    const feedback = grade.feedback.trim();
  167    if (feedback !== "") fixes.push(feedback);
  168    if (fixes.length === 0) {
  169      fixes.push(
  170        `Score ${String(grade.score)} is below ${String(threshold)}: warmer, more specific, and answer what they said first.`,
  171      );
  172    }
  173    return fixes
  174      .slice(0, 8)
  175      .map((fix, index) => `${String(index + 1)}. ${fix}`)
  176      .join("\n")
  177      .slice(0, 2_000);
  178  }
  179
  180  export type ReviewLoopPorts = {
  181    /** The reviewer. Null: unavailable or unreadable. */
  182    readonly review: (body: string) => Promise<ReviewSheet | null>;
  183    /** The writer's redraft from the fix list. Null: no honest redraft. */
  184    readonly redraft: (body: string, feedback: string) => Promise<string | null>;
  185    /**
  186     * Code's own deterministic checks on a redraft (the same ones the first
  187     * draft passed). A string is the problem; null is clean.
  188     */
  189    readonly recheck?: ((body: string) => string | null) | undefined;
  190    /**
  191     * Code's thread-consistency check: the fixes a draft needs to respond
  192     * to their latest message. Any one fails the draft, whatever it scores.
  193     */
  194    readonly consistency?: ((body: string) => readonly string[]) | undefined;
  195    /** Code found something open in their latest message (RESPONDS_TO_THREAD). */
  196    readonly threadRule?: boolean | undefined;
  197    /**
  198     * Tensorgate, 8 Oct: when the loop would hold, the best draft that passed
  199     * every code check and integrity rule and scored within this many points
  200     * of the bar is handed back as a near miss (HELD, `nearMiss`), for the
  201     * caller to offer the person as a card. Absent: no near misses.
  202     */
  203    readonly nearMissPoints?: number | undefined;
  204    /** Recording, for the workforce page. Failures never stop the loop. */
  205    readonly onDraft?:
  206      | ((draft: {
  207          readonly attempt: number;
  208          readonly body: string;
  209          readonly parentDraftId: string | null;
  210        }) => Promise<string | null>)
  211      | undefined;
  212    readonly onGrade?:
  213      ((draftId: string | null, grade: Grade) => Promise<void>) | undefined;
  214    readonly onHandoff?:
  215      | ((handoff: {
  216          readonly from: "WRITER" | "REVIEWER";
  217          readonly to: "WRITER" | "REVIEWER";
  218          readonly draftId: string | null;
  219          readonly note: string;
  220        }) => Promise<void>)
  221      | undefined;
  222  };
  223
  224  export const HOLD_REASONS = [
  225    "BELOW_BAR",
  226    "INTEGRITY",
  227    "REVIEW_UNAVAILABLE",
  228    "WRITER_GAVE_UP",
  229    "CODE_CHECK",
  230    /** It still didn't respond to what their latest message left open. */
  231    "THREAD_MISMATCH",
  232  ] as const;
  233  export type HoldReason = (typeof HOLD_REASONS)[number];
  234
  235  export type ReviewOutcome =
  236    | {
  237        readonly verdict: "PASSED";
  238        readonly body: string;
  239        readonly draftId: string | null;
  240        readonly grade: Grade;
  241        readonly attempts: number;
  242      }
  243    | {
  244        readonly verdict: "HELD";
  245        readonly reason: HoldReason;
  246        /** The last draft written, for the person to see. */
  247        readonly body: string;
  248        readonly draftId: string | null;
  249        readonly grade: Grade | null;
  250        readonly attempts: number;
  251        /**
  252         * The body is the best code-clean draft, within `nearMissPoints` of
  253         * the bar: the person's to approve, never Q's to send.
  254         */
  255        readonly nearMiss?: true | undefined;
  256      };
  257
  258  async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  259    try {
  260      return await work();
  261    } catch {
  262      return fallback;
  263    }
  264  }
  265
  266  export async function writeWithReview(
  267    first: string,
  268    ports: ReviewLoopPorts,
  269    policy: ReviewPolicy = DEFAULT_REVIEW_POLICY,
  270  ): Promise<ReviewOutcome> {
  271    let body = first;
  272    let parent: string | null = null;
  273    let last: Grade | null = null;
  274    // The best draft code had nothing against (no thread problem, no failed
  275    // integrity rule), by score: what a hold may still offer the person.
  276    let best: {
  277      readonly body: string;
  278      readonly draftId: string | null;
  279      readonly grade: Grade;
  280      readonly attempts: number;
  281    } | null = null;
  282    const held = (
  283      outcome: Extract<ReviewOutcome, { verdict: "HELD" }>,
  284    ): ReviewOutcome =>
  285      best !== null &&
  286      ports.nearMissPoints !== undefined &&
  287      best.grade.score >= policy.threshold - ports.nearMissPoints
  288        ? {
  289            verdict: "HELD",
  290            reason: outcome.reason,
  291            body: best.body,
  292            draftId: best.draftId,
  293            grade: best.grade,
  294            attempts: outcome.attempts,
  295            nearMiss: true,
  296          }
  297        : outcome;
  298    /** Code's own problems with a draft: its checks, then the thread's. */
  299    const codeProblems = (draft: string): readonly string[] => {
  300      const problem = ports.recheck?.(draft) ?? null;
  301      return [
  302        ...(problem === null ? [] : [problem]),
  303        ...(ports.consistency?.(draft) ?? []),
  304      ];
  305    };
  306    const maxRedrafts = Math.max(
  307      0,
  308      Math.min(policy.maxRedrafts, REVIEW_ROUNDS_MAX - 1),
  309    );
  310    for (let attempt = 1; attempt <= maxRedrafts + 1; attempt += 1) {
  311      const draftId: string | null = ports.onDraft
  312        ? await quietly(
  313            () =>
  314              ports.onDraft?.({ attempt, body, parentDraftId: parent }) ??
  315              Promise.resolve(null),
  316            null,
  317          )
  318        : null;
  319      const review = await ports.review(body).catch(() => null);
  320      if (review === null) {
  321        return held({
  322          verdict: "HELD",
  323          reason: "REVIEW_UNAVAILABLE",
  324          body,
  325          draftId,
  326          grade: last,
  327          attempts: attempt,
  328        });
  329      }
  330      const graded = gradeOf(review, policy.threshold, {
  331        threadRule: ports.threadRule,
  332      });
  333      const problems = ports.consistency?.(body) ?? [];
  334      const failed: Grade =
  335        problems.length === 0
  336          ? graded
  337          : { ...graded, passed: false, threadProblems: problems };
  338      // Below the bar, what is recorded and handed back is the fix list.
  339      const fixes = failed.passed
  340        ? failed.feedback
  341        : fixList(failed, policy.threshold);
  342      const grade: Grade = { ...failed, feedback: fixes.slice(0, FEEDBACK_MAX) };
  343      last = grade;
  344      await quietly(
  345        () => ports.onGrade?.(draftId, grade) ?? Promise.resolve(),
  346        undefined,
  347      );
  348      if (grade.passed) {
  349        return { verdict: "PASSED", body, draftId, grade, attempts: attempt };
  350      }
  351      if (
  352        problems.length === 0 &&
  353        grade.failedIntegrity.length === 0 &&
  354        (best === null || grade.score > best.grade.score)
  355      ) {
  356        best = { body, draftId, grade, attempts: attempt };
  357      }
  358      if (attempt > maxRedrafts) {
  359        return held({
  360          verdict: "HELD",
  361          reason:
  362            problems.length > 0 ||
  363            grade.failedIntegrity.includes("RESPONDS_TO_THREAD")
  364              ? "THREAD_MISMATCH"
  365              : grade.failedIntegrity.length > 0
  366                ? "INTEGRITY"
  367                : "BELOW_BAR",
  368          body,
  369          draftId,
  370          grade,
  371          attempts: attempt,
  372        });
  373      }
  374      await quietly(
  375        () =>
  376          ports.onHandoff?.({
  377            from: "REVIEWER",
  378            to: "WRITER",
  379            draftId,
  380            note: fixes.slice(0, 1_000),
  381          }) ?? Promise.resolve(),
  382        undefined,
  383      );
  384      let next = await ports.redraft(body, fixes).catch(() => null);
  385      if (next === null || next.trim() === "") {
  386        return held({
  387          verdict: "HELD",
  388          reason: "WRITER_GAVE_UP",
  389          body,
  390          draftId,
  391          grade,
  392          attempts: attempt,
  393        });
  394      }
  395      // Tensorgate, 8 Oct: a redraft re-asked "would you be open to
  396      // connecting?" -- Zino's own question -- and was graded, held, and the
  397      // round spent. Code's checks run on a revision before the reviewer
  398      // sees it; one fix from code's own words, then it must be clean.
  399      let found = codeProblems(next);
  400      if (found.length > 0) {
  401        const fixed = await ports
  402          .redraft(
  403            next,
  404            found
  405              .map((one, index) => `${String(index + 1)}. ${one}`)
  406              .join("\n")
  407              .slice(0, 2_000),
  408          )
  409          .catch(() => null);
  410        if (fixed !== null && fixed.trim() !== "") {
  411          next = fixed;
  412          found = codeProblems(next);
  413        }
  414      }
  415      if (found.length > 0) {
  416        const threadOnly = (ports.recheck?.(next) ?? null) === null;
  417        return held({
  418          verdict: "HELD",
  419          reason: threadOnly ? "THREAD_MISMATCH" : "CODE_CHECK",
  420          body: next,
  421          draftId,
  422          grade,
  423          attempts: attempt + 1,
  424        });
  425      }
  426      await quietly(
  427        () =>
  428          ports.onHandoff?.({
  429            from: "WRITER",
  430            to: "REVIEWER",
  431            draftId,
  432            note: "Redrafted from the reviewer's fix list.",
  433          }) ?? Promise.resolve(),
  434        undefined,
  435      );
  436      body = next;
  437      parent = draftId;
  438    }
  439    // Unreachable: the loop returns on its last attempt.
  440    return {
  441      verdict: "HELD",
  442      reason: "BELOW_BAR",
  443      body,
  444      draftId: parent,
  445      grade: last,
  446      attempts: maxRedrafts + 1,
  447    };
  448  }
```
