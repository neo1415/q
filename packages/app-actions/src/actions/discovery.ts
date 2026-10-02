import { z } from "zod";

import {
  InteractionRecordedDtoSchema,
  PassCompanyRequestSchema,
  SaveCompanyRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { InteractionOutcome } from "@capital-q/discovery";

import { defineAppAction, type AnyAppAction } from "../define.js";

/**
 * Save, Unsave, Pass and Undo pass (doc 19 §66–§69): the feed's own
 * decisions, each on its own path so the verb is in the URL, never in a
 * field. For Q they are the person's own word, done at once (INSTANT),
 * idempotent on a key derived from the run, and never touch the mandate.
 */

const DECISIONS = [
  {
    type: "SAVE",
    name: "discovery.company.save",
    tool: "save_company",
    path: "/v1/discovery/companies/:companyId/save",
    verb: "Saves",
    say: ["Save {name} for me.", "Put {name} in my saved list."],
    done: (name: string) =>
      `Saved ${name}. Saving isn't interest; they aren't told.`,
  },
  {
    type: "UNSAVE",
    name: "discovery.company.unsave",
    tool: "unsave_company",
    path: "/v1/discovery/companies/:companyId/unsave",
    verb: "Removes from Saved",
    say: ["Unsave {name}.", "Take {name} out of my saved companies."],
    done: (name: string) => `Removed ${name} from Saved.`,
  },
  {
    type: "PASS",
    name: "discovery.company.pass",
    tool: "pass_company",
    path: "/v1/discovery/companies/:companyId/pass",
    verb: "Passes on",
    say: ["Pass on {name}.", "I'm not interested in {name}, skip it."],
    done: (name: string) =>
      `Passed on ${name}. It stays in Passed, where Undo pass brings it back.`,
  },
  {
    type: "UNPASS",
    name: "discovery.company.unpass",
    tool: "unpass_company",
    path: "/v1/discovery/companies/:companyId/unpass",
    verb: "Undoes a pass on",
    say: ["Undo my pass on {name}.", "Bring {name} back into my feed."],
    done: (name: string) =>
      `Undid the pass on ${name}; it can appear in Discover again.`,
  },
] as const;

export const DecisionInputSchema = z
  .object({
    companyId: UuidSchema,
    clientEventId: z.string().regex(/^[A-Za-z0-9_:-]{8,64}$/),
    sessionId: z
      .string()
      .regex(/^[A-Za-z0-9_:-]{8,64}$/)
      .optional(),
    slateId: UuidSchema.optional(),
    surface: SaveCompanyRequestSchema.shape.surface,
    reason: PassCompanyRequestSchema.shape.reason,
  })
  .strict();
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

const ToolInputSchema = z
  .object({
    company: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        "The company, by its name as the person said it (or its id), from any page.",
      ),
  })
  .strict();

export const DISCOVERY_DECISIONS: readonly AnyAppAction[] = DECISIONS.map(
  (decision) =>
    defineAppAction<
      DecisionInput,
      InteractionOutcome,
      z.infer<typeof ToolInputSchema>
    >({
      name: decision.name,
      area: "discovery",
      classification: "INSTANT",
      does: `${decision.verb} a company in Discover, as the feed's own button does.`,
      input: DecisionInputSchema,
      output: z.custom<InteractionOutcome>(),
      // The interaction service authorises inside the command (the slate
      // is theirs, the company still visible); a refusal is its outcome.
      authorize: (ports) =>
        Promise.resolve(
          ports.interactions === undefined
            ? { ok: false, reason: "Discover isn't available here." }
            : { ok: true },
        ),
      run: async (ports, context, input) => {
        if (ports.interactions === undefined) {
          throw new Error("DISCOVERY_NOT_AVAILABLE");
        }
        return ports.interactions.decide(decision.type, {
          actor: context.actor,
          companyId: input.companyId,
          surface: input.surface,
          clientEventId: input.clientEventId,
          ...(input.sessionId === undefined
            ? {}
            : { sessionId: input.sessionId }),
          ...(input.slateId === undefined ? {} : { slateId: input.slateId }),
          ...(decision.type === "PASS" && input.reason !== undefined
            ? { passReason: input.reason }
            : {}),
        });
      },
      targets: (input) => [{ kind: "COMPANY", companyId: input.companyId }],
      card: () => ({
        summary: `${decision.verb} the company`,
        preview: "Only your own Discover changes; the company isn't told.",
      }),
      succeeded: (out) => out.kind === "RECORDED",
      done: (out, _input, names) =>
        out.kind === "RECORDED"
          ? decision.done(names["company"] ?? "the company")
          : "That company isn't one you can act on in Discover now.",
      http: {
        method: "POST",
        path: decision.path,
        fromRequest: (params, body) => ({
          ...(typeof body === "object" && body !== null ? body : {}),
          companyId: params["companyId"],
        }),
        // Every refusal is the same 404 (a slate not yours, a company no
        // longer visible and one that never existed look alike).
        notFound: (out) => out.kind !== "RECORDED",
        respond: (out) =>
          InteractionRecordedDtoSchema.parse({
            recorded: true,
            deduplicated: out.kind === "RECORDED" ? out.deduplicated : false,
            state:
              out.state === undefined
                ? null
                : { saved: out.state.saved, passed: out.state.passed },
          }),
        idempotencyKeyOf: (input) => input.clientEventId,
      },
      tool: {
        name: decision.tool,
        description: `${decision.verb} one company in the person's Discover, exactly as the button does, from any page: name it as they said it. Their own word, done at once; it never changes their mandate and the company is not told.`,
        input: ToolInputSchema,
        references: { company: "COMPANY" },
        eval: { say: decision.say, names: "COMPANY" },
        toCanonical: (input, context) =>
          Promise.resolve({
            companyId: input.company,
            clientEventId: context.idempotencyKey,
            surface: "Q_CONVERSATION" as const,
          }),
      },
    }),
);
