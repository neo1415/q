import { randomUUID } from "node:crypto";

import { CorrelationIdSchema, QRunIdSchema } from "@capital-q/contracts";
import type { ContextFirewallPort, QToolPort } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

import type { CapitalQRecord } from "./deep-research.js";

/**
 * Investigation (owner 2026-10-29): beside the public web, the companies
 * on Capital Q the person may see. Read through the company search tool
 * (`company.search`), AS the person, under the plan the Context Firewall
 * gives them: classification picks candidates, the Permissions context
 * decides each one, and only network-visible or public profiles come back
 * -- never another tenant's private record. What comes back is each
 * company's own declared profile (USER_CLAIM), kept apart from web facts
 * by the caller and never put in an outbound query.
 */

const SEARCH_TOOL = "search_companies";
const TEXT_MAX = 120;

const OutputSchema = z.object({
  items: z
    .array(
      z.object({
        companyId: z.string().max(64),
        canonicalName: z.string().min(1).max(200),
        currentStageCode: z.string().max(64).nullable(),
        headquartersCountry: z.string().max(8).nullable(),
        shortDescription: z.string().nullable(),
      }),
    )
    .max(20),
});

export function createCapitalQRecords(dependencies: {
  readonly firewall: ContextFirewallPort;
  readonly tools: Pick<QToolPort, "execute">;
}) {
  return async (
    actor: ActorContext,
    query: { readonly text: string },
  ): Promise<readonly CapitalQRecord[] | null> => {
    const text = query.text.trim().slice(0, TEXT_MAX);
    if (text.length === 0) return [];
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const decision = await dependencies.firewall.plan({
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      subjects: [],
    });
    if (decision.outcome !== "AUTHORISED") return null;
    const outcome = await dependencies.tools.execute(
      {
        callId: randomUUID(),
        name: SEARCH_TOOL,
        arguments: { query: text, limit: 12 },
      },
      {
        actor,
        runId,
        correlationId,
        capability: "ANSWER",
        plan: decision.plan,
      },
    );
    if (outcome.status !== "SUCCEEDED" || !outcome.result.ok) return null;
    const parsed = OutputSchema.safeParse(outcome.result.data);
    if (!parsed.success) return null;
    return parsed.data.items.map((item) => ({
      companyId: item.companyId,
      name: item.canonicalName.slice(0, 200),
      stage: item.currentStageCode,
      country: item.headquartersCountry,
      description:
        item.shortDescription === null
          ? null
          : item.shortDescription.trim().slice(0, 400) || null,
    }));
  };
}
