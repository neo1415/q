# Evidence: apps/q-api/src/composition/workforce/jobs.ts lines 135-340

- Original path: `apps/q-api/src/composition/workforce/jobs.ts`
- Line range: 135-340 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Only MANDATE_WATCHER/OUTREACH(=watcher)/CONVERSATION/SCHEDULER executors exist; held drafts in a job are counted, not notified; scheduler books first free slot.

```ts
  135    readonly owner: Owner;
  136    readonly ports: WorkforcePorts;
  137    readonly models: Pick<WorkforceModels, "readReply">;
  138    readonly review: OutwardReview;
  139    /** Another agent in this job books calls: a wish to meet is its. */
  140    readonly scheduling: boolean;
  141  }): Partial<Record<AgentRole, AgentExecutor>> {
  142    const { owner, ports, models, review } = dependencies;
  143
  144    const has = (tools: readonly string[], tool: string) => tools.includes(tool);
  145    // One reading per message per job: the conversation and the scheduler
  146    // agents act on the same reading, and a reply is classified once.
  147    const readings = new Map<
  148      string,
  149      Promise<Awaited<ReturnType<WorkforceModels["readReply"]>>>
  150    >();
  151
  152    const watcher: AgentExecutor = async (step, context) => {
  153      if (!has(step.tools, "relationship.interest.express")) {
  154        return { status: "HELD", summary: "Not allowed to express interest." };
  155      }
  156      const matches = (await ports.mandateMatches(owner)).slice(0, MAX_PER_STEP);
  157      let expressed = 0;
  158      for (const match of matches) {
  159        const done = await ports
  160          .expressInterest(
  161            owner,
  162            match.companyId,
  163            `wf:${context.jobId}:interest:${match.companyId}`,
  164          )
  165          .catch(() => ({ ok: false }));
  166        if (done.ok) expressed += 1;
  167      }
  168      return {
  169        status: "DONE",
  170        summary:
  171          matches.length === 0
  172            ? "No new companies match your mandate."
  173            : `Expressed interest in ${plural(expressed, "company", "companies")} matching your mandate.`,
  174        outputs: { expressed },
  175      };
  176    };
  177
  178    /**
  179     * Conversation and scheduling share one pass over open replies: each
  180     * reply is read by meaning, then answered warmly, or offered times, or
  181     * booked, or handed to the person.
  182     */
  183    const conversation =
  184      (mode: "REPLY" | "SCHEDULE"): AgentExecutor =>
  185      async (step, context) => {
  186        if (
  187          !has(
  188            step.tools,
  189            mode === "REPLY" ? "chat.message.send" : "schedule.meeting.book",
  190          )
  191        ) {
  192          return { status: "HELD", summary: "Not allowed to do this step." };
  193        }
  194        const principalName = await ports.principalName(owner);
  195        const open = (await ports.openConversations(owner)).slice(
  196          0,
  197          MAX_PER_STEP,
  198        );
  199        let replied = 0;
  200        let booked = 0;
  201        let held = 0;
  202        let handed = 0;
  203        for (const one of open) {
  204          if (one.latest === null) continue;
  205          const latest = one.latest;
  206          const once =
  207            readings.get(latest.id) ??
  208            models.readReply(
  209              owner,
  210              { jobId: context.jobId, runId: context.runId },
  211              {
  212                principalName,
  213                counterpartName: one.counterpartName,
  214                thread: one.thread.slice(-4_000),
  215                latest: latest.text.slice(0, 4_000),
  216              },
  217            );
  218          readings.set(latest.id, once);
  219          const reading = await once;
  220          // Unreadable, a no, a not-now or an unhappy tone: the person's.
  221          if (
  222            reading === null ||
  223            stanceDeclines(reading.stance) ||
  224            reading.tone === "NEGATIVE"
  225          ) {
  226            if (mode === "REPLY") {
  227              handed += 1;
  228              await ports
  229                .notify(owner, {
  230                  key: `wf:${context.jobId}:${one.latest.id}`,
  231                  title:
  232                    reading === null
  233                      ? `Q couldn't read ${one.counterpartName}'s reply`
  234                      : `${one.counterpartName} may have said no`,
  235                  body: "Q didn't reply. Read their message and answer yourself if you want to.",
  236                })
  237                .catch(() => undefined);
  238            }
  239            continue;
  240          }
  241          if (mode === "SCHEDULE") {
  242            if (!reading.wantsMeeting) continue;
  243            const slots = await ports.freeSlots(owner, one.relationshipId);
  244            const first = slots[0];
  245            if (first === undefined) continue;
  246            const result = await ports
  247              .book(
  248                owner,
  249                one.relationshipId,
  250                `wf:${context.jobId}:book:${one.relationshipId}`,
  251                first,
  252              )
  253              .catch(() => ({ ok: false, meetingId: null }));
  254            if (result.ok) booked += 1;
  255            continue;
  256          }
  257          if (reading.wantsMeeting && dependencies.scheduling) {
  258            // The scheduler books it; a reply now would cross with the invite.
  259            continue;
  260          }
  261          const draft = await ports.writeReply(
  262            owner,
  263            one,
  264            "WARM_REPLY",
  265            workforceCorrelationId(context.jobId, context.runId),
  266          );
  267          if (draft === null) continue;
  268          const verdict = await review.review(
  269            owner,
  270            {
  271              kind: "DELEGATED_WORK",
  272              id: `job:${context.jobId}`,
  273              goal: step.goal,
  274            },
  275            {
  276              principalName,
  277              counterpartName: one.counterpartName,
  278              channel: "CHAT",
  279              stage: "REPLY",
  280              purpose: `A warm reply to ${one.counterpartName}'s latest message: ${step.goal}`,
  281              material: one.material,
  282              thread: one.thread,
  283              body: draft,
  284            },
  285            { job: { jobId: context.jobId, parentRunId: context.runId } },
  286          );
  287          if (verdict.verdict === "HELD") {
  288            held += 1;
  289            continue;
  290          }
  291          const sent = await ports
  292            .send(
  293              owner,
  294              one.relationshipId,
  295              `wf:${context.jobId}:reply:${one.latest.id}`,
  296              verdict.body,
  297            )
  298            .catch(() => false);
  299          if (sent) {
  300            replied += 1;
  301            await review.settle(owner, verdict, "SENT");
  302          }
  303        }
  304        const result: StepResult =
  305          mode === "SCHEDULE"
  306            ? {
  307                status: "DONE",
  308                summary:
  309                  booked === 0
  310                    ? "No calls to book yet."
  311                    : `Booked ${plural(booked, "call", "calls")}.`,
  312                outputs: { booked },
  313              }
  314            : {
  315                status: "DONE",
  316                summary: [
  317                  `Replied to ${plural(replied, "person", "people")}`,
  318                  held > 0
  319                    ? `held ${plural(held, "draft", "drafts")} below the bar`
  320                    : null,
  321                  handed > 0
  322                    ? `left ${plural(handed, "reply", "replies")} for you`
  323                    : null,
  324                ]
  325                  .filter((part) => part !== null)
  326                  .join("; ")
  327                  .concat("."),
  328                outputs: { replied, held, handed },
  329              };
  330        return result;
  331      };
  332
  333    return {
  334      MANDATE_WATCHER: watcher,
  335      OUTREACH: watcher,
  336      CONVERSATION: conversation("REPLY"),
  337      SCHEDULER: conversation("SCHEDULE"),
  338    };
  339  }
  340
```
