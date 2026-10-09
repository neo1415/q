"use client";

import { useCallback, useRef, useState } from "react";

import { Button } from "@capital-q/ui/button";

import { startVoiceSessionAction } from "../actions";
import { useVoiceSession } from "../use-voice-session";
import type { LiveBridgeState } from "./bridge";
import { startLiveCall, type LiveCall, type LiveCallStats } from "./live-call";

/**
 * V: the developer-only voice comparison preview. A = GPT-Live (this
 * workstream), B = the existing OpenAI realtime duplex line, C = the
 * existing standard line (ElevenLabs or Deepgram, as the Q API issues it).
 * Every line here is real provider audio: nothing is mocked, so nothing
 * is labelled as such. What a line does not expose is said, not guessed.
 */

type Choice = "A" | "B" | "C";

const LABELS: Readonly<Record<Choice, string>> = {
  A: "A · GPT-Live (gpt-live-1)",
  B: "B · OpenAI realtime duplex (gpt-realtime-mini)",
  C: "C · Standard line (ElevenLabs / Deepgram)",
};

export function VoicePreview({
  available,
}: {
  readonly available: Readonly<Record<Choice, boolean>>;
}) {
  const [choice, setChoice] = useState<Choice>("A");
  const [voice, setVoice] = useState<"FEMALE" | "MALE">("FEMALE");
  const [briefing, setBriefing] = useState(true);
  const [status, setStatus] = useState<string>("Idle");
  const [stats, setStats] = useState<LiveCallStats | null>(null);
  const [bridge, setBridge] = useState<LiveBridgeState | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const call = useRef<LiveCall | null>(null);
  const standard = useVoiceSession({
    onEnded: (reason) => {
      setStatus(`Ended (${reason})`);
    },
    onError: (message) => {
      setStatus(message);
    },
  });

  const start = useCallback(async () => {
    setStats(null);
    setBridge(null);
    setIssued(null);
    setStatus("Connecting…");
    try {
      if (choice === "A") {
        call.current = await startLiveCall({
          voice,
          briefingOpening: briefing,
          fastNavigation: true,
          ...(briefing
            ? {
                opening: {
                  greeting:
                    "The call has just connected. Greet them warmly now, in one short natural sentence: no question, no filler. Their briefing is on its way; do not guess it.",
                  request:
                    "Brief me: what changed and what needs my attention today?",
                },
              }
            : {}),
          onUpdate: (update) => {
            setStats(update.stats);
            setBridge(update.bridge);
          },
          onEnded: (reason) => {
            call.current = null;
            setStatus(`Ended (${reason})`);
          },
        });
        setStatus("Live");
        return;
      }
      const started = await startVoiceSessionAction({
        voice,
        duplex: choice === "B",
      });
      if (!started.ok) {
        setStatus(started.message);
        return;
      }
      const credential = started.value;
      if (choice === "B" && credential.duplex === undefined) {
        setStatus(
          "The Q API did not broker a duplex line (CQ_VOICE_REALTIME off or capped).",
        );
        return;
      }
      // B and C: the existing lines do not expose their provider session
      // event to the page; what the Q API issued is shown instead.
      setIssued(
        choice === "B"
          ? "duplex credential issued by the Q API (provider: OpenAI realtime)"
          : `standard credential issued by the Q API (provider: ${credential.provider ?? "elevenlabs"})`,
      );
      await standard.start({ credential });
      setStatus("Live");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Could not start.");
    }
  }, [briefing, choice, standard, voice]);

  const stop = useCallback(async () => {
    setStatus("Closing…");
    if (call.current !== null) await call.current.end("ended");
    else await standard.end();
  }, [standard]);

  const live =
    status === "Live" || status === "Connecting…" || status === "Closing…";
  const transcript =
    choice === "A"
      ? (bridge?.transcript ?? []).map((turn, index) => ({
          id: String(index),
          who: turn.role === "user" ? "You" : "Q",
          text: turn.text,
        }))
      : standard.transcript.map((line) => ({
          id: line.id,
          who: line.role === "user" ? "You" : "Q",
          text: line.text,
        }));

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2" disabled={live}>
        <legend className="cq-label">Line</legend>
        {(Object.keys(LABELS) as Choice[]).map((key) => (
          <label key={key} className="flex min-h-11 items-center gap-2 cq-body">
            <input
              type="radio"
              name="line"
              value={key}
              checked={choice === key}
              disabled={!available[key]}
              onChange={() => {
                setChoice(key);
              }}
            />
            {LABELS[key]}
            {available[key] ? null : (
              <span className="cq-caption text-(--cq-text-tertiary)">
                not configured
              </span>
            )}
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-2 cq-body">
          Voice
          <select
            value={voice}
            onChange={(event) => {
              setVoice(event.target.value === "MALE" ? "MALE" : "FEMALE");
            }}
          >
            <option value="FEMALE">Female (A: marin)</option>
            <option value="MALE">Male (A: cedar)</option>
          </select>
        </label>
        {choice === "A" ? (
          <label className="flex min-h-11 items-center gap-2 cq-body">
            <input
              type="checkbox"
              checked={briefing}
              onChange={(event) => {
                setBriefing(event.target.checked);
              }}
            />
            Open with the briefing (warm hello, then the lowdown via Q Brain)
          </label>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3">
        {live ? (
          <Button onClick={() => void stop()}>End call</Button>
        ) : (
          <Button onClick={() => void start()}>Start conversation</Button>
        )}
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {status}
        </span>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 cq-caption">
        <dt>Active provider</dt>
        <dd>{choice === "A" ? "OpenAI GPT-Live" : (issued ?? "—")}</dd>
        <dt>Model (provider-reported)</dt>
        <dd>
          {choice === "A"
            ? `${stats?.createdModel ?? "—"} (session create, 201) · ${stats?.reportedModel ?? "waiting for session.started"} (session.started)`
            : "not exposed by this line"}
        </dd>
        {choice === "A" ? (
          <>
            <dt>Q speaking (player)</dt>
            <dd>{stats?.qSpeaking === true ? "yes" : "no"}</dd>
            <dt>Latency (transcript → transcript)</dt>
            <dd>
              {stats === null || stats.latenciesMs.length === 0
                ? "—"
                : stats.latenciesMs.map((ms) => `${String(ms)} ms`).join(", ")}
            </dd>
            <dt>Billed seconds</dt>
            <dd>
              {stats?.billedSeconds === null || stats === null
                ? "—"
                : `${String(stats.billedSeconds)} s ${stats.usageConfirmed ? "(final)" : "(running)"}`}
            </dd>
            <dt>Delegations</dt>
            <dd>
              {(bridge?.delegations ?? [])
                .map((d) => `${d.status}: ${d.request || "…"}`)
                .join(" · ") || "—"}
            </dd>
            {stats?.closedReason === null || stats === null ? null : (
              <>
                <dt>Closed</dt>
                <dd>{stats.closedReason}</dd>
              </>
            )}
          </>
        ) : null}
      </dl>

      <ol className="flex flex-col gap-2" aria-label="Live transcript">
        {transcript.map((line) => (
          <li key={line.id} className="cq-body">
            <span className="cq-label">{line.who}: </span>
            {line.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
