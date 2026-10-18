# Text message execution (typed Q turn)

Source: `apps/q-api/src/http/q-runs.ts`, `packages/q-orchestrator/src/{orchestrator,graph}.ts`, `packages/q-specialists/src/answer.ts`, `packages/model-gateway/src/q/index.ts`. Line numbers are in `03-Q-BRAIN.md`.

```mermaid
sequenceDiagram
  autonumber
  participant W as Web (askQAction)
  participant API as q-api POST /v1/q/runs
  participant RT as QRuntimeService
  participant OR as LangGraph orchestrator
  participant FW as Context Firewall
  participant SA as Specialist answer seam (answer.ts)
  participant TR as Turn reader (TURN_READER v44)
  participant GA as Conversational analyst (index.ts)
  participant TL as Tool registry/executor
  participant DB as q_runtime (messages, run_events)
  W->>API: {capability, message, conversationId?, screen?, opening?} + Idempotency-Key
  API->>RT: createRun (RECEIVED)
  API-->>W: 202 RECEIVED (Location)
  API->>OR: start() detached
  OR->>RT: begin (PREFLIGHT)
  OR->>SA: preread (early turn reading, ADR 0035)
  OR->>FW: plan(actor, subjects, screen)
  alt DENIED
    OR->>RT: fail POLICY_DENIED ("not available in your access context")
  else AUTHORISED
    OR->>OR: retrieval node (evidence.port; result kind only)
    OR->>SA: answer(request + plan)
    SA->>GA: warm() prefetch: history 64, context, tools, memory, own facts
    SA->>SA: screenActOf / pageAnswer (code, no model)
    SA->>TR: read(last 6 turns x 400 chars, actions)
    TR-->>SA: kind, confidence, tool, appAction, reference, heardAs...
    alt hand / app action / hand-over / reference / pending decision
      SA->>TL: run declared tool (authorize)
      SA->>DB: recordAnswer (message + q.message.completed) or prepared card
    else answerOnce
      SA->>GA: delegate.answer (or Company specialist)
      GA->>GA: renderPrompt(Q_SYSTEM v2 + COMPANY_ANALYST v21)
      loop <=2 rounds (+recovery), <=10 calls
        GA->>TL: tool calls (Zod, plan, authorize, sensitivity)
      end
      GA-->>W: sentence deltas (live bus)
      GA->>DB: persistAnswer (message + q.message.completed, one tx)
    end
    OR->>OR: action_prepare (proposal board -> Approval Engine)
    opt proposal
      OR->>OR: approval_gate interrupt (AWAITING_APPROVAL)
    end
    OR->>RT: complete / fail
  end
```
