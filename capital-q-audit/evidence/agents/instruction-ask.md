# Evidence: apps/q-api/src/composition/instructions/ask.ts lines 1-153

- Original path: `apps/q-api/src/composition/instructions/ask.ts`
- Line range: 1-153 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: ASK step -> Approval Engine card in the instruction's own Q conversation. Complete module.

```ts
    1  import { randomUUID } from "node:crypto";
    2  
    3  import {
    4    CorrelationIdSchema,
    5    QConversationIdSchema,
    6  } from "@capital-q/contracts";
    7  import type { QActionService } from "@capital-q/q-actions";
    8  import {
    9    runRef,
   10    type QOrchestrationRuntime,
   11    type QRuntimeService,
   12  } from "@capital-q/q-runtime";
   13  import {
   14    AuthUserIdSchema,
   15    OrganisationIdSchema,
   16    resolveHumanActorContext,
   17    type ActorContext,
   18    type ActorContextResolver,
   19  } from "@capital-q/security";
   20  
   21  import type { InstructionRow, InstructionStore } from "./store.js";
   22  
   23  /**
   24   * An ASK step of a standing instruction (ADR 0043): the same `app.<name>`
   25   * card the person's own request would prepare, in the instruction's own Q
   26   * conversation. The run is begun under its own orchestration version, so an
   27   * approval never resumes the conversational engine for it: the approved
   28   * continuation sends it straight through the Approval Engine's execution
   29   * gate, which re-verifies the approval and the person's authority now.
   30   */
   31  export const INSTRUCTION_ORCHESTRATION_VERSION = "q-instruction-v1";
   32  
   33  export function createInstructionAsk(dependencies: {
   34    readonly runtime: Pick<QRuntimeService, "createRun">;
   35    readonly orchestration: Pick<
   36      QOrchestrationRuntime,
   37      "begin" | "advanceThrough" | "fail" | "complete"
   38    >;
   39    readonly actions: Pick<QActionService, "propose">;
   40    readonly store: Pick<InstructionStore, "own" | "setConversation">;
   41  }) {
   42    return async (
   43      actor: ActorContext,
   44      card: {
   45        readonly instructionId: string;
   46        readonly actionType: string;
   47        readonly payload: unknown;
   48        readonly words: string;
   49        readonly key: string;
   50      },
   51    ): Promise<{ readonly qActionId: string } | null> => {
   52      // Only the person's own instruction asks in their name.
   53      const instruction = await dependencies.store.own(actor, card.instructionId);
   54      if (instruction === null) return null;
   55      const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
   56      const created = await dependencies.runtime.createRun({
   57        actor,
   58        input: {
   59          capability: "PREPARE_ACTION",
   60          message: {
   61            text: `Standing instruction "${instruction.goal_text.slice(0, 200)}": ${card.words}`.slice(
   62              0,
   63              1_000,
   64            ),
   65          },
   66          modality: "TEXT",
   67          ...(instruction.conversation_id === null
   68            ? {}
   69            : {
   70                conversationId: QConversationIdSchema.parse(
   71                  instruction.conversation_id,
   72                ),
   73              }),
   74        },
   75        idempotencyKey: card.key,
   76        correlationId,
   77      });
   78      if (instruction.conversation_id === null) {
   79        await dependencies.store.setConversation(
   80          instruction.id,
   81          created.conversation.id,
   82        );
   83      }
   84      const ref = runRef(created.run);
   85      try {
   86        if (created.created) {
   87          await dependencies.orchestration.begin(
   88            ref,
   89            INSTRUCTION_ORCHESTRATION_VERSION,
   90          );
   91          await dependencies.orchestration.advanceThrough(ref, [
   92            "CONTEXT_RESOLUTION",
   93            "POLICY_CHECK",
   94            "PLANNING",
   95            "SYNTHESIS",
   96          ]);
   97        }
   98        const proposed = await dependencies.actions.propose({
   99          actor,
  100          runId: created.run.id,
  101          correlationId,
  102          actionType: card.actionType,
  103          payload: card.payload,
  104        });
  105        // The same card already waits on them (its own run waits on it), or
  106        // the change is already done: nothing waits on THIS run, so it ends
  107        // now. Left open it sat in SYNTHESIS until the orphan sweep failed
  108        // it as RUN_EXPIRED (autopilot P1, live 2026-10-06: three a firing).
  109        if (
  110          created.created &&
  111          (proposed.existing === true || proposed.alreadyDone !== undefined)
  112        ) {
  113          await dependencies.orchestration.complete(ref).catch(() => undefined);
  114        }
  115        return { qActionId: proposed.action.id };
  116      } catch (error: unknown) {
  117        // Nothing waits on this run: it ends rather than lingering.
  118        await dependencies.orchestration
  119          .fail(ref, "INTERNAL_ERROR")
  120          .catch(() => undefined);
  121        throw error;
  122      }
  123    };
  124  }
  125  
  126  /**
  127   * The person a standing instruction acts as, resolved NOW through the same
  128   * resolver a request uses: a revoked membership or a disabled account means
  129   * Q no longer acts for them.
  130   */
  131  export function createInstructionActor(dependencies: {
  132    readonly resolver: ActorContextResolver;
  133    readonly authUserOf: (userId: string) => Promise<string | null>;
  134  }) {
  135    return async (row: InstructionRow): Promise<ActorContext | null> => {
  136      const authUserId = AuthUserIdSchema.safeParse(
  137        await dependencies.authUserOf(row.user_id),
  138      );
  139      if (!authUserId.success) return null;
  140      const organisationId =
  141        row.organisation_id === null
  142          ? undefined
  143          : OrganisationIdSchema.parse(row.organisation_id);
  144      const resolution = await resolveHumanActorContext(dependencies.resolver, {
  145        principal: { authUserId: authUserId.data },
  146        selection: organisationId === undefined ? {} : { organisationId },
  147      });
  148      return resolution.status === "RESOLVED" &&
  149        resolution.context.userId === row.user_id
  150        ? resolution.context
  151        : null;
  152    };
  153  }
```
