# Evidence: apps/web/src/features/work/decision-queue.tsx lines 199-260

- Original path: `apps/web/src/features/work/decision-queue.tsx`
- Line range: 199-260 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Needs you count = decision items + extraCount (lead's 2026-10-08 fix).

```ts
  199  // Needs you
  200  // ---------------------------------------------------------------------------
  201  
  202  export function DecisionQueue({
  203    groups,
  204    jobs,
  205    done,
  206    renderPlan,
  207    onDecided,
  208    extra,
  209    extraCount = 0,
  210  }: {
  211    readonly groups: readonly DecisionGroup[];
  212    readonly jobs: readonly WorkforceJobDetailDto[];
  213    readonly done: readonly QWorkDoneItemDto[];
  214    /** A card that is not a message (a plan, a grant): its own approval view. */
  215    readonly renderPlan: (approvalId: string, onDone: () => void) => ReactNode;
  216    /** An approval decided, or a held draft let go. */
  217    readonly onDecided: (key: string) => void;
  218    /** Other things waiting on them (times to pick, notices), as rows. */
  219    readonly extra?: ReactNode;
  220    /** How many rows `extra` holds: they wait on them too, so they count. */
  221    readonly extraCount?: number;
  222  }) {
  223    const [all, setAll] = useState(false);
  224    // Live 2026-10-08: "Needs you 0 · Nothing waits on you" above two rows
  225    // saying an investor was waiting for a reply.
  226    const count =
  227      groups.reduce((sum, group) => sum + group.items.length, 0) + extraCount;
  228    const shown = all ? groups : groups.slice(0, QUEUE_PREVIEW);
  229    return (
  230      <section aria-labelledby="work-needs-you" data-work-needs-you>
  231        <h2
  232          id="work-needs-you"
  233          className="flex items-baseline gap-2 cq-title-sm text-(--cq-text-primary)"
  234        >
  235          Needs you
  236          <span className="cq-body font-normal cq-numeric text-(--cq-text-tertiary)">
  237            {count}
  238          </span>
  239        </h2>
  240        <p className="mt-0.5 mb-3 cq-label font-normal text-(--cq-text-tertiary)">
  241          {count === 0
  242            ? "Nothing waits on you. When Q drafts a reply or wants your yes, it shows here first; nothing is sent until you decide."
  243            : "Nothing below is sent until you decide."}
  244        </p>
  245        {shown.map((group, index) => (
  246          <GroupView
  247            key={group.key}
  248            group={group}
  249            jobs={jobs}
  250            done={done}
  251            readAhead={index < READ_AHEAD}
  252            renderPlan={renderPlan}
  253            onDecided={onDecided}
  254          />
  255        ))}
  256        {all || groups.length <= QUEUE_PREVIEW ? null : (
  257          <MoreButton onClick={() => setAll(true)}>
  258            Show {groups.length - QUEUE_PREVIEW} more
  259          </MoreButton>
  260        )}
```
