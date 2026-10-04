"use server";

import {
  endQVoiceDuplex,
  relayQVoiceDuplexTool,
  reportQVoiceDuplexUsage,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  QVoiceDuplexEndSchema,
  QVoiceDuplexToolCallSchema,
  QVoiceDuplexUsageReportSchema,
  UuidSchema,
  type QVoiceDuplexToolResult,
  type QVoiceDuplexUsageResult,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * DUPLEX: the full-duplex line's relays to the Q API, as server actions,
 * so the person's own session authorises each one exactly as every other
 * voice call does. Each returns null for anything but success: the line
 * then ends and the standard voice takes over, which is the whole of the
 * failure handling a person ever sees.
 */

async function sessionFor() {
  const { qApiBaseUrl } = loadWebServerConfig();
  if (qApiBaseUrl === undefined) return null;
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return null;
  return { baseUrl: qApiBaseUrl, accessToken };
}

export async function relayDuplexToolAction(
  rawVoiceSessionId: unknown,
  rawCall: unknown,
): Promise<QVoiceDuplexToolResult | null> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const call = QVoiceDuplexToolCallSchema.safeParse(rawCall);
  if (!id.success || !call.success) return null;
  const session = await sessionFor();
  if (session === null) return null;
  try {
    return await relayQVoiceDuplexTool(session, id.data, call.data);
  } catch {
    return null;
  }
}

export async function reportDuplexUsageAction(
  rawVoiceSessionId: unknown,
  rawReport: unknown,
): Promise<QVoiceDuplexUsageResult | null> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const report = QVoiceDuplexUsageReportSchema.safeParse(rawReport);
  if (!id.success || !report.success) return null;
  const session = await sessionFor();
  if (session === null) return null;
  try {
    return await reportQVoiceDuplexUsage(session, id.data, report.data);
  } catch {
    return null;
  }
}

export async function endDuplexAction(
  rawVoiceSessionId: unknown,
  rawReason: unknown,
): Promise<void> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const body = QVoiceDuplexEndSchema.safeParse({ reason: rawReason });
  if (!id.success || !body.success) return;
  const session = await sessionFor();
  if (session === null) return;
  try {
    await endQVoiceDuplex(session, id.data, body.data);
  } catch {
    // The server forgets an unended line on its own.
  }
}
