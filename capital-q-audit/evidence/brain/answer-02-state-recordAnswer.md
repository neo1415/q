# Evidence: packages/q-specialists/src/answer.ts (lines 637-935)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 637-935 (HEAD 9177629d)
- Why included: Conversation history limits (12 turns x 4000 chars for specialist), in-memory conversation state maps, recordAnswer (message + q.message.completed in one tx).

```ts
  637  export type SpecialistQAnswer = QAnswerPort & {
  638    /** The last investigation, for developer smokes and evals. Never a public path. */
  639    readonly lastResult: () => CompanyIntelligenceResult | null;
  640  };
  641
  642  const ANSWER_LIMIT_CHARS = 32_000;
  643
  644  /**
  645   * How much of the conversation the specialist reads (CQ-QX-007 H3a).
  646   * Enough to carry a correction made a few turns back; bounded so a long
  647   * conversation does not become a long prompt.
  648   */
  649  const CONVERSATION_TURNS_MAX = 12;
  650  const CONVERSATION_TURN_CHARS_MAX = 4_000;
  651
  652  /** The conversation before this message, as the prompt's DATA. */
  653  export function earlierTurns(
  654    history: readonly QConversationMessage[],
  655    latestId: string,
  656  ): readonly { readonly role: "USER" | "Q"; readonly content: string }[] {
  657    return history
  658      .filter((message) => message.id !== latestId)
  659      .flatMap((message) =>
  660        (message.role === "USER" || message.role === "Q") &&
  661        message.content.trim().length > 0
  662          ? [
  663              {
  664                role: message.role,
  665                content: message.content.slice(0, CONVERSATION_TURN_CHARS_MAX),
  666              },
  667            ]
  668          : [],
  669      )
  670      .slice(-CONVERSATION_TURNS_MAX);
  671  }
  672
  673  /**
  674   * What a person reads when the specialist could not produce findings.
  675   *
  676   * Plain English, and specific enough to be useful without naming a
  677   * provider, a schema, a policy code or a table (§105). "No eligible route"
  678   * is deliberately not phrased as an outage: refusing to send private
  679   * material to an unsuitable provider is Capital Q working, not failing.
  680   */
  681  function publicBlockedMessage(
  682    reason: NonNullable<CompanyIntelligenceResult["blocked"]>,
  683  ): string {
  684    switch (reason) {
  685      case "NO_AUTHORISED_SUBJECT":
  686        return "I don't have access to that company's information in this conversation, so I can't analyse it.";
  687      case "NO_ELIGIBLE_MODEL_ROUTE":
  688        return "Some of the information involved is too sensitive to send for analysis with the options available right now, so I've stopped rather than work around it. I can still answer from what's already recorded if you'd like to ask something narrower.";
  689      case "MODEL_UNAVAILABLE":
  690        return "I couldn't get a full review through just now. I can still answer from what's already recorded, read a website you point me at, or you can ask again in a moment.";
  691      case "MODEL_OUTPUT_REJECTED":
  692        return "I couldn't put together a reliable answer from the available information this time.";
  693      case "CANCELLED":
  694        return "I stopped before finishing that analysis.";
  695    }
  696  }
  697
  698  /**
  699   * A last-resort answer built from findings alone, for the case where the
  700   * model produced findings but no usable prose.
  701   *
  702   * Deterministic and dull on purpose: it is better for Q to state what it
  703   * found in flat sentences than to say nothing, and better still that this
  704   * path is obviously not the normal one.
  705   */
  706  function synthesisFromFindings(result: CompanyIntelligenceResult): string {
  707    const lines: string[] = [];
  708    const byType = (type: string): readonly string[] =>
  709      result.findings
  710        .filter((finding) => finding.type === type)
  711        .map((finding) => `- ${finding.statement}`);
  712    const sections: readonly (readonly [string, readonly string[]])[] = [
  713      ["What the evidence shows", [...byType("FACT"), ...byType("OBSERVATION")]],
  714      ["What looks strong", byType("STRENGTH")],
  715      ["What needs attention", byType("RISK")],
  716      ["What is uncertain", byType("UNCERTAINTY")],
  717      ["What we don't know", byType("GAP")],
  718    ];
  719    for (const [heading, items] of sections) {
  720      if (items.length > 0) {
  721        lines.push(`**${heading}**`, ...items, "");
  722      }
  723    }
  724    return lines.length === 0
  725      ? "I don't have enough information about this company to say anything useful yet."
  726      : lines.join("\n").trim();
  727  }
  728
  729  export function createSpecialistQAnswer(
  730    dependencies: SpecialistQAnswerDependencies,
  731  ): SpecialistQAnswer {
  732    const {
  733      specialist,
  734      delegate,
  735      repositories,
  736      sql,
  737      transactions,
  738      artifacts,
  739      logger,
  740      turns,
  741    } = dependencies;
  742    let last: CompanyIntelligenceResult | null = null;
  743
  744    /**
  745     * The conversation core's state per conversation (CQ-QX-005): what has
  746     * failed and how often. In memory and bounded — it is conversational
  747     * texture, not a record; a restart forgets a count, never a fact.
  748     */
  749    const conversations = new Map<string, ConversationState>();
  750    /** Declared actions waiting on the person's reply, per conversation. */
  751    const pendingActions = pendingAppActionStore(dependencies.pendingAppActions);
  752    /** A port result said as the answer: a line, a card, or a question that waits. */
  753    /**
  754     * The last action Q took or tried per conversation (follow-55), so "try
  755     * again" and "same for X" bind to it. In memory and bounded like the
  756     * rest of the core's state: a restart forgets it, never a fact.
  757     */
  758    const lastActed = new Map<string, LastAction>();
  759    /** What each run's person said, for the action a run notes. */
  760    const saidInRun = new Map<string, string>();
  761    const noteAction = (
  762      request: QAnswerRequest,
  763      conversationId: string,
  764      action: {
  765        readonly tool: string;
  766        readonly arguments: Readonly<Record<string, unknown>> | null;
  767      },
  768      outcome: LastAction["outcome"],
  769      utterance?: string,
  770    ): void => {
  771      const said = utterance ?? saidInRun.get(request.runId);
  772      if (said === undefined) return;
  773      lastActed.delete(conversationId);
  774      lastActed.set(conversationId, {
  775        tool: action.tool,
  776        arguments: action.arguments,
  777        utterance: said,
  778        outcome,
  779      });
  780      while (lastActed.size > MAX_CONVERSATIONS) {
  781        const oldest = lastActed.keys().next().value;
  782        if (oldest === undefined) break;
  783        lastActed.delete(oldest);
  784      }
  785    };
  786    const saidByAction = async (
  787      request: QAnswerRequest,
  788      conversationId: QConversationMessage["conversationId"],
  789      action: TurnAppAction,
  790      said: string | QAppActionPrepared | QAppActionAsks,
  791    ): Promise<QAnswerOutcome> => {
  792      noteAction(
  793        request,
  794        conversationId,
  795        action,
  796        typeof said === "string"
  797          ? "SAID"
  798          : "asks" in said
  799            ? "WAITING"
  800            : "PREPARED",
  801      );
  802      if (typeof said === "string") {
  803        return recordAnswer(request, conversationId, said);
  804      }
  805      if ("asks" in said) {
  806        await pendingActions.hold(
  807          { tenantId: request.tenantId, conversationId },
  808          { action, needs: said.needs },
  809        );
  810        return recordAnswer(request, conversationId, said.asks);
  811      }
  812      return preparedForEngine(request, said.prepared);
  813    };
  814    const MAX_CONVERSATIONS = 500;
  815    const remember = (conversationId: string, state: ConversationState) => {
  816      conversations.delete(conversationId);
  817      conversations.set(conversationId, state);
  818      if (conversations.size > MAX_CONVERSATIONS) {
  819        const oldest = conversations.keys().next().value;
  820        if (oldest !== undefined) conversations.delete(oldest);
  821      }
  822    };
  823    /** A failed run's notice, held until the orchestrator reads it once. */
  824    const notices = new Map<string, string>();
  825
  826    /** Which subsystem a failed answer failed in, for the ledger. */
  827    const operationOf = (
  828      code: Extract<QAnswerOutcome, { kind: "FAILED" }>["diagnosticCode"],
  829    ): FailureOperation | null => {
  830      switch (code) {
  831        case "MODEL_PROVIDER_TIMEOUT":
  832        case "MODEL_PROVIDER_UNAVAILABLE":
  833        case "BUDGET_EXCEEDED":
  834          return "MODEL";
  835        case "TOOL_FAILED":
  836        case "RETRIEVAL_FAILED":
  837        case "EVIDENCE_PROCESSING_UNAVAILABLE":
  838          return "TOOL";
  839        // Cancellation, policy and invalid requests are not a subsystem
  840        // failing, and never earn a notice.
  841        case "INVALID_REQUEST":
  842        case "SUBJECT_NOT_RESOLVED":
  843        case "CONTEXT_RESOLUTION_FAILED":
  844        case "POLICY_DENIED":
  845        case "APPROVAL_EXPIRED":
  846        case "RUN_CANCELLED":
  847        case "RUN_EXPIRED":
  848        case "INTERNAL_ERROR":
  849          return null;
  850      }
  851    };
  852
  853    /** Approved progress only; best effort, never a reason to fail the answer. */
  854    async function showStage(
  855      request: QAnswerRequest,
  856      stage: QVisibleStage,
  857    ): Promise<void> {
  858      try {
  859        await transactions.run((tx) =>
  860          appendRunEvent(
  861            repositories,
  862            tx,
  863            { id: request.runId, tenantId: request.tenantId },
  864            { type: "q.stage.changed", data: { stage } },
  865          ),
  866        );
  867      } catch (error: unknown) {
  868        logger?.warn(
  869          { err: error, qRunId: request.runId },
  870          "q specialist stage event not recorded",
  871        );
  872      }
  873    }
  874
  875    /** A Q message and its durable completion event, committed together. */
  876    async function recordAnswer(
  877      request: QAnswerRequest,
  878      conversationId: QConversationMessage["conversationId"],
  879      content: string,
  880      blocks?: readonly QResultBlock[],
  881    ): Promise<QAnswerOutcome> {
  882      const message = await transactions.run(async (tx) => {
  883        const stored = await repositories.messages.insert(tx, {
  884          tenantId: request.tenantId,
  885          conversationId,
  886          runId: request.runId,
  887          role: "Q",
  888          content,
  889          ...(blocks === undefined ? {} : { blocks }),
  890        });
  891        await appendRunEvent(
  892          repositories,
  893          tx,
  894          { id: request.runId, tenantId: request.tenantId },
  895          {
  896            type: "q.message.completed",
  897            data: {
  898              message: {
  899                ...(toQMessage(stored) as QResponseMessage),
  900                ...(blocks === undefined ? {} : { blocks: [...blocks] }),
  901              },
  902            },
  903          },
  904        );
  905        return stored;
  906      });
  907      return {
  908        kind: "ANSWERED",
  909        messageId: message.id,
  910        modelPolicyVersion: "none",
  911        promptBundleVersion: "none",
  912      };
  913    }
  914
  915    /**
  916     * "Make me a deck on X", done rather than described (CQ-QACT-002).
  917     *
  918     * The chain is the platform's, run to the end without asking permission
  919     * for any step, because every step is a safe internal action: read what
  920     * Capital Q holds or what the public web says, reconcile it into typed
  921     * findings (the specialist's own validation — a finding cites a source
  922     * or is dropped), compose the document, file it as a private artifact
  923     * of the person's organisation. Nothing is sent to anybody and nothing
  924     * in anybody's record changes, which is why none of it waits for
  925     * approval. What is not known goes into the document as not known.
  926     *
  927     * The reply is the result, briefly: the person asked for a document,
  928     * not for an account of one.
  929     */
  930    /**
  931     * The person's own record a name the reader heard refers to, if any
  932     * (founder live 2026-09-27, failure 6). Read only when a name was heard;
  933     * a failed read resolves nothing and the name is used as heard.
  934     */
  935    async function ownRecordFor(
```
