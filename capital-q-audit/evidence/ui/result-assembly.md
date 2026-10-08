# Evidence: packages/model-gateway/src/q/result-blocks.ts (lines 319-430)

- Original path: `packages/model-gateway/src/q/result-blocks.ts`
- Line range: 319-430 (HEAD 520bd123)
- Why included: analystResultBlocks: blocks from analyst fields; whole array dropped if any block fails the contract.

```
  319  export function analystResultBlocks(input: {
  320    readonly result: AnalystResultLike;
  321    readonly subjects: readonly QSubjectRef[];
  322    /** Overridable so a test can pin the ids it asserts on. */
  323    readonly findingId?: ((index: number) => string) | undefined;
  324  }): QResultBlock[] | undefined {
  325    const idFor = input.findingId ?? (() => randomUUID());
  326    const blocks: QResultBlock[] = [];
  327  
  328    // The cards lead: they are the answer's shape when the person compared
  329    // things. Copied as written, in the order written; nothing here sorts.
  330    // v17's answer cards replace v12's comparison cards when both came.
  331    const answer =
  332      input.result.answerCards === null || input.result.answerCards === undefined
  333        ? null
  334        : answerCardsBlock(input.result.answerCards);
  335    if (answer !== null) blocks.push(answer);
  336    const cards = answer === null ? input.result.comparisonCards : null;
  337    if (cards !== null && cards !== undefined && cards.items.length >= 2) {
  338      blocks.push({
  339        kind: "COMPARISON_CARDS",
  340        title: cards.title,
  341        items: cards.items.map((item) => ({
  342          name: item.name,
  343          subtitle: item.subtitle,
  344          points: [...item.points],
  345        })),
  346      });
  347    }
  348  
  349    for (const [index, finding] of withoutContradictedGaps(
  350      input.result.findings ?? [],
  351    ).entries()) {
  352      const statement = finding.statement.trim();
  353      if (statement.length === 0) continue;
  354      blocks.push({
  355        kind: "FINDING",
  356        finding: {
  357          findingId: QFindingIdSchema.parse(idFor(index)),
  358          // An unrecognised type is an observation, not a guess at a
  359          // stronger one: reading a model's label as RISK when the contract
  360          // does not know it would be inventing severity.
  361          type: (FINDING_TYPES.has(finding.type ?? "")
  362            ? finding.type
  363            : "OBSERVATION") as QFindingType,
  364          statement,
  365          confidence: (CONFIDENCE_LEVELS.has(finding.confidence ?? "")
  366            ? finding.confidence
  367            : "MODERATE") as QConfidenceLevel,
  368          // The model's own reading of what kind of claim this is, passed
  369          // through rather than re-decided here. An unrecognised value
  370          // becomes the weakest honest one: a claim whose standing we
  371          // cannot read is a user claim with no evidence, never a fact.
  372          truthClass: (TRUTH_CLASSES.has(finding.truthClass ?? "")
  373            ? finding.truthClass
  374            : "USER_CLAIM") as TruthClass,
  375          evidenceStatus: (EVIDENCE_STATUSES.has(finding.evidenceStatus ?? "")
  376            ? finding.evidenceStatus
  377            : "SELF_REPORTED") as EvidenceStatus,
  378          // Deliberately empty. The finding's supporting evidence is real
  379          // and its identifiers are not the browser's to hold.
  380          evidenceRefs: [],
  381          // What the run was authorised about, never what the model named.
  382          subjects: [...input.subjects],
  383        },
  384      });
  385    }
  386  
  387    // What the supplied context did not establish, and what conflicts in it.
  388    // Both are absence reported as absence — never a low score for anybody.
  389    for (const statement of input.result.missingEvidence ?? []) {
  390      const text = statement.trim();
  391      if (text.length === 0) continue;
  392      blocks.push({
  393        kind: "UNCERTAINTY",
  394        statement: text,
  395        confidence: NOT_ESTABLISHED,
  396      });
  397    }
  398    for (const statement of input.result.contradictions ?? []) {
  399      const text = statement.trim();
  400      if (text.length === 0) continue;
  401      blocks.push({
  402        kind: "UNCERTAINTY",
  403        statement: text,
  404        confidence: DISAGREES,
  405      });
  406    }
  407  
  408    // A question back is a card only when Q genuinely could not answer
  409    // (Zino live 2026-10-07: "I'm asking you something but you're giving me
  410    // a card asking me another question"). Beside an answer, the question
  411    // is already in the words, said once, in voice or text.
  412    if (couldNotAnswer(input.result)) {
  413      for (const clarification of input.result.clarifyingQuestions ?? []) {
  414        const question = clarification.question.trim();
  415        if (question.length === 0) continue;
  416        blocks.push({ kind: "CLARIFICATION_REQUEST", question });
  417      }
  418    }
  419  
  420    blocks.push(...subjectBlocks(input.subjects));
  421  
  422    if (blocks.length === 0) {
  423      return undefined;
  424    }
  425    // Parsed rather than asserted: a block that does not satisfy the public
  426    // contract must not reach a client, and the answer is still good text
  427    // without it.
  428    const parsed = QResultBlocksSchema.safeParse(blocks);
  429    return parsed.success ? [...parsed.data] : undefined;
  430  }
```

# Evidence: packages/model-gateway/src/q/answer-cards.ts (lines 47-132)

- Original path: `packages/model-gateway/src/q/answer-cards.ts`
- Line range: 47-132 (HEAD 520bd123)
- Why included: answerCardsBlock: fit from model-assigned levels; subject always null.

```
   47  /**
   48   * Fit out of 10: the mean of the known measures' points, to one decimal.
   49   * An UNKNOWN measure is left out (never scored as zero) and still counted
   50   * in `of`; too few known measures and there is no fit at all.
   51   */
   52  export function answerCardFit(
   53    measures: readonly { readonly level: QAnswerCardLevel }[],
   54  ): QAnswerCardFit | null {
   55    const known = measures.flatMap((measure) =>
   56      measure.level === "UNKNOWN"
   57        ? []
   58        : [ANSWER_CARD_LEVEL_POINTS[measure.level]],
   59    );
   60    if (known.length < ANSWER_CARD_FIT_MIN_KNOWN) return null;
   61    const mean = known.reduce((sum, points) => sum + points, 0) / known.length;
   62    return {
   63      score: Math.round(mean * 10) / 10,
   64      measured: known.length,
   65      of: measures.length,
   66    };
   67  }
   68  
   69  function keyOf(name: string, taken: Set<string>): string {
   70    const base =
   71      name
   72        .toLowerCase()
   73        .normalize("NFKD")
   74        .replace(/[^a-z0-9]+/g, "-")
   75        .replace(/^-+|-+$/g, "")
   76        .slice(0, 48) || "card";
   77    let key = base;
   78    for (let n = 2; taken.has(key); n += 1) key = `${base}-${String(n)}`;
   79    taken.add(key);
   80    return key;
   81  }
   82  
   83  /**
   84   * The block the page renders, or null when the reading cannot make one.
   85   * RANKED is ordered by fit, highest first; equal fits and cards without a
   86   * fit keep the order the model wrote. Colours follow the final order.
   87   */
   88  export function answerCardsBlock(
   89    model: ModelAnswerCardsLike,
   90  ): QAnswerCardsBlock | null {
   91    const research = model.shape === "RESEARCH";
   92    const scored = model.cards.map((card, index) => ({
   93      card,
   94      index,
   95      fit: research ? null : answerCardFit(card.measures),
   96    }));
   97    if (model.shape === "RANKED") {
   98      scored.sort((a, b) => {
   99        const fa = a.fit?.score ?? -1;
  100        const fb = b.fit?.score ?? -1;
  101        return fb - fa || a.index - b.index;
  102      });
  103    }
  104    const taken = new Set<string>();
  105    const cards: QAnswerCard[] = scored.map(({ card, fit }, at) => ({
  106      key: keyOf(card.name, taken),
  107      name: card.name,
  108      line: card.line,
  109      hue: (at % Q_ANSWER_CARD_HUES) + 1,
  110      fit,
  111      reasons: card.reasons.slice(0, 3),
  112      measures: research
  113        ? []
  114        : card.measures.map((measure) => ({
  115            label: measure.label,
  116            level: measure.level,
  117            value: measure.value,
  118          })),
  119      view: card.view,
  120      said: card.said,
  121      sourceCount: new Set(card.citations).size,
  122      subject: null,
  123    }));
  124    const parsed = QAnswerCardsBlockSchema.safeParse({
  125      kind: "ANSWER_CARDS",
  126      shape: model.shape,
  127      title: model.title,
  128      cards,
  129      followUps: model.followUps.slice(0, 3),
  130    });
  131    return parsed.success ? parsed.data : null;
  132  }
```

# Evidence: packages/model-gateway/src/q/card-subjects.ts (lines 1-40)

- Original path: `packages/model-gateway/src/q/card-subjects.ts`
- Line range: 1-40 (HEAD 520bd123)
- Why included: Card subjects resolved only for COMPANY from the run's own tool reads.

```
    1  import type { QAnswerCardsBlock } from "@capital-q/contracts";
    2  import type { QToolCallOutcome } from "@capital-q/q-runtime";
    3  
    4  /**
    5   * The record behind each answer card (R0, Zino live 2026-10-06: every card
    6   * of the day came with subject null, so "Open profile" could never show
    7   * and a card could not open its company).
    8   *
    9   * A card names a company in words; the id comes only from what this run's
   10   * own tools returned -- authorised reads, under the plan -- never from the
   11   * model. A name matches when it is the same name, letters and digits only;
   12   * a card no tool result names keeps no subject.
   13   */
   14  
   15  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
   16  
   17  export function nameKey(name: string): string {
   18    return name
   19      .toLowerCase()
   20      .normalize("NFKD")
   21      .replace(/\([^)]*\)/gu, " ")
   22      .replace(/[^a-z0-9]+/gu, "");
   23  }
   24  
   25  /** Every {company id, name} pair a tool's authorised output carries. */
   26  export function companiesInOutcome(
   27    outcome: Pick<QToolCallOutcome, "result">,
   28  ): { readonly companyId: string; readonly name: string }[] {
   29    if (!outcome.result.ok) return [];
   30    const found: { companyId: string; name: string }[] = [];
   31    const visit = (value: unknown, depth: number): void => {
   32      if (depth > 6 || value === null || typeof value !== "object") return;
   33      if (Array.isArray(value)) {
   34        for (const item of value.slice(0, 200)) visit(item, depth + 1);
   35        return;
   36      }
   37      const record = value as Record<string, unknown>;
   38      // { companyId, name }, { id, canonicalName }, or a relationship's
   39      // counterpart { kind: "COMPANY", id, name }.
   40      const id =
```

# Evidence: packages/model-gateway/src/q/index.ts (lines 4070-4090)

- Original path: `packages/model-gateway/src/q/index.ts`
- Line range: 4070-4090 (HEAD 520bd123)
- Why included: Where blocks are assembled and company subjects attached.

```
 4070                    return null;
 4071                  });
 4072          const companiesRead = runCompanies.take(request.runId);
 4073          const modelBlocks = analystResultBlocks({
 4074            result: analyst,
 4075            // The run's own authorised subjects, never anything the model
 4076            // named: a reference is caused by what the server allowed this
 4077            // run to be about. Their own firm, carried as context for a fit
 4078            // question, is not what they asked about (CQ-QX-007).
 4079            subjects: askedSubjects(request.subjects, plan),
 4080          })?.map((block) =>
 4081            block.kind === "ANSWER_CARDS"
 4082              ? withCardSubjects(block, companiesRead)
 4083              : block,
 4084          );
 4085          // Zino live 2026-10-07: a list with scores came back with no cards.
 4086          // When the model wrote none and this run's tools computed two or
 4087          // more fits, code lays them out from those fits (deterministic,
 4088          // the platform's own scores and reasons).
 4089          const fitsRead = runFits.take(request.runId);
 4090          const builtCards = (modelBlocks ?? []).some(
```

