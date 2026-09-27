import { z } from "zod";

import {
  Q_TASK_CLASSES,
  QClientActionToolResultSchema,
  QThemeChoiceSchema,
  QWebsiteUrlSchema,
  type PermittedContextPlan,
  type QClientActionIntent,
  type QClientActionToolResult,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
  type QToolAuthorization,
} from "../definition.js";
import { actorWideScope, scopesOfKind } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * Client actions (R20/R33; founder live test 2026-09-27 #4): what the app
 * itself does in the person's own browser — the theme, a reload, opening
 * their own website — which Q now does when asked, instead of saying it
 * cannot. The model chooses the tool; these steps decide.
 *
 * Each is the one write lane (LOW_RISK_INTERNAL / SIDE_EFFECT): an effect
 * on the caller's own screen, at their own word, reversible by the same
 * control on the page. Authorisation: a human in their own Q conversation
 * (the actor-wide own-conversation scope, filtered to them). The result is
 * the intent the answer carries to the screen; the browser performs it
 * through the same code its own controls use, once, as the answer arrives.
 */

export const SET_THEME = "client.theme.set" as const;
export const RELOAD_PAGE = "client.page.reload" as const;
export const OPEN_WEBSITE = "client.website.open" as const;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

function allowed(
  clientAction: QClientActionIntent,
): QToolAuthorization<QClientActionToolResult> {
  return allow<QClientActionToolResult>("INTERNAL", {
    status: "SCREEN_WILL_DO_IT",
    clientAction,
  });
}

const COMMON = {
  version: 1,
  status: "ACTIVE",
  classification: "SIDE_EFFECT",
  riskClass: "LOW_RISK_INTERNAL",
  // Their own screen: no domain capability binds; the authorize step
  // below requires their own conversation.
  requiredCapabilities: [],
  supportedPurposes: [...Q_TASK_CLASSES],
  requiredScopeKinds: ["OWN_Q_CONVERSATION"],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: null,
  output: QClientActionToolResultSchema,
  execute: (
    _input: unknown,
    _context: unknown,
    grant: QClientActionToolResult,
  ) => Promise.resolve(grant),
} as const;

export const SetThemeInputSchema = z
  .object({
    theme: QThemeChoiceSchema.describe(
      "light, dark, or system (follow the device).",
    ),
  })
  .strict();
export type SetThemeInput = z.infer<typeof SetThemeInputSchema>;

export function createSetThemeTool(): AnyQToolDefinition {
  return defineQTool<
    SetThemeInput,
    QClientActionToolResult,
    QClientActionToolResult
  >({
    ...COMMON,
    id: SET_THEME,
    providerName: "set_theme",
    description:
      "Switches Capital Q's appearance in their browser to light, dark, or system (follow the device), exactly as the theme control does. Call it when they ask to change the theme, dark mode or light mode.",
    input: SetThemeInputSchema,
    authorize: (input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allowed({ kind: "SET_THEME", theme: input.theme })
          : deny<QClientActionToolResult>("NOT_AVAILABLE"),
      ),
  });
}

export const ReloadPageInputSchema = z.object({}).strict();
export type ReloadPageInput = z.infer<typeof ReloadPageInputSchema>;

export function createReloadPageTool(): AnyQToolDefinition {
  return defineQTool<
    ReloadPageInput,
    QClientActionToolResult,
    QClientActionToolResult
  >({
    ...COMMON,
    id: RELOAD_PAGE,
    providerName: "reload_page",
    description:
      "Reloads the page they are on, as the browser's reload does. Call it when they ask to refresh or reload the page.",
    input: ReloadPageInputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allowed({ kind: "RELOAD_PAGE" })
          : deny<QClientActionToolResult>("NOT_AVAILABLE"),
      ),
  });
}

export const OpenWebsiteInputSchema = z
  .object({
    url: QWebsiteUrlSchema.describe(
      "The full http(s) address of their own website: as it is on their own company record, or exactly as they gave it.",
    ),
  })
  .strict();
export type OpenWebsiteInput = z.infer<typeof OpenWebsiteInputSchema>;

/** The host a person would recognise: lower case, without a leading www. */
export function siteHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A website on the person's own company record, bound in this plan. */
async function ownRecordHosts(
  ports: Pick<QToolPorts, "companies">,
  actor: ActorContext,
  plan: PermittedContextPlan,
): Promise<readonly string[]> {
  const hosts: string[] = [];
  for (const scope of scopesOfKind(plan, "COMPANY_PROFILE")) {
    const id = scope.subject === undefined ? undefined : scope.filter.companyId;
    if (id === undefined) continue;
    const parsed = CompanyIdSchema.safeParse(id);
    if (!parsed.success) continue;
    const profile = await ports.companies
      .findCanonicalCompanyProfile(parsed.data)
      .catch(() => null);
    if (
      profile === null ||
      profile.tenantId !== actor.tenantId ||
      actor.organisationId === undefined ||
      profile.organisationId !== actor.organisationId ||
      profile.websiteUrl === null
    ) {
      continue;
    }
    const host = siteHost(profile.websiteUrl);
    if (host !== null) hosts.push(host);
  }
  return hosts;
}

export function createOpenWebsiteTool(
  ports: Pick<QToolPorts, "companies">,
): AnyQToolDefinition {
  return defineQTool<
    OpenWebsiteInput,
    QClientActionToolResult,
    QClientActionToolResult
  >({
    ...COMMON,
    id: OPEN_WEBSITE,
    providerName: "open_website",
    description:
      "Opens their own website in a new browser tab: the website on their own company record, or an address they gave in their own words. Not for any other site. NOT_AVAILABLE means it is neither: say so and ask for the address.",
    input: OpenWebsiteInputSchema,
    /**
     * Only their own declared site. The model's URL is checked against
     * two things code holds: the website on a company record this person's
     * organisation owns and the plan bound, or the person's own words this
     * turn (the host must be in them). Anything else is not opened, so a
     * model — or text a document planted — cannot send them elsewhere.
     */
    authorize: async (input, context) => {
      const { actor, plan } = context;
      if (!ownConversation(actor, plan)) {
        return deny<QClientActionToolResult>("NOT_AVAILABLE");
      }
      const host = siteHost(input.url);
      if (host === null) return deny<QClientActionToolResult>("NOT_AVAILABLE");
      const said = (context.conversation?.latestUserText ?? "").toLowerCase();
      const theirWords = said.includes(host);
      const theirRecord =
        !theirWords &&
        (await ownRecordHosts(ports, actor, plan)).includes(host);
      return theirWords || theirRecord
        ? allowed({ kind: "OPEN_WEBSITE", url: new URL(input.url).toString() })
        : deny<QClientActionToolResult>("NOT_AVAILABLE");
    },
  });
}

export function createClientActionTools(
  ports: Pick<QToolPorts, "companies">,
): readonly AnyQToolDefinition[] {
  return [
    createSetThemeTool(),
    createReloadPageTool(),
    createOpenWebsiteTool(ports),
  ];
}
