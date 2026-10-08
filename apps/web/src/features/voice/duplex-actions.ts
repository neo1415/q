"use server";

import {
  endQVoiceDuplex,
  rejoinQVoiceDuplex,
  relayQVoiceDuplexTool,
  reportQVoiceDuplexUsage,
  sendQVoiceDuplexHeard,
  sendQVoiceDuplexSaid,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  QVoiceDuplexEndSchema,
  QVoiceDuplexHeardSchema,
  QVoiceDuplexSaidSchema,
  type QVoiceDuplexHeardResult,
  QVoiceDuplexRejoinSchema,
  QVoiceDuplexToolCallSchema,
  QVoiceDuplexUsageReportSchema,
  UuidSchema,
  type QVoiceDuplexRejoinResult,
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

/** VOICE-BRAIN: a finished turn of theirs; the server decides who answers. */
export async function sendDuplexHeardAction(
  rawVoiceSessionId: unknown,
  rawHeard: unknown,
): Promise<QVoiceDuplexHeardResult | null> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const heard = QVoiceDuplexHeardSchema.safeParse(rawHeard);
  if (!id.success || !heard.success) return null;
  const session = await sessionFor();
  if (session === null) return null;
  try {
    return await sendQVoiceDuplexHeard(session, id.data, heard.data);
  } catch {
    return null;
  }
}

/** VOICE-BRAIN: what the voice said, for the line's transcript. */
export async function sendDuplexSaidAction(
  rawVoiceSessionId: unknown,
  rawSaid: unknown,
): Promise<void> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const said = QVoiceDuplexSaidSchema.safeParse(rawSaid);
  if (!id.success || !said.success) return;
  const session = await sessionFor();
  if (session === null) return;
  try {
    await sendQVoiceDuplexSaid(session, id.data, said.data);
  } catch {
    // The transcript is kept beside the line, never in its way.
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

/** I1: a fresh realtime call for the same line after a drop. */
export async function rejoinDuplexAction(
  rawVoiceSessionId: unknown,
  rawCause: unknown,
): Promise<QVoiceDuplexRejoinResult | null> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const body = QVoiceDuplexRejoinSchema.safeParse({ cause: rawCause });
  if (!id.success || !body.success) return null;
  const session = await sessionFor();
  if (session === null) return null;
  try {
    return await rejoinQVoiceDuplex(session, id.data, body.data);
  } catch {
    return null;
  }
}

export async function endDuplexAction(
  rawVoiceSessionId: unknown,
  rawReason: unknown,
  rawDetail?: unknown,
): Promise<void> {
  const id = UuidSchema.safeParse(rawVoiceSessionId);
  const detail =
    rawDetail !== null && typeof rawDetail === "object" ? rawDetail : {};
  // What the line measured rides along; a malformed detail is dropped,
  // never the end itself.
  const withDetail = QVoiceDuplexEndSchema.safeParse({
    ...detail,
    reason: rawReason,
  });
  const body = withDetail.success
    ? withDetail
    : QVoiceDuplexEndSchema.safeParse({ reason: rawReason });
  if (!id.success || !body.success) return;
  const session = await sessionFor();
  if (session === null) return;
  try {
    await endQVoiceDuplex(session, id.data, body.data);
  } catch {
    // The server forgets an unended line on its own.
  }
}
