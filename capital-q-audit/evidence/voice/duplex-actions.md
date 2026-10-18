# Evidence: apps/web/src/features/voice/duplex-actions.ts (lines 1-152)

- Original path: `apps/web/src/features/voice/duplex-actions.ts`
- Line range: 1-152 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Duplex relays are Next.js server actions; every failure becomes null.

```ts
    1  "use server";
    2
    3  import {
    4    endQVoiceDuplex,
    5    rejoinQVoiceDuplex,
    6    relayQVoiceDuplexTool,
    7    reportQVoiceDuplexUsage,
    8    sendQVoiceDuplexHeard,
    9    sendQVoiceDuplexSaid,
   10  } from "@capital-q/api-client";
   11  import { loadWebServerConfig } from "@capital-q/config/web";
   12  import {
   13    QVoiceDuplexEndSchema,
   14    QVoiceDuplexHeardSchema,
   15    QVoiceDuplexSaidSchema,
   16    type QVoiceDuplexHeardResult,
   17    QVoiceDuplexRejoinSchema,
   18    QVoiceDuplexToolCallSchema,
   19    QVoiceDuplexUsageReportSchema,
   20    UuidSchema,
   21    type QVoiceDuplexRejoinResult,
   22    type QVoiceDuplexToolResult,
   23    type QVoiceDuplexUsageResult,
   24  } from "@capital-q/contracts";
   25
   26  import { getSessionAccessToken } from "@/auth/session";
   27
   28  /**
   29   * DUPLEX: the full-duplex line's relays to the Q API, as server actions,
   30   * so the person's own session authorises each one exactly as every other
   31   * voice call does. Each returns null for anything but success: the line
   32   * then ends and the standard voice takes over, which is the whole of the
   33   * failure handling a person ever sees.
   34   */
   35
   36  async function sessionFor() {
   37    const { qApiBaseUrl } = loadWebServerConfig();
   38    if (qApiBaseUrl === undefined) return null;
   39    const accessToken = await getSessionAccessToken();
   40    if (accessToken === null) return null;
   41    return { baseUrl: qApiBaseUrl, accessToken };
   42  }
   43
   44  export async function relayDuplexToolAction(
   45    rawVoiceSessionId: unknown,
   46    rawCall: unknown,
   47  ): Promise<QVoiceDuplexToolResult | null> {
   48    const id = UuidSchema.safeParse(rawVoiceSessionId);
   49    const call = QVoiceDuplexToolCallSchema.safeParse(rawCall);
   50    if (!id.success || !call.success) return null;
   51    const session = await sessionFor();
   52    if (session === null) return null;
   53    try {
   54      return await relayQVoiceDuplexTool(session, id.data, call.data);
   55    } catch {
   56      return null;
   57    }
   58  }
   59
   60  /** VOICE-BRAIN: a finished turn of theirs; the server decides who answers. */
   61  export async function sendDuplexHeardAction(
   62    rawVoiceSessionId: unknown,
   63    rawHeard: unknown,
   64  ): Promise<QVoiceDuplexHeardResult | null> {
   65    const id = UuidSchema.safeParse(rawVoiceSessionId);
   66    const heard = QVoiceDuplexHeardSchema.safeParse(rawHeard);
   67    if (!id.success || !heard.success) return null;
   68    const session = await sessionFor();
   69    if (session === null) return null;
   70    try {
   71      return await sendQVoiceDuplexHeard(session, id.data, heard.data);
   72    } catch {
   73      return null;
   74    }
   75  }
   76
   77  /** VOICE-BRAIN: what the voice said, for the line's transcript. */
   78  export async function sendDuplexSaidAction(
   79    rawVoiceSessionId: unknown,
   80    rawSaid: unknown,
   81  ): Promise<void> {
   82    const id = UuidSchema.safeParse(rawVoiceSessionId);
   83    const said = QVoiceDuplexSaidSchema.safeParse(rawSaid);
   84    if (!id.success || !said.success) return;
   85    const session = await sessionFor();
   86    if (session === null) return;
   87    try {
   88      await sendQVoiceDuplexSaid(session, id.data, said.data);
   89    } catch {
   90      // The transcript is kept beside the line, never in its way.
   91    }
   92  }
   93
   94  export async function reportDuplexUsageAction(
   95    rawVoiceSessionId: unknown,
   96    rawReport: unknown,
   97  ): Promise<QVoiceDuplexUsageResult | null> {
   98    const id = UuidSchema.safeParse(rawVoiceSessionId);
   99    const report = QVoiceDuplexUsageReportSchema.safeParse(rawReport);
  100    if (!id.success || !report.success) return null;
  101    const session = await sessionFor();
  102    if (session === null) return null;
  103    try {
  104      return await reportQVoiceDuplexUsage(session, id.data, report.data);
  105    } catch {
  106      return null;
  107    }
  108  }
  109
  110  /** I1: a fresh realtime call for the same line after a drop. */
  111  export async function rejoinDuplexAction(
  112    rawVoiceSessionId: unknown,
  113    rawCause: unknown,
  114  ): Promise<QVoiceDuplexRejoinResult | null> {
  115    const id = UuidSchema.safeParse(rawVoiceSessionId);
  116    const body = QVoiceDuplexRejoinSchema.safeParse({ cause: rawCause });
  117    if (!id.success || !body.success) return null;
  118    const session = await sessionFor();
  119    if (session === null) return null;
  120    try {
  121      return await rejoinQVoiceDuplex(session, id.data, body.data);
  122    } catch {
  123      return null;
  124    }
  125  }
  126
  127  export async function endDuplexAction(
  128    rawVoiceSessionId: unknown,
  129    rawReason: unknown,
  130    rawDetail?: unknown,
  131  ): Promise<void> {
  132    const id = UuidSchema.safeParse(rawVoiceSessionId);
  133    const detail =
  134      rawDetail !== null && typeof rawDetail === "object" ? rawDetail : {};
  135    // What the line measured rides along; a malformed detail is dropped,
  136    // never the end itself.
  137    const withDetail = QVoiceDuplexEndSchema.safeParse({
  138      ...detail,
  139      reason: rawReason,
  140    });
  141    const body = withDetail.success
  142      ? withDetail
  143      : QVoiceDuplexEndSchema.safeParse({ reason: rawReason });
  144    if (!id.success || !body.success) return;
  145    const session = await sessionFor();
  146    if (session === null) return;
  147    try {
  148      await endQVoiceDuplex(session, id.data, body.data);
  149    } catch {
  150      // The server forgets an unended line on its own.
  151    }
  152  }
```
