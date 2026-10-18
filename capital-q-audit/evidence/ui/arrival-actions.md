# Evidence: apps/web/src/features/briefing/arrival-actions.ts (lines 41-347)

- Original path: `apps/web/src/features/briefing/arrival-actions.ts`
- Line range: 41-347 (HEAD 520bd123)
- Why included: Server reads for the briefing (work since, approvals, workforce, done, notices) and the single decision path (approve with shown-content recheck, send edited, dismiss, retry held).

```
   41  /**
   42   * The arrival briefing's reads and its one decision path (Zino,
   43   * 2026-10-08), on the server under the person's own session. The cards
   44   * are the Work page's decision queue, read the same way (decisions.ts),
   45   * so the two never disagree about what needs them. Every decision goes
   46   * through the actions the Work page uses: the Approval Engine's approve
   47   * and reject (which bind to the payload the server holds), and the
   48   * person's own message for an edit.
   49   */
   50
   51  /** Cards read in full (exact message and their latest words). */
   52  const CARDS_MAX = 6;
   53
   54  function firstNameOf(display: string | null | undefined): string | null {
   55    const first = display?.trim().split(/\s+/u)[0];
   56    return first === undefined || first.length === 0 ? null : first.slice(0, 40);
   57  }
   58
   59  /** Their words since we last wrote, newest last; null when we wrote last. */
   60  function theirLatest(thread: ChatThreadDto | null): string | null {
   61    if (thread === null) return null;
   62    const messages = [...thread.messages]
   63      .filter((message) => !message.unsent)
   64      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
   65    const last = messages.at(-1);
   66    if (last === undefined || last.mine) return null;
   67    return last.body;
   68  }
   69
   70  /** The exact content an approval binds to, as the person is shown it. */
   71  function shownOf(view: QApprovalView | null): {
   72    readonly message: string | null;
   73    readonly preview: string | null;
   74  } {
   75    if (view === null) return { message: null, preview: null };
   76    if (view.action.actionType === "chat.message.send") {
   77      return { message: readPlan(view.action.preview).quote, preview: null };
   78    }
   79    return { message: null, preview: view.action.preview ?? null };
   80  }
   81
   82  function activityOf(since: QWorkSinceDto | null): ArrivalActivity | null {
   83    if (since === null) return null;
   84    return {
   85      sent: since.sent,
   86      booked: since.booked,
   87      interest: since.interest,
   88      held: since.held,
   89      replies: since.replies,
   90      matches: since.matches,
   91    };
   92  }
   93
   94  const SinceInput = z.string().datetime({ offset: true }).nullable();
   95
   96  /**
   97   * Everything the briefing needs, read in parallel. A read that fails is
   98   * absent (null activity, fewer cards), never an error that stops Q.
   99   */
  100  export async function arrivalBriefingAction(
  101    rawSince: string | null,
  102  ): Promise<ArrivalData | null> {
  103    const parsed = SinceInput.safeParse(rawSince);
  104    if (!parsed.success) return null;
  105    const session = await qApiSession();
  106    if (session === null) return null;
  107    const now = Date.now();
  108    const since = parsed.data ?? new Date(now - 24 * 3_600_000).toISOString();
  109    const [account, sinceRead, approvals, workforce, done, notices] =
  110      await Promise.all([
  111        accountDetails().catch(() => null),
  112        getQWorkSince(session, since).catch(() => null),
  113        pendingQApprovalsAction().catch(() => null),
  114        loadWorkforceAction().catch(() => null),
  115        listDoneAction().catch(() => null),
  116        listNoticesAction().catch(() => null),
  117      ]);
  118    const waitingNotices =
  119      notices?.ok === true
  120        ? groupNotices(notices.value.items).needsYou.map(
  121            (group) => group.notice.title,
  122          )
  123        : [];
  124    const waiting = approvals?.ok === true ? approvals.value : [];
  125    const read = await Promise.all(
  126      waiting
  127        .slice(0, CARDS_MAX)
  128        .map((approval) =>
  129          readQApprovalAction(approval.approvalId).catch(() => null),
  130        ),
  131    );
  132    const views = new Map<string, QApprovalView>();
  133    for (const result of read) {
  134      if (result?.ok === true) views.set(result.value.approvalId, result.value);
  135    }
  136    const groups = decisionGroups({
  137      approvals: waiting,
  138      views,
  139      jobs: workforce?.jobs ?? [],
  140      now,
  141      known: done?.ok === true ? done.value.items : undefined,
  142    });
  143    // One card per decision, in the queue's order, bounded.
  144    const flat = groups
  145      .flatMap((group) => group.items.map((item) => ({ group, item })))
  146      .slice(0, CARDS_MAX);
  147    const threads = new Map<string, Promise<ChatThreadDto | null>>();
  148    const threadOf = (relationshipId: string) => {
  149      let read = threads.get(relationshipId);
  150      if (read === undefined) {
  151        read = chatThreadAction(relationshipId)
  152          .then((result) => (result.ok ? result.value : null))
  153          .catch(() => null);
  154        threads.set(relationshipId, read);
  155      }
  156      return read;
  157    };
  158    const cards = await Promise.all(
  159      flat.map(async ({ group, item }): Promise<ArrivalCard> => {
  160        const theySaid =
  161          group.relationshipId === null
  162            ? null
  163            : theirLatest(await threadOf(group.relationshipId));
  164        if (item.kind === "HELD") {
  165          return {
  166            key: item.draftId,
  167            kind: "HELD",
  168            approvalId: null,
  169            draftId: item.draftId,
  170            relationshipId: group.relationshipId,
  171            counterpart: group.name,
  172            named: group.named,
  173            title: decisionTitle(item),
  174            summary: item.reason,
  175            message: item.body,
  176            theySaid,
  177            reason: item.reason,
  178            canDecide: true,
  179            at: item.at,
  180          };
  181        }
  182        const shown = shownOf(item.view);
  183        return {
  184          key: item.approvalId,
  185          kind: "APPROVAL",
  186          approvalId: item.approvalId,
  187          draftId: null,
  188          relationshipId: group.relationshipId,
  189          counterpart: group.name,
  190          named: group.named,
  191          title: decisionTitle(item),
  192          summary: item.summary,
  193          message: shown.message,
  194          theySaid,
  195          reason: shown.preview,
  196          // Never decided unseen: a card whose content could not be read is
  197          // decided on Work, where it is read in full.
  198          canDecide: item.view?.canDecide === true,
  199          at: item.at,
  200        };
  201      }),
  202    );
  203    return {
  204      firstName: firstNameOf(account?.displayName),
  205      timeZone: sinceRead?.timeZone ?? null,
  206      activity: activityOf(sinceRead),
  207      hoursAway:
  208        parsed.data === null
  209          ? null
  210          : Math.max(0, (now - Date.parse(parsed.data)) / 3_600_000),
  211      cards,
  212      waiting: waitingNotices,
  213    };
  214  }
  215
  216  const Id = z.string().uuid();
  217  const DecideInput = z.discriminatedUnion("kind", [
  218    z.object({
  219      kind: z.literal("APPROVE"),
  220      approvalId: Id,
  221      /** What the person was shown; the decision is refused if it differs. */
  222      shown: z.string().max(8_000).nullable(),
  223    }),
  224    z.object({
  225      kind: z.literal("SEND_EDITED"),
  226      relationshipId: Id,
  227      body: z.string().trim().min(1).max(4_000),
  228      idempotencyKey: z
  229        .string()
  230        .min(8)
  231        .max(120)
  232        .regex(/^[A-Za-z0-9_-]+$/u),
  233      replacesApprovalId: Id.nullable(),
  234    }),
  235    z.object({ kind: z.literal("DISMISS_APPROVAL"), approvalId: Id }),
  236    z.object({
  237      kind: z.literal("RETRY_HELD"),
  238      draftId: Id,
  239      relationshipId: Id.nullable(),
  240      idempotencyKey: z
  241        .string()
  242        .min(8)
  243        .max(120)
  244        .regex(/^[A-Za-z0-9_-]+$/u),
  245    }),
  246  ]);
  247
  248  export type ArrivalDecision = z.input<typeof DecideInput>;
  249
  250  export type ArrivalDecisionResult =
  251    | {
  252        readonly ok: true;
  253        /** What came of it, when more than "done" (a retry's outcome). */
  254        readonly message?: string | undefined;
  255        /** New cards may be waiting: read the briefing again. */
  256        readonly reload?: true | undefined;
  257      }
  258    | {
  259        readonly ok: false;
  260        readonly message: string;
  261        /** The card changed since it was shown: read it again. */
  262        readonly changed?: true;
  263      };
  264
  265  /**
  266   * One decision on one card, as the person made it (a button, or their own
  267   * words read by code). Input from the browser, validated here; the server
  268   * resolves who they are and verifies its own payload hash on approve.
  269   */
  270  export async function decideArrivalCardAction(
  271    raw: ArrivalDecision,
  272  ): Promise<ArrivalDecisionResult> {
  273    const parsed = DecideInput.safeParse(raw);
  274    if (!parsed.success) {
  275      return { ok: false, message: "That didn't go through. Nothing was sent." };
  276    }
  277    const input = parsed.data;
  278    switch (input.kind) {
  279      case "APPROVE": {
  280        // Approval binds to exactly what was seen: read it again first.
  281        const view = await readQApprovalAction(input.approvalId).catch(
  282          () => null,
  283        );
  284        if (view?.ok !== true || !view.value.canDecide) {
  285          return {
  286            ok: false,
  287            message: "Already decided or expired. Nothing more is sent from it.",
  288            changed: true,
  289          };
  290        }
  291        const now = shownOf(view.value);
  292        if (!sameShownMessage(input.shown, now.message ?? now.preview)) {
  293          return {
  294            ok: false,
  295            message: "It changed since you saw it. Here's the current version.",
  296            changed: true,
  297          };
  298        }
  299        const result = await approveQApprovalAction(input.approvalId).catch(
  300          () => null,
  301        );
  302        return result?.ok === true
  303          ? { ok: true }
  304          : {
  305              ok: false,
  306              message:
  307                result?.message ?? "That didn't go through. Nothing was sent.",
  308            };
  309      }
  310      case "SEND_EDITED": {
  311        const sent = await sendChatMessageAction(
  312          input.relationshipId,
  313          { kind: "TEXT", body: input.body },
  314          input.idempotencyKey,
  315        ).catch(() => null);
  316        if (sent?.ok !== true) {
  317          return {
  318            ok: false,
  319            message: sent?.message ?? "That didn't send. Try again.",
  320          };
  321        }
  322        // Their own message went; the card Q drafted is declined.
  323        if (input.replacesApprovalId !== null) {
  324          await rejectQApprovalAction(input.replacesApprovalId).catch(() => null);
  325        }
  326        return { ok: true };
  327      }
  328      case "RETRY_HELD": {
  329        const result = await retryHeldAction({
  330          draftId: input.draftId,
  331          relationshipId: input.relationshipId,
  332          idempotencyKey: input.idempotencyKey,
  333        });
  334        return result.ok
  335          ? { ok: true, message: result.message, reload: true }
  336          : { ok: false, message: result.message };
  337      }
  338      case "DISMISS_APPROVAL": {
  339        const result = await rejectQApprovalAction(input.approvalId).catch(
  340          () => null,
  341        );
  342        return result?.ok === true
  343          ? { ok: true }
  344          : { ok: false, message: "That didn't go through. Try again." };
  345      }
  346    }
  347  }
```
