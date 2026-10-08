# Evidence: apps/web/src/features/q/q-now.tsx (lines 17-157)

- Original path: `apps/web/src/features/q/q-now.tsx`
- Line range: 17-157 (HEAD 520bd123)
- Why included: Now / Needs you: conversation-scoped approval card (Approve/Decline by approvalId).

```
   17  export function QNow({
   18    session,
   19    onAct,
   20    quietWhenIdle = false,
   21  }: {
   22    readonly session: QSessionValue;
   23    /**
   24     * On the stage, an idle "Now" says nothing worth the space (R23): it
   25     * renders only when something runs, waits or asks.
   26     */
   27    readonly quietWhenIdle?: boolean | undefined;
   28    /** Answer one of Q's questions (typed, or down the open line). */
   29    readonly onAct: (text: string) => void;
   30  }) {
   31    const { q, turns, voice } = session;
   32    const approval = q.state.approval;
   33    const proposal =
   34      approval === null
   35        ? undefined
   36        : q.state.proposals.find(
   37            (candidate) => candidate.proposalId === approval.proposalId,
   38          );
   39    const questions = openQuestions(turns);
   40    const stage = workingLabel(q.state);
   41    const nothing = !q.working && approval === null && questions.length === 0;
   42    if (nothing && quietWhenIdle) return null;
   43  
   44    return (
   45      <section
   46        aria-label="Now"
   47        className="flex flex-col gap-3"
   48        data-q-now={nothing ? "idle" : "busy"}
   49      >
   50        <h2 className="cq-label text-(--cq-text-secondary)">Now</h2>
   51        {nothing ? (
   52          <p className="cq-body-sm text-(--cq-text-tertiary)">
   53            Q isn&apos;t working on anything, and nothing needs you.
   54          </p>
   55        ) : null}
   56  
   57        {q.working ? (
   58          <div className="cq-q-now-item" data-q-now-task>
   59            <span className="flex min-w-0 flex-col">
   60              <span className="cq-body-sm font-medium text-(--cq-text-primary)">
   61                Q is working
   62              </span>
   63              {stage !== undefined ? (
   64                <span className="cq-caption text-(--cq-text-secondary)">
   65                  {stage}
   66                </span>
   67              ) : null}
   68            </span>
   69            <button
   70              type="button"
   71              className={buttonClassName("quiet", "compact")}
   72              onClick={() => void q.stop()}
   73            >
   74              Stop
   75            </button>
   76          </div>
   77        ) : null}
   78  
   79        {approval !== null ? (
   80          // What Q has prepared and is waiting on (CQ-Q-008). The server's
   81          // own words for the exact payload the decision binds to; one yes
   82          // applies it, one no leaves everything as it was.
   83          <div className="cq-q-now-item flex-col items-stretch" data-q-approval>
   84            <span className="cq-label text-(--cq-text-secondary)">Needs you</span>
   85            <p className="cq-body-sm font-medium text-(--cq-text-primary)">
   86              {proposal?.summary ??
   87                "Q has prepared something for you to approve."}
   88            </p>
   89            {proposal?.preview !== undefined ? (
   90              <pre className="cq-caption whitespace-pre-wrap font-sans text-(--cq-text-secondary)">
   91                {proposal.preview}
   92              </pre>
   93            ) : null}
   94            {proposal?.actionType === "email.send" ? (
   95              // The email draft (BIZ-007): editable here; saving asks again.
   96              <EmailDraftEditor
   97                key={approval.approvalId}
   98                approvalId={approval.approvalId}
   99                onRevised={() => q.revised()}
  100              />
  101            ) : null}
  102            <div className="flex flex-wrap gap-2">
  103              <button
  104                type="button"
  105                className="cq-stage-primary"
  106                onClick={() => {
  107                  session.act();
  108                  void q.approve();
  109                }}
  110              >
  111                Approve
  112              </button>
  113              <button
  114                type="button"
  115                className="cq-stage-control"
  116                onClick={() => void q.decline()}
  117              >
  118                Decline
  119              </button>
  120            </div>
  121          </div>
  122        ) : null}
  123  
  124        {questions.map((question) => (
  125          <div
  126            key={question.question}
  127            className="cq-q-now-item flex-col items-stretch"
  128            data-q-now-question
  129          >
  130            <span className="cq-label text-(--cq-text-secondary)">Q asks</span>
  131            <p className="cq-body-sm text-(--cq-text-primary)">
  132              {question.question}
  133            </p>
  134            {question.options !== undefined ? (
  135              <div className="flex flex-wrap gap-2">
  136                {question.options.map((option) => (
  137                  <button
  138                    key={option}
  139                    type="button"
  140                    className="cq-stage-option"
  141                    onClick={() => onAct(option)}
  142                  >
  143                    {option}
  144                  </button>
  145                ))}
  146              </div>
  147            ) : null}
  148          </div>
  149        ))}
  150        {voice.active && voice.turn?.asking?.options.length ? (
  151          <p className="cq-caption text-(--cq-text-tertiary)">
  152            Q is asking on the stage: tap an option there, or just say it.
  153          </p>
  154        ) : null}
  155      </section>
  156    );
  157  }
```

# Evidence: apps/web/src/features/q/actions.ts (lines 385-420)

- Original path: `apps/web/src/features/q/actions.ts`
- Line range: 385-420 (HEAD 520bd123)
- Why included: approveQApprovalAction / readQApprovalAction server actions.

```
  385  export async function approveQApprovalAction(
  386    rawApprovalId: string,
  387  ): Promise<QActionResult<null>> {
  388    const approvalId = ApprovalIdSchema.safeParse(rawApprovalId);
  389    if (!approvalId.success) {
  390      return failure("I couldn't record that decision. Try again.");
  391    }
  392    return run(async (session) => {
  393      await approveQApproval(session, approvalId.data);
  394      return null;
  395    });
  396  }
  397  
  398  /** The approvals still waiting on this person (their own, server-read). */
  399  export async function pendingQApprovalsAction(): Promise<
  400    QActionResult<readonly QPendingApproval[]>
  401  > {
  402    return run(async (session) => (await listPendingQApprovals(session)).items);
  403  }
  404  
  405  /**
  406   * One approval as its requested approver may read it: what Q would do, to
  407   * whom, and the exact content the decision binds to (design-48: Q's work
  408   * shows it before the person says yes).
  409   */
  410  export async function readQApprovalAction(
  411    rawApprovalId: string,
  412  ): Promise<QActionResult<QApprovalView>> {
  413    const approvalId = ApprovalIdSchema.safeParse(rawApprovalId);
  414    if (!approvalId.success) {
  415      return failure("That approval isn't available.");
  416    }
  417    return run((session) => getQApproval(session, approvalId.data));
  418  }
  419  
  420  export async function rejectQApprovalAction(
```

