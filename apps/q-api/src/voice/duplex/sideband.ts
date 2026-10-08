import type { QVoiceDuplexUsageReport } from "@capital-q/contracts";
import type {
  RealtimeSidebandConnector,
  RealtimeSidebandSocket,
} from "@capital-q/model-gateway/realtime/openai";
import type { Logger } from "@capital-q/observability";

/**
 * SIDEBAND (RECOVERY A8, audit C-08; flag CQ_VOICE_REALTIME_SIDEBAND, off).
 *
 * The server's own connection to a duplex call. The browser stays audio
 * and screen: it plays Q, confirms a barge-in and stops playback (the
 * sideband cannot), and keeps sending turns. What moves to the server:
 *
 * - delivery of Q's answer: the function call, its output and the
 *   response are put on the call from here, the moment ask_q finishes, so
 *   a slow or lost browser relay no longer loses the answer; a turn the
 *   person spoke over since it was heard is not delivered (stale guard);
 * - usage: each response's usage is recorded from the provider's own
 *   events, not only from the browser's report (both are counted once,
 *   by response id);
 * - diagnostics: realtime `error` events, failed responses and the time
 *   from the end of their turn to Q's first audio, in the server log.
 *
 * Function calls the model proposes are executed once, by the browser's
 * relay as before; this socket ignores them (the guide: one owner per
 * call). A socket that drops is re-attached a few times with backoff
 * (community reports: the sideband can drop after long silence); while it
 * is down the browser delivers, exactly as without the sideband.
 *
 * NOT VERIFIED ON A LIVE CALL (no WebRTC in the build sandbox). Tested
 * with a fake socket only.
 */

export const SIDEBAND_REATTACH_MAX = 3;
export const SIDEBAND_REATTACH_BACKOFF_MS = 1_000;

export type DuplexSideband = {
  /** Attach to the line's call (replacing any earlier call of the line). */
  readonly attach: (voiceSessionId: string, callId: string) => void;
  /**
   * Put Q's answer on the call and ask the voice to say it. False when
   * the sideband is not attached, or the person spoke since `since`: the
   * browser then decides, as without the sideband.
   */
  readonly deliver: (
    voiceSessionId: string,
    answer: {
      readonly callId: string;
      readonly arguments: string;
      readonly output: string;
      /** When the turn was heard (epoch ms). */
      readonly since: number;
    },
  ) => boolean;
  readonly detach: (voiceSessionId: string) => void;
  /** Attached now (for tests and the end-of-line log). */
  readonly attached: (voiceSessionId: string) => boolean;
};

type Attached = {
  readonly callId: string;
  socket: RealtimeSidebandSocket | null;
  detached: boolean;
  reattaches: number;
  lastSpeechAt: number;
  turnEndedAt: number | null;
};

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? Reflect.get(value, key)
    : undefined;
}
function text(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === "string" ? found : undefined;
}
function tokens(value: unknown, key: string): number {
  const found = field(value, key);
  return typeof found === "number" && Number.isFinite(found) && found > 0
    ? Math.floor(found)
    : 0;
}

/** The provider's usage block, as Capital Q's modality-split report. */
export function sidebandUsageReport(
  responseId: string,
  usage: unknown,
  kind?: QVoiceDuplexUsageReport["kind"],
): QVoiceDuplexUsageReport {
  const input = field(usage, "input_token_details");
  const cached = field(input, "cached_tokens_details");
  const output = field(usage, "output_token_details");
  return {
    responseId: responseId.slice(0, 128),
    ...(kind === undefined ? {} : { kind }),
    inputTextTokens: tokens(input, "text_tokens"),
    inputAudioTokens: tokens(input, "audio_tokens"),
    cachedTextTokens: tokens(cached, "text_tokens"),
    cachedAudioTokens: tokens(cached, "audio_tokens"),
    outputTextTokens: tokens(output, "text_tokens"),
    outputAudioTokens: tokens(output, "audio_tokens"),
  };
}

export function createDuplexSideband(dependencies: {
  readonly connect: RealtimeSidebandConnector;
  readonly logger: Logger;
  /** Usage seen on the call, for the line's ledger (de-duplicated there). */
  readonly onUsage: (
    voiceSessionId: string,
    report: QVoiceDuplexUsageReport,
  ) => void;
  readonly now?: (() => number) | undefined;
  readonly setTimeout?:
    ((handler: () => void, ms: number) => unknown) | undefined;
}): DuplexSideband {
  const { connect, logger, onUsage } = dependencies;
  const now = dependencies.now ?? Date.now;
  const later =
    dependencies.setTimeout ??
    ((handler: () => void, ms: number) => setTimeout(handler, ms));
  const calls = new Map<string, Attached>();

  const receive = (id: string, line: Attached, event: unknown) => {
    const type = text(event, "type");
    switch (type) {
      case "input_audio_buffer.speech_started":
        line.lastSpeechAt = now();
        break;
      case "input_audio_buffer.speech_stopped":
        line.turnEndedAt = now();
        break;
      case "output_audio_buffer.started":
        if (line.turnEndedAt !== null) {
          logger.info(
            { qVoiceSessionId: id, firstAudioMs: now() - line.turnEndedAt },
            "duplex sideband first audio",
          );
          line.turnEndedAt = null;
        }
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const itemId = text(event, "item_id");
        const usage = field(event, "usage");
        if (itemId !== undefined && usage !== undefined) {
          const input = field(usage, "input_token_details");
          onUsage(id, {
            responseId: `tx_${itemId}`.slice(0, 128),
            kind: "TRANSCRIPTION",
            inputTextTokens: tokens(input, "text_tokens"),
            inputAudioTokens: tokens(input, "audio_tokens"),
            cachedTextTokens: 0,
            cachedAudioTokens: 0,
            outputTextTokens: tokens(usage, "output_tokens"),
            outputAudioTokens: 0,
          });
        }
        break;
      }
      case "response.done": {
        const response = field(event, "response");
        const responseId = text(response, "id");
        const usage = field(response, "usage");
        const cq = text(field(response, "metadata"), "cq_kind");
        const kind = cq === "BACKCHANNEL" || cq === "BRIDGE" ? cq : undefined;
        if (responseId !== undefined && usage !== undefined) {
          onUsage(id, sidebandUsageReport(responseId, usage, kind));
        }
        const status = text(response, "status");
        if (status === "failed" || status === "incomplete") {
          const details = field(response, "status_details");
          logger.warn(
            {
              qVoiceSessionId: id,
              status,
              reason: text(details, "reason"),
              code: text(field(details, "error"), "code"),
            },
            "duplex sideband response did not complete",
          );
        }
        break;
      }
      case "error":
        logger.warn(
          {
            qVoiceSessionId: id,
            type: text(field(event, "error"), "type"),
            code: text(field(event, "error"), "code"),
          },
          "duplex sideband realtime error",
        );
        break;
      case undefined:
      default:
        // Function calls are the browser relay's to execute (one owner).
        break;
    }
  };

  const open = (id: string, line: Attached) => {
    connect(line.callId, {
      onEvent: (event) => {
        if (calls.get(id) === line && !line.detached) receive(id, line, event);
      },
      onClose: (clean) => {
        line.socket = null;
        if (clean || line.detached || calls.get(id) !== line) return;
        if (line.reattaches >= SIDEBAND_REATTACH_MAX) {
          logger.warn({ qVoiceSessionId: id }, "duplex sideband gave up");
          return;
        }
        line.reattaches += 1;
        logger.info(
          { qVoiceSessionId: id, reattaches: line.reattaches },
          "duplex sideband dropped; re-attaching",
        );
        later(() => {
          if (!line.detached && calls.get(id) === line) open(id, line);
        }, SIDEBAND_REATTACH_BACKOFF_MS * line.reattaches);
      },
    }).then(
      (socket) => {
        if (line.detached || calls.get(id) !== line) {
          socket.close();
          return;
        }
        line.socket = socket;
        logger.info({ qVoiceSessionId: id }, "duplex sideband attached");
      },
      (error: unknown) => {
        logger.warn(
          { qVoiceSessionId: id, err: error },
          "duplex sideband not attached",
        );
      },
    );
  };

  return {
    attach: (id, callId) => {
      const previous = calls.get(id);
      if (previous?.callId === callId) return;
      if (previous !== undefined) {
        previous.detached = true;
        previous.socket?.close();
      }
      const line: Attached = {
        callId,
        socket: null,
        detached: false,
        reattaches: 0,
        lastSpeechAt: 0,
        turnEndedAt: null,
      };
      calls.set(id, line);
      open(id, line);
    },
    deliver: (id, answer) => {
      const line = calls.get(id);
      const socket = line?.socket ?? null;
      if (line === undefined || socket === null || line.detached) return false;
      // Spoken over since the turn was heard: the browser decides whether
      // it was noise (say it) or a new turn (do not).
      if (line.lastSpeechAt > answer.since) return false;
      socket.send({
        type: "conversation.item.create",
        item: {
          type: "function_call",
          call_id: answer.callId,
          name: "ask_q",
          arguments: answer.arguments,
        },
      });
      socket.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: answer.callId,
          output: answer.output,
        },
      });
      socket.send({
        type: "response.create",
        response: { tool_choice: "none" },
      });
      return true;
    },
    detach: (id) => {
      const line = calls.get(id);
      if (line === undefined) return;
      calls.delete(id);
      line.detached = true;
      line.socket?.close();
    },
    attached: (id) => (calls.get(id)?.socket ?? null) !== null,
  };
}
