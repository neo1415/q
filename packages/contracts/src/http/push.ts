import { z } from "zod";

/**
 * Web Push and notification settings (AUTO, ADR 0029).
 *
 *   GET  /v1/push/key                   the VAPID public key (or null: push off)
 *   PUT  /v1/push/subscription          this device subscribes
 *   POST /v1/push/subscription/remove   this device unsubscribes
 *   GET  /v1/notifications/settings     push / email on or off, device count
 *   PUT  /v1/notifications/settings     change them
 *
 * A subscription's endpoint is a capability URL; the API takes it and never
 * gives it back.
 */

export const PUSH_KEY_PATH = "/v1/push/key" as const;
export const PUSH_SUBSCRIPTION_PATH = "/v1/push/subscription" as const;
export const PUSH_SUBSCRIPTION_REMOVE_PATH =
  "/v1/push/subscription/remove" as const;
export const NOTIFICATION_SETTINGS_PATH = "/v1/notifications/settings" as const;

export const PushKeyDtoSchema = z
  .object({ publicKey: z.string().max(100).nullable() })
  .strict();
export type PushKeyDto = z.infer<typeof PushKeyDtoSchema>;

const Base64Url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const PushSubscriptionRequestSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(1_000)
      .refine((value) => value.startsWith("https://"), "https only"),
    keys: z
      .object({
        p256dh: Base64Url.min(40).max(200),
        auth: Base64Url.min(16).max(64),
      })
      .strict(),
  })
  .strict();
export type PushSubscriptionRequest = z.infer<
  typeof PushSubscriptionRequestSchema
>;

export const PushUnsubscribeRequestSchema = z
  .object({ endpoint: z.string().url().max(1_000) })
  .strict();
export type PushUnsubscribeRequest = z.infer<
  typeof PushUnsubscribeRequestSchema
>;

export const NotificationSettingsDtoSchema = z
  .object({
    push: z.boolean(),
    email: z.boolean(),
    /** Devices with push on for this person. */
    devices: z.number().int().min(0),
    /** Whether Capital Q can send pushes at all (VAPID configured). */
    pushAvailable: z.boolean(),
  })
  .strict();
export type NotificationSettingsDto = z.infer<
  typeof NotificationSettingsDtoSchema
>;

export const NotificationSettingsRequestSchema = z
  .object({ push: z.boolean(), email: z.boolean() })
  .strict();
export type NotificationSettingsRequest = z.infer<
  typeof NotificationSettingsRequestSchema
>;
