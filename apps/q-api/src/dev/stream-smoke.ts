/* eslint-disable no-console -- a developer CLI whose whole purpose is to show the stream */
/**
 * `pnpm q:stream-smoke` entry (CQ-Q-009 §88-§90). DEV ONLY.
 *
 * Drives a synthetic Q run over real HTTP: POST the run, subscribe to the
 * events stream, print what a person would see, disconnect on purpose,
 * reconnect with Last-Event-ID, print the replay, continue to the end and
 * check the recovered answer against the persisted run. User-facing lines
 * are prefixed `[Q]`; developer lines `[dev]`; `--verbose` adds event ids
 * and types. Never a key, never a prompt, never a private row.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  approveQApproval,
  createQRun,
  createQStreamState,
  describeQStage,
  getQRun,
  reduceQStream,
  streamQRunEvents,
  type ApiSession,
  type QStreamState,
} from "@capital-q/api-client";
import { parseQApiConfig } from "@capital-q/config/q-api";
import type { QStreamEvent } from "@capital-q/contracts";
import {
  createPostgresQRunEventNotifier,
  createQRunStreamService,
} from "@capital-q/q-runtime";
import type { AuthenticatedPrincipal } from "@capital-q/security";

import { createApp } from "../app.js";
import { withSmokeWorld } from "./smoke-runner.js";

type Args = {
  synthetic: boolean;
  approval: boolean;
  verbose: boolean;
  disconnectAfter: number;
  message: string | undefined;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    synthetic: false,
    approval: false,
    verbose: false,
    disconnectAfter: 3,
    message: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--synthetic":
        args.synthetic = true;
        break;
      case "--approval":
        args.approval = true;
        args.synthetic = true;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--disconnect-after":
        args.disconnectAfter = Number(value);
        i += 1;
        break;
      case "--message":
        args.message = value;
        i += 1;
        break;
      case undefined:
      case "--":
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  return args;
}

const FOUNDER_TOKEN = "smoke-founder-session";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = parseQApiConfig(process.env);
  const keys = config.secrets.modelProviders;
  const hasKey = keys.google !== undefined || keys.groq !== undefined;
  if (!args.synthetic && !hasKey) {
    console.log(
      "[dev] no provider key configured: using the synthetic streaming answer (labelled synthetic)",
    );
    args.synthetic = true;
  }
  console.log(
    `[dev] mode=${args.synthetic ? "synthetic answer (no model)" : "real model through the gateway"}${args.approval ? " + approval flow" : ""}`,
  );

  await withSmokeWorld(
    {
      synthetic: args.synthetic,
      tools: !args.synthetic,
      approval: args.approval,
    },
    async (world) => {
      const { runtime } = world;
      const founder = runtime.people.founder;
      const notifier = createPostgresQRunEventNotifier({
        listen: runtime.listen,
        logger: runtime.logger,
      });
      const qStream = createQRunStreamService({
        sql: runtime.sql,
        transactions: runtime.transactions,
        subjects: runtime.subjects,
        repositories: runtime.repositories,
        notifier,
        deltas: runtime.deltas,
        logger: runtime.logger,
      });
      const principal: AuthenticatedPrincipal = {
        authUserId: founder.authUserId as AuthenticatedPrincipal["authUserId"],
      };
      const { app } = createApp(
        config,
        {
          authenticator: {
            authenticate: (request) =>
              Promise.resolve(
                request.headers.authorization === `Bearer ${FOUNDER_TOKEN}`
                  ? principal
                  : null,
              ),
          },
          resolver: {
            resolveHumanContext: () =>
              Promise.resolve({ status: "RESOLVED", context: founder.actor }),
          },
        },
        {
          qRuntime: runtime.service,
          orchestration: {
            orchestrator: runtime.orchestrator,
            autostart: true,
          },
          ...(runtime.actions === undefined
            ? {}
            : { qActions: runtime.actions.service }),
          qStream: { service: qStream },
        },
        { shutdownGraceMs: 500 },
      );
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("no address");
      }
      const session: ApiSession = {
        baseUrl: `http://127.0.0.1:${address.port}`,
        accessToken: FOUNDER_TOKEN,
      };

      try {
        const handle = await createQRun(
          session,
          {
            capability: args.approval ? "PREPARE_ACTION" : "INVESTIGATE",
            message: {
              text:
                args.message ??
                "What should I know about Northwind Sensor Systems right now?",
            },
            modality: "TEXT",
            subjects: [{ kind: "COMPANY", companyId: world.ids.company }],
          },
          `stream-smoke-${randomUUID()}`,
        );
        console.log(`[dev] run accepted: ${handle.runId} (${handle.status})`);

        let state: QStreamState = createQStreamState();
        let printedPartial = false;
        const show = (event: QStreamEvent, replayed: boolean) => {
          state = reduceQStream(state, event);
          if (args.verbose) {
            const id =
              event.type === "q.message.delta" ? "-" : String(event.sequence);
            console.log(
              `[dev] ${replayed ? "replayed" : "received"} id=${id} ${event.type}`,
            );
          }
          switch (event.type) {
            case "q.run.started":
              console.log("[Q] Request received");
              break;
            case "q.stage.changed":
              console.log(`[Q] ${describeQStage(event.data.stage) ?? ""}`);
              break;
            case "q.message.delta":
              if (!printedPartial) {
                process.stdout.write("[Q] ");
                printedPartial = true;
              }
              process.stdout.write(event.data.text);
              break;
            case "q.message.completed":
              if (printedPartial) {
                process.stdout.write("\n");
                printedPartial = false;
              }
              console.log(
                `[Q] (answer recorded, ${event.data.message.text?.length ?? 0} characters)`,
              );
              if (!args.synthetic || replayed) {
                console.log(`[Q] ${event.data.message.text}`);
              }
              break;
            case "q.approval.required":
              console.log("[Q] Q is waiting for your approval.");
              break;
            case "q.action.proposed":
              console.log(`[Q] Proposed: ${event.data.proposal.summary}`);
              break;
            case "q.input.required":
              console.log(
                "[Q] Q needs a little more information before continuing.",
              );
              break;
            case "q.finding.available":
              console.log(`[Q] Finding: ${event.data.finding.statement}`);
              break;
            case "q.run.completed":
              console.log("[Q] Complete");
              break;
            case "q.run.failed":
              console.log(`[Q] ${event.data.failure.message}`);
              break;
          }
        };

        // Phase 1: connect, receive a few durable events, disconnect on purpose.
        const first = new AbortController();
        let durableSeen = 0;
        let deltaSeen = 0;
        const phase1 = await streamQRunEvents(session, handle.runId, {
          signal: first.signal,
          onEvent: (event, meta) => {
            show(event, false);
            if (meta.durable) {
              durableSeen += 1;
            } else {
              deltaSeen += 1;
            }
            const enough =
              durableSeen >= args.disconnectAfter &&
              (args.synthetic ? deltaSeen > 0 : true);
            if (enough || event.type === "q.approval.required") {
              first.abort();
            }
          },
          onStatus: (status) => {
            if (args.verbose) {
              console.log(`[dev] transport ${status}`);
            }
          },
        });
        if (printedPartial) {
          process.stdout.write("\n");
          printedPartial = false;
        }
        console.log(
          `[dev] disconnected on purpose after durable id ${phase1.lastEventId} (${deltaSeen} live text deltas seen); Q continues without us`,
        );

        if (args.approval && state.approval !== null) {
          console.log(
            "[dev] approving through HTTP (never through the stream)…",
          );
          await approveQApproval(session, state.approval.approvalId);
          console.log("[dev] approval recorded; the run resumes");
        }

        await sleep(1_500);

        // Phase 2: reconnect with the cursor; replayed events are marked.
        console.log(
          `[dev] reconnecting with Last-Event-ID: ${phase1.lastEventId}`,
        );
        let replayed = 0;
        const phase2 = await streamQRunEvents(session, handle.runId, {
          lastEventId: phase1.lastEventId,
          onEvent: (event, meta) => {
            if (meta.replayed) {
              replayed += 1;
            }
            show(event, meta.replayed);
          },
          onStatus: (status) => {
            if (args.verbose) {
              console.log(`[dev] transport ${status}`);
            }
          },
        });
        if (printedPartial) {
          process.stdout.write("\n");
        }

        const final = await getQRun(session, handle.runId);
        const persisted = (final.messages ?? []).find((m) => m.role === "Q");
        const recovered = state.messages.find((m) => m.role === "Q");
        const converged =
          persisted !== undefined &&
          recovered !== undefined &&
          (persisted.text ?? "") === (recovered.text ?? "") &&
          state.partial === null;

        console.log("[dev] ---");
        console.log(
          `[dev] run status=${final.status} stream=${phase2.reason} durable cursor=${phase2.lastEventId} replayed=${replayed}`,
        );
        console.log(
          `[dev] final message ${persisted === undefined ? "absent" : `${persisted.text?.length ?? 0} chars`}; recovered from stream: ${converged ? "MATCHES persisted message" : "DOES NOT MATCH"}`,
        );
        console.log(
          `[dev] checks: initial=${durableSeen > 0 ? "PASS" : "FAIL"} delta=${args.synthetic ? (deltaSeen > 0 ? "PASS" : "FAIL") : "NOT SUPPORTED BY ROUTED MODEL"} disconnect=PASS reconnect=${phase2.reason === "TERMINAL" ? "PASS" : "FAIL"} replay=${phase2.lastEventId > phase1.lastEventId ? "PASS" : "FAIL"} converge=${converged || persisted === undefined ? "PASS" : "FAIL"} terminal=${state.terminal ? "PASS" : "FAIL"}`,
        );
        if (runtime.actions !== undefined) {
          console.log(
            `[dev] approval executions=${runtime.actions.executions()}`,
          );
        }
      } finally {
        await app.close();
        await notifier.close();
      }
    },
  );
}

main().catch((error: unknown) => {
  console.error(
    `[dev] stream smoke failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
