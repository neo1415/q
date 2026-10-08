# Evidence: apps/web/src/features/work/work-page.tsx lines 140-270

- Original path: `apps/web/src/features/work/work-page.tsx`
- Line range: 140-270 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Work page composition: decisionGroups + notices extraCount.

```ts
  140    initialView,
  141    liveReads = true,
  142  }: Props) {
  143    const running = (work ?? []).filter((item) => item.status === "ACTIVE");
  144    const timeLanes = running.flatMap((item) =>
  145      item.lanes
  146        .filter((lane) => lane.stage === "NEEDS_TIMES" && lane.offered.length > 0)
  147        .map((lane) => ({ work: item, lane })),
  148    );
  149    const [cards, setCards] = useState(suggestions ?? []);
  150    const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  151    const dismissedHeld = useDismissedHeld();
  152    // The Work count in the navigation is these notices (founder 2026-10-05:
  153    // "it says 2 things, but the page says nothing"): they are listed here.
  154    const notices = groupNotices(useNotices().items ?? []).needsYou;
  155    const [view, setView] = useState<WorkView>(initialView ?? "work");
  156    const live = useWorkforceLive(
  157      workforce,
  158      view === "team" || view === "work",
  159      liveReads,
  160    );
  161    const now = useClock();
  162    const team = live.data;
  163    const hasTeam = workforce !== undefined;
  164    const jobs = useMemo(() => team?.jobs ?? [], [team]);
  165    const viewMap = useMemo(() => new Map(Object.entries(views ?? {})), [views]);
  166    const groups = useMemo(
  167      () =>
  168        decisionGroups({
  169          approvals: (approvals ?? []).filter(
  170            (approval) => !gone.has(approval.approvalId),
  171          ),
  172          views: viewMap,
  173          jobs,
  174          now,
  175          dismissedHeld: new Set([...dismissedHeld, ...gone]),
  176          known: done?.items,
  177        }),
  178      [approvals, gone, viewMap, jobs, now, dismissedHeld, done],
  179    );
  180    const decided = (key: string) => setGone((was) => new Set([...was, key]));
  181  
  182    return (
  183      <div
  184        className={cx(
  185          "mx-auto flex w-full flex-col gap-7",
  186          // The team map needs the room; reading views keep the measure.
  187          view === "team" || view === "cost"
  188            ? "max-w-(--cq-layout-content)"
  189            : "max-w-(--cq-layout-reading)",
  190        )}
  191        data-work-page
  192      >
  193        {hasTeam ? (
  194          <nav
  195            aria-label="More about Q’s work"
  196            className="-mt-2 -mb-4 flex items-center gap-1"
  197            data-work-views
  198          >
  199            {view === "work" ? null : (
  200              <button
  201                type="button"
  202                onClick={() => setView("work")}
  203                className="inline-flex min-h-11 items-center px-2 cq-label text-(--cq-text-primary) hover:underline"
  204              >
  205                ← Back to Work
  206              </button>
  207            )}
  208            <span className="ml-auto" />
  209            {(
  210              [
  211                ["team", "Team map"],
  212                [
  213                  "cost",
  214                  team === null
  215                    ? "Cost"
  216                    : `Cost · ${usd(team.overview.spentUsd)}`,
  217                ],
  218              ] as const
  219            ).map(([key, label]) => (
  220              <button
  221                key={key}
  222                type="button"
  223                aria-pressed={view === key}
  224                onClick={() => setView(view === key ? "work" : key)}
  225                className={cx(
  226                  "inline-flex min-h-11 items-center px-2 cq-label font-normal",
  227                  view === key
  228                    ? "text-(--cq-text-primary) underline underline-offset-4"
  229                    : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
  230                )}
  231              >
  232                {label}
  233              </button>
  234            ))}
  235          </nav>
  236        ) : null}
  237        {view === "work" ? (
  238          <>
  239            <TaskComposer />
  240            <DecisionQueue
  241              groups={groups}
  242              jobs={jobs}
  243              done={done?.items ?? []}
  244              renderPlan={(approvalId, onDone) => (
  245                <>
  246                  <ApprovalPlan
  247                    approvalId={approvalId}
  248                    initialView={viewMap.get(approvalId)}
  249                    onDone={onDone}
  250                    onNotNow={() => {}}
  251                    hideNotNow
  252                  />
  253                  <DeclineLink approvalId={approvalId} onDeclined={onDone} />
  254                </>
  255              )}
  256              onDecided={decided}
  257              extraCount={timeLanes.length + notices.length}
  258              extra={
  259                <NeedsYou
  260                  approvals={[]}
  261                  lanes={timeLanes}
  262                  notices={notices}
  263                  onDecided={() => {}}
  264                  embedded
  265                />
  266              }
  267            />
  268            {approvals === null ? (
  269              <p
  270                className="-mt-4 cq-body-sm text-(--cq-text-secondary)"
```
