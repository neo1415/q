# Evidence: apps/web/src/features/work/decision-queue.tsx lines 436-470

- Original path: `apps/web/src/features/work/decision-queue.tsx`
- Line range: 436-470 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Only actionType 'chat.message.send' renders as a message decision; instruction cards are 'app.chat.message.send'.

```ts
  436    const [pending, startTransition] = useTransition();
  437    const [status, setStatus] = useState<string | null>(null);
  438    const [editing, setEditing] = useState(false);
  439    const ask = useAskQ();
  440    const view = item.view;
  441    const message =
  442      view?.action.actionType === "chat.message.send"
  443        ? readPlan(view.action.preview).quote
  444        : null;
  445  
  446    const approve = () =>
  447      startTransition(async () => {
  448        setStatus(null);
  449        const result = await approveQApprovalAction(item.approvalId).catch(
  450          () => null,
  451        );
  452        if (result?.ok === true) onDecided();
  453        else
  454          setStatus(
  455            result?.message ?? "That didn't go through. Nothing was sent.",
  456          );
  457      });
  458    const dismiss = () =>
  459      startTransition(async () => {
  460        setStatus(null);
  461        const result = await rejectQApprovalAction(item.approvalId).catch(
  462          () => null,
  463        );
  464        if (result?.ok === true) onDecided();
  465        else setStatus("That didn't go through. Try again.");
  466      });
  467  
  468    // Not a message (a plan, a grant, an email): its own approval view.
  469    if (view === null || message === null) {
  470      return (
```
