"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@capital-q/ui/button";
import { ICON_SIZE, Mic, Square } from "@capital-q/ui/icons";

/**
 * A voice note in the chat composer (R34). Tap to record, tap again to
 * send; Cancel discards. Nothing touches the microphone until the person
 * taps. No animation at all -- the state is said in words and a count of
 * seconds -- so it is the same under reduced motion.
 *
 * The recording becomes a file (audio/webm, or audio/mp4 where the browser
 * records that) and goes through the same upload, scan and storage path as
 * any other file.
 */

const MAX_MS = 5 * 60 * 1000;

type Recording = {
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly startedAt: number;
  readonly chunks: Blob[];
  cancelled: boolean;
};

/** The container this browser records into, from the two the upload admits. */
export function voiceContainer(
  isTypeSupported: (type: string) => boolean,
): { readonly mimeType: string; readonly extension: string } | null {
  if (isTypeSupported("audio/webm")) {
    return { mimeType: "audio/webm", extension: "webm" };
  }
  if (isTypeSupported("audio/mp4")) {
    return { mimeType: "audio/mp4", extension: "m4a" };
  }
  return null;
}

export function VoiceRecorder({
  disabled,
  onRecorded,
  onError,
}: {
  readonly disabled: boolean;
  readonly onRecorded: (file: File, durationMs: number) => void;
  readonly onError: (message: string) => void;
}) {
  const recording = useRef<Recording | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const active = elapsedMs !== null;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const current = recording.current;
      if (current === null) return;
      const elapsed = Date.now() - current.startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_MS) current.recorder.stop();
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  // Release the microphone if the page goes away mid-recording.
  useEffect(
    () => () => {
      const current = recording.current;
      if (current === null) return;
      current.cancelled = true;
      current.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const start = async () => {
    const container =
      typeof MediaRecorder === "undefined"
        ? null
        : voiceContainer((type) => MediaRecorder.isTypeSupported(type));
    if (container === null || !("mediaDevices" in navigator)) {
      onError("This browser can't record voice notes.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Allow the microphone to record a voice note.");
      return;
    }
    const recorder = new MediaRecorder(stream, {
      mimeType: container.mimeType,
    });
    const current: Recording = {
      recorder,
      stream,
      startedAt: Date.now(),
      chunks: [],
      cancelled: false,
    };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) current.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      recording.current = null;
      setElapsedMs(null);
      const durationMs = Math.min(Date.now() - current.startedAt, MAX_MS);
      if (current.cancelled || current.chunks.length === 0) return;
      const file = new File(
        current.chunks,
        `voice-note.${container.extension}`,
        { type: container.mimeType },
      );
      onRecorded(file, Math.max(1, durationMs));
    });
    recording.current = current;
    recorder.start();
    setElapsedMs(0);
  };

  const stop = (cancel: boolean) => {
    const current = recording.current;
    if (current === null) return;
    current.cancelled = cancel;
    current.recorder.stop();
  };

  if (elapsedMs === null) {
    return (
      <Button
        type="button"
        variant="quiet"
        disabled={disabled}
        onClick={() => void start()}
      >
        <Mic size={ICON_SIZE.regular} aria-hidden="true" />
        Record a voice note
      </Button>
    );
  }
  const seconds = Math.floor(elapsedMs / 1000);
  return (
    <span
      className="flex items-center gap-2"
      role="group"
      aria-label="Voice note"
    >
      <Button
        type="button"
        variant="primary"
        aria-pressed="true"
        onClick={() => stop(false)}
      >
        <Square size={ICON_SIZE.regular} aria-hidden="true" />
        Stop and send
      </Button>
      <span
        className="cq-body-sm cq-numeric text-(--cq-text-secondary)"
        role="status"
      >
        Recording {Math.floor(seconds / 60)}:
        {String(seconds % 60).padStart(2, "0")}
      </span>
      <Button type="button" variant="quiet" onClick={() => stop(true)}>
        Cancel
      </Button>
    </span>
  );
}
