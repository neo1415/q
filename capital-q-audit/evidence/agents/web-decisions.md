# Evidence: apps/web/src/features/work/decisions.ts lines 56-245

- Original path: `apps/web/src/features/work/decisions.ts`
- Line range: 56-245 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: heldDecisions/decisionGroups: a near-miss draft (outcome HELD) and its approval card appear as two items.

```ts
   56  export function relationshipOf(view: QApprovalView | null): string | null {
   57    for (const one of view?.action.targets ?? []) {
   58      if (one.kind === "RELATIONSHIP") return one.relationshipId;
   59    }
   60    return null;
   61  }
   62  
   63  /** The drafts behind the card an approval binds to. */
   64  export function draftsForApproval(
   65    jobs: readonly WorkforceJobDetailDto[],
   66    approvalId: string,
   67  ): readonly WorkforceDraftDto[] {
   68    for (const job of jobs) {
   69      const last = job.drafts.find(
   70        (draft) => draft.outcome?.approvalId === approvalId,
   71      );
   72      if (last !== undefined) return draftChain(job.drafts, last);
   73    }
   74    return [];
   75  }
   76  
   77  /** How long a held draft stays a decision before it is history. */
   78  const HELD_DAYS = 7;
   79  
   80  /**
   81   * Held drafts still worth a decision: the latest per counterpart, within
   82   * a week, and not followed by a later message to them that was sent or
   83   * offered (that one superseded it).
   84   */
   85  export function heldDecisions(
   86    jobs: readonly WorkforceJobDetailDto[],
   87    now: number,
   88    dismissed: ReadonlySet<string> = new Set(),
   89  ): readonly (HeldDecision & { readonly name: string | null })[] {
   90    const all = jobs.flatMap((job) =>
   91      job.drafts.map((draft) => ({ job, draft })),
   92    );
   93    const out: (HeldDecision & { readonly name: string | null })[] = [];
   94    const seen = new Set<string>();
   95    const newestFirst = [...all].sort((a, b) =>
   96      b.draft.createdAt.localeCompare(a.draft.createdAt),
   97    );
   98    for (const { job, draft } of newestFirst) {
   99      const name = draft.counterpartName;
  100      const who = name ?? draft.id;
  101      if (seen.has(who)) continue;
  102      if (draft.outcome === null) continue;
  103      seen.add(who);
  104      if (draft.outcome.outcome !== "HELD") continue;
  105      if (dismissed.has(draft.id)) continue;
  106      if (now - Date.parse(draft.createdAt) > HELD_DAYS * 86_400_000) continue;
  107      out.push({
  108        kind: "HELD",
  109        draftId: draft.id,
  110        body: draft.body,
  111        reason:
  112          HELD_WORDS[draft.outcome.reason ?? ""] ??
  113          "Q didn't send it. Read it and decide.",
  114        at: draft.createdAt,
  115        drafts: draftChain(job.drafts, draft),
  116        name,
  117      });
  118    }
  119    return out;
  120  }
  121  
  122  /**
  123   * The decision queue: one group per company or person, newest first;
  124   * inside a group, its cards newest first. A group is keyed by the
  125   * relationship where the card names one, else by who it is aimed at.
  126   */
  127  export function decisionGroups(input: {
  128    readonly approvals: readonly QPendingApproval[];
  129    readonly views: ReadonlyMap<string, QApprovalView>;
  130    readonly jobs: readonly WorkforceJobDetailDto[];
  131    readonly now: number;
  132    readonly dismissedHeld?: ReadonlySet<string> | undefined;
  133    /** Names and relationships already known (from the done list). */
  134    readonly known?: readonly QWorkDoneItemDto[] | undefined;
  135  }): readonly DecisionGroup[] {
  136    const groups = new Map<
  137      string,
  138      {
  139        key: string;
  140        name: string | null;
  141        named: NamedPicture | null;
  142        relationshipId: string | null;
  143        items: (Decision | HeldDecision)[];
  144        at: string;
  145      }
  146    >();
  147    const relationshipByName = new Map<string, string>();
  148    for (const item of input.known ?? []) {
  149      if (
  150        item.counterpartName != null &&
  151        item.relationshipId != null &&
  152        !relationshipByName.has(item.counterpartName)
  153      ) {
  154        relationshipByName.set(item.counterpartName, item.relationshipId);
  155      }
  156    }
  157    const add = (
  158      key: string,
  159      seed: Omit<DecisionGroup, "items" | "at" | "key">,
  160      item: Decision | HeldDecision,
  161    ) => {
  162      const group = groups.get(key) ?? {
  163        key,
  164        ...seed,
  165        items: [],
  166        at: item.at,
  167      };
  168      group.items.push(item);
  169      if (item.at > group.at) group.at = item.at;
  170      group.name ??= seed.name;
  171      group.named ??= seed.named;
  172      group.relationshipId ??= seed.relationshipId;
  173      groups.set(key, group);
  174    };
  175  
  176    for (const approval of input.approvals) {
  177      const view = input.views.get(approval.approvalId) ?? null;
  178      const drafts = draftsForApproval(input.jobs, approval.approvalId);
  179      const name = drafts.at(-1)?.counterpartName ?? null;
  180      const relationshipId =
  181        relationshipOf(view) ??
  182        (name === null ? null : (relationshipByName.get(name) ?? null));
  183      const key =
  184        relationshipId ??
  185        approval.named?.id ??
  186        (name === null ? `approval:${approval.approvalId}` : `name:${name}`);
  187      add(
  188        key,
  189        { name, named: approval.named ?? null, relationshipId },
  190        {
  191          kind: "APPROVAL",
  192          approvalId: approval.approvalId,
  193          summary: approval.summary,
  194          at: approval.requestedAt,
  195          named: approval.named ?? null,
  196          view,
  197          drafts,
  198        },
  199      );
  200    }
  201  
  202    for (const held of heldDecisions(
  203      input.jobs,
  204      input.now,
  205      input.dismissedHeld,
  206    )) {
  207      const relationshipId =
  208        held.name === null ? null : (relationshipByName.get(held.name) ?? null);
  209      // Join the group of the same relationship, else the same name.
  210      const existing = [...groups.values()].find(
  211        (group) =>
  212          (relationshipId !== null && group.relationshipId === relationshipId) ||
  213          (held.name !== null && group.name === held.name),
  214      );
  215      const key =
  216        existing?.key ??
  217        relationshipId ??
  218        (held.name === null ? `held:${held.draftId}` : `name:${held.name}`);
  219      const { name, ...item } = held;
  220      add(key, { name, named: null, relationshipId }, item);
  221    }
  222  
  223    return [...groups.values()]
  224      .map((group) => ({
  225        ...group,
  226        items: [...group.items].sort((a, b) => b.at.localeCompare(a.at)),
  227      }))
  228      .sort((a, b) => b.at.localeCompare(a.at));
  229  }
  230  
  231  export type DoneGroup = {
  232    readonly key: string;
  233    readonly name: string | null;
  234    readonly named: NamedPicture | null;
  235    readonly relationshipId: string | null;
  236    readonly linkPath: string | null;
  237    /** Newest first. */
  238    readonly items: readonly QWorkDoneItemDto[];
  239  };
  240  
  241  /**
  242   * What Q did, per relationship, newest first. Items are read a page at a
  243   * time by cursor; a later page's items join the groups already shown.
  244   */
  245  export function doneGroups(
```
