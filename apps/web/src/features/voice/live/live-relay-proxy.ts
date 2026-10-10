import "server-only";

import { loadWebServerConfig } from "@capital-q/config/web";
import {
  QClientActionIntentSchema,
  QVoiceDestinationSchema,
} from "@capital-q/contracts";
import { z } from "zod";

import { getSessionAccessToken } from "@/auth/session";

/**
 * V: the GPT-Live line's relays (session SDP exchange, delegations, cancel,
 * usage, end) as one route handler, like the duplex relays: plain fetches
 * that run side by side. The person's own session is the only authority;
 * bodies are validated here and again by the Q API, replies before they
 * reach the browser. The provider key never passes through here: the Q API
 * holds it and does the SDP exchange.
 *
 * These schemas mirror apps/q-api/src/voice/live/contracts.ts (an app may
 * not import another app); they move to @capital-q/contracts when the line
 * joins the product voice UI.
 */

const SESSION_TOKEN_HEADER = "x-q-voice-session";
const SESSION_TOKEN_MAX = 8192;
const DelegationId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.:-]+$/u);

const OpenBody = z
  .object({
    voiceSessionId: z.string().uuid().optional(),
    voice: z.enum(["FEMALE", "MALE"]).optional(),
    sdp: z.string().min(10).max(100_000),
    briefingOpening: z.boolean().optional(),
    firstName: z.string().trim().min(1).max(40).optional(),
    role: z.enum(["founder", "investor"]).optional(),
    locale: z
      .string()
      .max(16)
      .regex(/^[A-Za-z0-9-]+$/u)
      .optional(),
  })
  .strict();
const OpenResult = z.object({
  voiceSessionId: z.string(),
  sessionToken: z.string().optional(),
  sdp: z.string(),
  provider: z.literal("openai"),
  model: z.string().nullable(),
  maxSessionMs: z.number().int().positive(),
  idleMs: z.number().int().positive(),
  context: z.string().max(2_000).nullable().optional(),
});
const DelegateBody = z
  .object({
    delegationId: DelegationId,
    request: z.string().max(2_000),
    context: z
      .array(
        z
          .object({ role: z.enum(["user", "q"]), text: z.string().max(2_000) })
          .strict(),
      )
      .max(12)
      .optional(),
    early: z.boolean().optional(),
  })
  .strict();
const DelegateResult = z.object({
  delegationId: z.string(),
  commentary: z.string().nullable(),
  stale: z.boolean(),
  approvalPending: z.boolean(),
  failed: z.boolean(),
  ended: z.boolean().optional(),
  unheard: z.boolean().optional(),
  partial: z.boolean().optional(),
  move: z
    .object({
      navigate: QVoiceDestinationSchema.nullable(),
      action: QClientActionIntentSchema.nullable(),
    })
    .strict()
    .optional(),
});
const UsageBody = z
  .object({
    seconds: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600),
    final: z.boolean().optional(),
  })
  .strict();
const UsageResult = z.object({
  recordedSeconds: z.number().int().min(0),
  remainingMs: z.number().int().min(0),
  capReached: z.boolean().optional(),
});
const EndBody = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[\w.-]+$/u),
  })
  .strict();
const TranscriptBody = z
  .object({
    segments: z
      .array(
        z
          .object({
            role: z.enum(["USER", "Q"]),
            text: z.string().min(1).max(4_000),
            at: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
const TranscriptResult = z.object({ recorded: z.number().int().min(0) });
const NoBody = z.object({}).strict();
const CancelResult = z.object({ cancelled: z.boolean() });

type Relay = {
  readonly path: (id: string, delegationId: string | null) => string | null;
  readonly body: z.ZodType;
  readonly result: z.ZodType | null;
  /** A read: GET upstream, no body sent (the browser posts `{}`). */
  readonly method?: "GET" | undefined;
  /** Not about one line: no voice session id in the path. */
  readonly lineless?: boolean | undefined;
};

const Availability = z.object({ available: z.boolean() });

const base = "/v1/q/voice/live/sessions";
const RELAYS: Readonly<Record<string, Relay>> = {
  open: {
    path: () => base,
    body: OpenBody,
    result: OpenResult,
    lineless: true,
  },
  // Whether this person's voice starts on GPT-Live (the Q API decides:
  // switched on, and the person allowed).
  available: {
    path: () => "/v1/q/voice/live/available",
    body: NoBody,
    result: Availability,
    method: "GET",
    lineless: true,
  },
  delegate: {
    path: (id) => `${base}/${id}/delegations`,
    body: DelegateBody,
    result: DelegateResult,
  },
  cancel: {
    path: (id, delegationId) =>
      delegationId === null
        ? null
        : `${base}/${id}/delegations/${encodeURIComponent(delegationId)}/cancel`,
    body: NoBody,
    result: CancelResult,
  },
  usage: {
    path: (id) => `${base}/${id}/usage`,
    body: UsageBody,
    result: UsageResult,
  },
  transcript: {
    path: (id) => `${base}/${id}/transcript`,
    body: TranscriptBody,
    result: TranscriptResult,
  },
  end: { path: (id) => `${base}/${id}/end`, body: EndBody, result: null },
};

const problem = (status: number) =>
  Response.json(
    { type: "about:blank", title: "Live voice relay", status },
    { status, headers: { "cache-control": "no-store" } },
  );

const isOn = (value: string | undefined): boolean => {
  const flag = value?.trim().toLowerCase();
  return flag === "on" || flag === "1" || flag === "true";
};

/**
 * The developer voice comparison preview: an explicit flag, in a local
 * deployment, or in a deployed one with CQ_VOICE_PREVIEW_DEPLOYED as well
 * (the founder's listening test, 2026-10-09). Checked on the server for the
 * page and every relay. Who may use it is the Q API's decision
 * (CQ_VOICE_LIVE_USERS): everyone else gets a 404 from it.
 */
export function voicePreviewEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!isOn(env["CQ_VOICE_PREVIEW"])) return false;
  if (isOn(env["CQ_VOICE_PREVIEW_DEPLOYED"])) return true;
  try {
    return (
      loadWebServerConfig().runtime.deploymentEnvironment === "local" &&
      env["NODE_ENV"] !== "production"
    );
  } catch {
    return false;
  }
}

export async function relayLive(
  request: Request,
  params: {
    readonly relay: string;
    readonly voiceSessionId?: string | undefined;
    readonly delegationId?: string | undefined;
  },
  options: {
    readonly doFetch?: typeof fetch;
    readonly enabled?: () => boolean;
  } = {},
): Promise<Response> {
  // V (2026-10-09): GPT-Live is the product voice for the people the Q API
  // allows; the Q API's allowlist is the gate, so the relays are open to
  // any signed-in person and answer whatever the Q API answers.
  if (!(options.enabled ?? (() => true))()) return problem(404);
  const relay = Object.hasOwn(RELAYS, params.relay)
    ? RELAYS[params.relay]
    : undefined;
  if (relay === undefined) return problem(404);
  const id =
    relay.lineless === true
      ? ""
      : z.string().uuid().safeParse(params.voiceSessionId).data;
  if (id === undefined) return problem(404);
  const delegation =
    params.delegationId === undefined
      ? null
      : (DelegationId.safeParse(params.delegationId).data ?? undefined);
  if (delegation === undefined) return problem(404);
  const path = relay.path(id, delegation);
  if (path === null) return problem(404);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return problem(400);
  }
  const body = relay.body.safeParse(raw);
  if (!body.success) return problem(400);
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return problem(503);
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return problem(401);
  const token = request.headers.get(SESSION_TOKEN_HEADER);
  let upstream: Response;
  try {
    upstream = await (options.doFetch ?? fetch)(
      `${qApiBaseUrl.replace(/\/$/, "")}${path}`,
      {
        method: relay.method ?? "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(relay.method === "GET"
            ? {}
            : { "content-type": "application/json" }),
          ...(token !== null &&
          token.length > 0 &&
          token.length <= SESSION_TOKEN_MAX
            ? { [SESSION_TOKEN_HEADER]: token }
            : {}),
        },
        ...(relay.method === "GET" ? {} : { body: JSON.stringify(body.data) }),
        cache: "no-store",
      },
    );
  } catch {
    return problem(502);
  }
  if (!upstream.ok) {
    return problem(
      upstream.status === 404 ||
        upstream.status === 503 ||
        upstream.status === 429
        ? upstream.status
        : 502,
    );
  }
  if (relay.result === null) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  let result: unknown;
  try {
    result = await upstream.json();
  } catch {
    return problem(502);
  }
  const parsed = relay.result.safeParse(result);
  if (!parsed.success) return problem(502);
  return Response.json(parsed.data, {
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Whether the Q API lets this person use the preview (its own allowlist
 * outside a local deployment). Server-side, with their own bearer; any
 * failure reads as no.
 */
export async function voicePreviewAllowed(
  options: { readonly doFetch?: typeof fetch } = {},
): Promise<boolean> {
  const token = await getSessionAccessToken();
  if (token === null) return false;
  try {
    const response = await (options.doFetch ?? fetch)(
      `${loadWebServerConfig().qApiBaseUrl}/v1/q/voice/live/preview`,
      {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
