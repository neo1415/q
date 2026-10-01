import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  BILLING_CHECKOUT_PATH,
  BILLING_PLAN_PATH,
  BILLING_PLANS_PATH,
  BILLING_PORTAL_PATH,
  BILLING_STRIPE_WEBHOOK_PATH,
  BillingAccountPlanDtoSchema,
  BillingCatalogueDtoSchema,
  BillingCheckoutRequestSchema,
  BillingRedirectDtoSchema,
  createEntitlementProblem,
  createProblemDetails,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  PROBLEM_CONTENT_TYPE,
  type KnownErrorCode,
  type ProblemDetails,
} from "@capital-q/contracts";
import {
  accountKeyOf,
  accountPlanDto,
  billingAccountOf,
  BillingProviderError,
  type BillingAccounts,
  type BillingProvider,
  type EntitlementRefusal,
  type EntitlementService,
  type WebhookOutcome,
  type ProviderEvent,
} from "@capital-q/billing";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Plans and usage for the person's own account, hosted checkout and
 * billing portal, and the Stripe webhook (ADR 0034).
 *
 * The account is the server-resolved organisation (or the person alone);
 * nothing a client sends chooses it. Buying or managing needs the
 * organisation's admin capability. With no provider configured, checkout
 * and portal answer 503 and everything else keeps working: plans can still
 * be assigned by an operator.
 */

export type BillingRoutesDependencies = ActorContextDependencies & {
  readonly entitlements: EntitlementService;
  readonly accounts: BillingAccounts;
  /** Absent: online payment is off on this deployment. */
  readonly provider?: BillingProvider | undefined;
  readonly applyWebhook?:
    ((event: ProviderEvent) => Promise<WebhookOutcome>) | undefined;
  /** Whether this actor may buy or change the plan for their organisation. */
  readonly canManage: (actor: ActorContext) => Promise<boolean>;
  /** COUNT features the owning contexts count (e.g. gateways). */
  readonly counts?:
    | ((actor: ActorContext) => Promise<Readonly<Record<string, number>>>)
    | undefined;
  /** The web origin checkout and the portal return to. */
  readonly webOrigin: string;
  readonly now?: (() => Date) | undefined;
};

/** A Stripe event is a few kilobytes; nothing honest is larger. */
export const BILLING_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;

function send(reply: FastifyReply, problem: ProblemDetails) {
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

function problem(
  request: FastifyRequest,
  reply: FastifyReply,
  code: KnownErrorCode,
  detail: string,
) {
  return send(
    reply,
    createProblemDetails({ code, requestId: request.id, detail }),
  );
}

/** The one ENTITLEMENT_REQUIRED shape every gated route answers with. */
export function sendEntitlementRequired(
  request: FastifyRequest,
  reply: FastifyReply,
  refusal: EntitlementRefusal,
) {
  return send(
    reply,
    createEntitlementProblem({ requestId: request.id, entitlement: refusal }),
  );
}

export function registerBillingRoutes(
  app: FastifyInstance,
  dependencies: BillingRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { entitlements, accounts, provider } = dependencies;

  app.get(
    BILLING_PLAN_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const account = billingAccountOf(actor);
      const counts = (await dependencies.counts?.(actor)) ?? {};
      const [summary, canManage, customer] = await Promise.all([
        entitlements.summary(account, counts),
        dependencies.canManage(actor),
        accounts.customerOf(accountKeyOf(account)),
      ]);
      void reply.header("Cache-Control", "no-store");
      return BillingAccountPlanDtoSchema.parse(
        accountPlanDto(account, summary, {
          canManage,
          checkoutAvailable: provider !== undefined && canManage,
          hasBillingCustomer: customer !== null,
        }),
      );
    },
  );

  app.get(
    BILLING_PLANS_PATH,
    { onRequest: withContext },
    async (_request, reply) => {
      void reply.header("Cache-Control", "no-store");
      return BillingCatalogueDtoSchema.parse(await accounts.catalogue());
    },
  );

  app.post(
    BILLING_CHECKOUT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const key = IdempotencyKeyHeaderSchema.safeParse(
        request.headers[IDEMPOTENCY_KEY_HEADER],
      );
      const body = BillingCheckoutRequestSchema.safeParse(request.body);
      if (!key.success || !body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      if (
        actor.organisationId === undefined ||
        !(await dependencies.canManage(actor))
      ) {
        return problem(
          request,
          reply,
          "PERMISSION_DENIED",
          "Only an admin of your organisation can change its plan.",
        );
      }
      if (provider === undefined) {
        return problem(
          request,
          reply,
          "PROVIDER_UNAVAILABLE",
          "Online payment isn't switched on yet. Talk to us and we'll change your plan.",
        );
      }
      const catalogue = await accounts.catalogue();
      const plan = catalogue.plans.find(
        (candidate) =>
          candidate.key === body.data.planKey && candidate.selfServe,
      );
      if (plan === undefined) {
        return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      }
      const lookupKey = await accounts.lookupKeyOf(plan.key);
      if (lookupKey === null) {
        return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      }
      const account = billingAccountOf(actor);
      try {
        const session = await provider.createCheckout({
          accountKey: accountKeyOf(account),
          lookupKey,
          customerId: await accounts.customerOf(accountKeyOf(account)),
          successUrl: `${dependencies.webOrigin}/settings/plan?checkout=done`,
          cancelUrl: `${dependencies.webOrigin}/settings/plan`,
          idempotencyKey: `checkout:${accountKeyOf(account)}:${key.data}`,
        });
        void reply.header("Cache-Control", "no-store");
        return BillingRedirectDtoSchema.parse(session);
      } catch (error: unknown) {
        request.log.warn(
          {
            requestId: request.id,
            reason:
              error instanceof BillingProviderError ? error.code : "UNKNOWN",
          },
          "billing checkout failed",
        );
        return problem(
          request,
          reply,
          "PROVIDER_UNAVAILABLE",
          "Checkout isn't available right now. Try again in a moment.",
        );
      }
    },
  );

  app.post(
    BILLING_PORTAL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      if (
        actor.organisationId === undefined ||
        !(await dependencies.canManage(actor))
      ) {
        return problem(
          request,
          reply,
          "PERMISSION_DENIED",
          "Only an admin of your organisation can manage billing.",
        );
      }
      const customer = await accounts.customerOf(
        accountKeyOf(billingAccountOf(actor)),
      );
      if (provider === undefined || customer === null) {
        return problem(
          request,
          reply,
          "PROVIDER_UNAVAILABLE",
          "There's no online billing to manage for your organisation yet.",
        );
      }
      try {
        const session = await provider.createPortal({
          customerId: customer,
          returnUrl: `${dependencies.webOrigin}/settings/plan`,
        });
        void reply.header("Cache-Control", "no-store");
        return BillingRedirectDtoSchema.parse(session);
      } catch {
        return problem(
          request,
          reply,
          "PROVIDER_UNAVAILABLE",
          "Billing isn't available right now. Try again in a moment.",
        );
      }
    },
  );

  registerStripeWebhook(app, dependencies);
}

function registerStripeWebhook(
  app: FastifyInstance,
  dependencies: BillingRoutesDependencies,
): void {
  const parentErrorHandler = app.errorHandler;
  void app.register((scope, _options, done) => {
    // Raw bytes for this scope only: the signature is over exactly what
    // was sent.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: BILLING_WEBHOOK_BODY_LIMIT_BYTES },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scope.setErrorHandler((error, request, reply) => {
      if ((error as { code?: unknown }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        return send(
          reply,
          createProblemDetails({
            code: "INVALID_REQUEST",
            status: 413,
            requestId: request.id,
            detail: "The delivery is larger than any this endpoint accepts.",
          }),
        );
      }
      parentErrorHandler(error, request, reply);
      return reply;
    });

    scope.post(
      BILLING_STRIPE_WEBHOOK_PATH,
      { bodyLimit: BILLING_WEBHOOK_BODY_LIMIT_BYTES },
      async (request, reply) => {
        const { provider, applyWebhook } = dependencies;
        if (provider === undefined || applyWebhook === undefined) {
          return problem(
            request,
            reply,
            "PROVIDER_UNAVAILABLE",
            "Payment webhooks are not configured on this deployment.",
          );
        }
        const rawBody = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.alloc(0);
        const header = request.headers["stripe-signature"];
        const verdict = provider.verifyWebhook({
          rawBody,
          signatureHeader: typeof header === "string" ? header : undefined,
          now: dependencies.now?.() ?? new Date(),
        });
        if (!verdict.ok) {
          // The reason is for the operator; the caller learns nothing that
          // helps forge the next delivery.
          request.log.warn(
            { requestId: request.id, reason: verdict.reason },
            "billing webhook refused",
          );
          return problem(
            request,
            reply,
            "AUTHENTICATION_REQUIRED",
            "The delivery could not be verified.",
          );
        }
        const outcome = await applyWebhook(verdict.event);
        request.log.info(
          {
            requestId: request.id,
            eventId: verdict.event.id,
            eventType: verdict.event.type,
            outcome,
          },
          "billing webhook",
        );
        return reply.header("Cache-Control", "no-store").send({
          received: true,
        });
      },
    );
    done();
  });
}
