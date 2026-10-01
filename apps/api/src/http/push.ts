import type { FastifyInstance } from "fastify";

import {
  NOTIFICATION_SETTINGS_PATH,
  NotificationSettingsDtoSchema,
  NotificationSettingsRequestSchema,
  parseContract,
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTION_PATH,
  PUSH_SUBSCRIPTION_REMOVE_PATH,
  PushKeyDtoSchema,
  PushSubscriptionRequestSchema,
  PushUnsubscribeRequestSchema,
} from "@capital-q/contracts";
import type { PushSubscriptionStore } from "@capital-q/communication";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Web Push and notification settings (AUTO, ADR 0029). A person subscribes
 * and unsubscribes their own device and sets their own channels; the
 * endpoint they send is never returned. The public VAPID key is not a
 * secret but is still served to signed-in people only.
 */

export type PushRoutesDependencies = ActorContextDependencies & {
  readonly subscriptions: PushSubscriptionStore;
  readonly publicKey: string | null;
};

export function registerPushRoutes(
  app: FastifyInstance,
  dependencies: PushRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { subscriptions, publicKey } = dependencies;

  app.get(PUSH_KEY_PATH, { onRequest: withContext }, (_request, reply) => {
    void reply.header("Cache-Control", "no-store");
    return PushKeyDtoSchema.parse({ publicKey });
  });

  app.put(
    PUSH_SUBSCRIPTION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        PushSubscriptionRequestSchema,
        request.body,
        "The push subscription is not valid.",
      );
      const agent = request.headers["user-agent"];
      await subscriptions.subscribe(getActorContext(request), {
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh.replace(/=+$/, ""),
        auth: input.keys.auth.replace(/=+$/, ""),
        userAgent: typeof agent === "string" ? agent : null,
      });
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  app.post(
    PUSH_SUBSCRIPTION_REMOVE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        PushUnsubscribeRequestSchema,
        request.body,
        "The request is not valid.",
      );
      await subscriptions.unsubscribe(getActorContext(request), input.endpoint);
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  app.get(
    NOTIFICATION_SETTINGS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const settings = await subscriptions.settings(getActorContext(request));
      void reply.header("Cache-Control", "no-store");
      return NotificationSettingsDtoSchema.parse({
        ...settings,
        pushAvailable: publicKey !== null,
      });
    },
  );

  app.put(
    NOTIFICATION_SETTINGS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        NotificationSettingsRequestSchema,
        request.body,
        "The settings are not valid.",
      );
      const actor = getActorContext(request);
      await subscriptions.saveSettings(actor, input);
      const settings = await subscriptions.settings(actor);
      void reply.header("Cache-Control", "no-store");
      return NotificationSettingsDtoSchema.parse({
        ...settings,
        pushAvailable: publicKey !== null,
      });
    },
  );
}
