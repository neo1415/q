"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";

import {
  REHEARSAL_HAND_RAISED_SIGNAL,
  REHEARSAL_SILENCE_SIGNAL,
  rehearsalSimulationLabel,
  type QRehearsalDto,
} from "@capital-q/contracts";
import {
  Captions,
  CaptionsOff,
  Eye,
  EyeOff,
  Hand,
  ICON_STROKE,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "@capital-q/ui/icons";

import { startVoiceSessionAction } from "@/features/voice/actions";
import { deviceLocale } from "@/features/voice/device-locale";
import { useVoiceSession } from "@/features/voice/use-voice-session";
import { isLineLive, type VoiceTranscriptLine } from "@/features/voice/session";

import {
  clockLabel,
  elapsedLabel,
  greySignature,
  initialsOf,
  screenChanged,
  moodWord,
  shouldNudgeSilence,
  LOOK_QUALITY,
  LOOK_WIDTH,
  SEE_YOU_CONSENT,
  shouldLook,
} from "./meet";
import {
  raiseHandAction,
  readRehearsalAction,
  sayInRehearsalAction,
  shareScreenFrameAction,
} from "./rehearsal-actions";
import {
  meetSoundMs,
  playMeetSound,
  readMeetSoundsPreference,
  saveMeetSoundsPreference,
  type MeetSound,
} from "./meet-sounds";

/**
 * The rehearsal room (REHEARSE, founder direction 2026-10-01): a video call
 * laid out like Google Meet -- the other person's tile on the stage, your
 * self-view, captions above a bottom bar of round controls, the clock and
 * the meeting's name on the left, a red Leave pill -- where the other
 * person is Q playing them, by voice.
 *
 * Nothing here decides words. The voice line is a rehearsal line: the Q
 * API routes every spoken turn to the rehearsal, which plays the person.
 * The camera stays in this browser (a mirror for the person, never sent).
 * A shared screen is sampled every few seconds and a frame is sent only
 * when it changed; the server shows it to the next turn and keeps nothing.
 */

const FRAME_EVERY_MS = 6_000;
const FRAME_MAX_WIDTH = 1280;
const SIGNATURE_SIZE = { width: 32, height: 18 } as const;
/**
 * After the other person's goodbye, a short beat, then they leave (founder
 * live test 2026-10-01: the angry ending must be a spoken goodbye, a
 * beat, then the leave sound).
 */
const CLOSE_PAUSE_MS = 1_400;

type Layout = "SPOTLIGHT" | "TILED";

function RoundButton({
  label,
  icon: Icon,
  onClick,
  pressed,
  off = false,
  className = "",
  disabled = false,
}: {
  readonly label: string;
  readonly icon: ComponentType<{
    readonly size?: number;
    readonly strokeWidth?: number;
    readonly "aria-hidden"?: boolean | "true";
  }>;
  readonly onClick: () => void;
  readonly pressed?: boolean | undefined;
  readonly off?: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-12 shrink-0 items-center justify-center rounded-(--cq-radius-full) transition-colors duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-50 motion-reduce:transition-none ${
        off
          ? "bg-(--cq-danger) text-(--cq-text-inverse) hover:opacity-90"
          : pressed === true
            ? "bg-(--cq-stage-accent) text-(--cq-stage-canvas)"
            : "bg-(--cq-stage-surface-strong) text-(--cq-stage-text) hover:bg-(--cq-stage-border)"
      } ${className}`}
    >
      <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </button>
  );
}

export function RehearsalRoom({
  initial,
  seeYou = false,
}: {
  readonly initial: QRehearsalDto;
  /** They opted in, in the lobby, to Q seeing them on camera. */
  readonly seeYou?: boolean;
}) {
  const router = useRouter();
  const [rehearsal, setRehearsal] = useState(initial);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  // Consent to Q seeing them: separate from the self-view, off unless they
  // opted in, and off again the instant they say so.
  const [qSees, setQSees] = useState(seeYou);
  const consent = useRef(seeYou);
  const lastLook = useRef(0);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [hand, setHand] = useState(false);
  const [layout, setLayout] = useState<Layout>("SPOTLIGHT");
  const [panel, setPanel] = useState(false);
  const [more, setMore] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [voiceLive, setVoiceLive] = useState<"CONNECTING" | "LIVE" | "TYPED">(
    "CONNECTING",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The preference lives in this browser; it shows only in the closed
  // menu, so the server render never disagrees with it on screen.
  const [soundsOn, setSoundsOn] = useState(readMeetSoundsPreference);
  const sounds = useRef(soundsOn);
  const sound = useCallback((which: MeetSound) => {
    playMeetSound(which, sounds.current);
  }, []);
  // Screen sharing exists on desktop browsers only; never a dead button.
  const [canShare] = useState(
    () =>
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function",
  );

  const personaTile = useRef<HTMLDivElement | null>(null);
  const selfTile = useRef<HTMLDivElement | null>(null);
  const selfVideo = useRef<HTMLVideoElement | null>(null);
  const screenVideo = useRef<HTMLVideoElement | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const lastSignature = useRef<Uint8Array | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const left = useRef(false);
  // Set when the line opens and on every line heard; 0 until then.
  const lastActivity = useRef(0);

  const name = rehearsal.counterpart.name;
  const label = rehearsalSimulationLabel(name);
  const startedAt = Date.parse(initial.createdAt);
  const ended = rehearsal.endedAt !== null || rehearsal.status === "FINISHED";

  const refresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
    }
    // The line is written when the turn finishes; read it a moment later.
    refreshTimer.current = window.setTimeout(() => {
      void readRehearsalAction(initial.id).then((result) => {
        if (result.ok) setRehearsal(result.value);
      });
    }, 600);
  }, [initial.id]);

  /**
   * A small look at them, when they consented and their camera is on: a
   * 512px JPEG sent for the next turn only and never stored. On their turns
   * (fresh with each one, so "can you see this?" has a frame from just now) and, between turns, once per 30 s.
   */
  const look = useCallback(
    async (reason: "TURN" | "IDLE") => {
      const video = selfVideo.current;
      if (
        video === null ||
        video.videoWidth === 0 ||
        !shouldLook({
          consent: consent.current,
          cameraOn: camStream.current !== null,
          ended: left.current,
          lastLookMs: lastLook.current,
          nowMs: Date.now(),
          reason,
        })
      ) {
        return;
      }
      lastLook.current = Date.now();
      const scale = Math.min(1, LOOK_WIDTH / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas
        .getContext("2d")
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", LOOK_QUALITY);
      // Consent can be withdrawn while the frame was being drawn.
      if (!consent.current) return;
      await shareScreenFrameAction(initial.id, image, "CAMERA").catch(
        () => undefined,
      );
    },
    [initial.id],
  );
  const lookRef = useRef(look);
  useEffect(() => {
    lookRef.current = look;
  }, [look]);

  const voice = useVoiceSession({
    onLine: (line: VoiceTranscriptLine) => {
      lastActivity.current = Date.now();
      if (line.role === "user") {
        setHand(false);
        nudged.current = false;
        // They are speaking: a look rides with this turn.
        void lookRef.current("TURN");
      }
      if (line.role === "q" && !line.partial) refresh();
    },
    onError: (message) => setNotice(message),
    onEnded: (reason) => {
      if (!left.current && reason !== "ended") {
        // A dropped line: keep going by typing, or reconnect the voice.
        setVoiceLive("TYPED");
        setPanel(true);
        setNotice(
          "The voice line dropped. Reconnect, or keep going by typing.",
        );
      }
    },
  });

  // The line as it really is: LIVE only while it can carry a turn. A line
  // that dropped falls back to typing (live 2026-10-01: a typed answer went
  // into a dead socket and nothing came back).
  const lineLive = voiceLive === "LIVE" && isLineLive(voice);
  const typedMode =
    voiceLive === "TYPED" || (voiceLive === "LIVE" && !lineLive);

  // The person leaving hears the leave sound; when the other side ended
  // the meeting, their leaving sound plays instead.
  const leave = useCallback(
    async (cue: MeetSound = "LEAVE") => {
      if (left.current) return;
      left.current = true;
      for (const stream of [camStream.current, screenStream.current]) {
        stream?.getTracks().forEach((track) => track.stop());
      }
      await voice.end().catch(() => undefined);
      sound(cue);
      if (sounds.current) {
        await new Promise((done) => window.setTimeout(done, meetSoundMs(cue)));
      }
      router.push(`/rehearsals/r/${encodeURIComponent(initial.id)}`);
    },
    [initial.id, router, voice, sound],
  );

  // Open the voice line once: the other person speaks first.
  // Open the voice line; on a reconnect, resume without a new greeting.
  const connect = useCallback(
    async (resume: boolean) => {
      setVoiceLive("CONNECTING");
      const started = await startVoiceSessionAction({
        rehearsal: { rehearsalId: initial.id },
        voice: initial.voice,
        // Heard and spoken in the person's own language, as on Home.
        ...deviceLocale(),
        ...(resume ? { resume: true } : {}),
      });
      if (!started.ok) {
        setNotice(`${started.message} You can answer by typing.`);
        setVoiceLive("TYPED");
        setPanel(true);
        return;
      }
      try {
        await voice.start({
          credential: started.value,
          firstMessage: started.value.firstMessage,
        });
        lastActivity.current = Date.now();
        setVoiceLive("LIVE");
        if (!resume) sound("JOIN");
      } catch {
        // A denied microphone lands here: the room still works by typing.
        setNotice(
          "Voice didn't start (is the microphone allowed?). You can answer by typing.",
        );
        setVoiceLive("TYPED");
        setPanel(true);
      }
    },
    [initial.id, initial.voice, voice, sound],
  );
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void connect(false);
  }, [connect]);

  // Silence: when nobody has spoken for a while, the played person reacts
  // once (asks if they are there, rephrases) -- a cue, never their words.
  const nudged = useRef(false);
  useEffect(() => {
    if (!lineLive) return;
    const id = window.setInterval(() => {
      if (
        shouldNudgeSilence({
          state: voice.state,
          lastActivityMs: lastActivity.current,
          nowMs: Date.now(),
          alreadyNudged: nudged.current,
          micOn,
          ended,
        })
      ) {
        nudged.current = true;
        lastActivity.current = Date.now();
        voice.sendText(REHEARSAL_SILENCE_SIGNAL);
      }
    }, 3_000);
    return () => window.clearInterval(id);
  }, [lineLive, voice, micOn, ended]);

  // The clock and the timer.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Speaking rings follow the audio, outside React's render loop.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      personaTile.current?.style.setProperty(
        "--level",
        String(Math.min(1, voice.outputLevel() * 2.2)),
      );
      selfTile.current?.style.setProperty(
        "--level",
        String(micOn ? Math.min(1, voice.inputLevel() * 2.2) : 0),
      );
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [voice, micOn]);

  // The other person closed the meeting: let them finish, then leave.
  useEffect(() => {
    if (!ended || voice.state === "Q_SPEAKING") return;
    const id = window.setTimeout(() => void leave("THEY_LEFT"), CLOSE_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [ended, voice.state, leave]);

  // Every track and timer stops with the room.
  useEffect(
    () => () => {
      left.current = true;
      for (const stream of [camStream.current, screenStream.current]) {
        stream?.getTracks().forEach((track) => track.stop());
      }
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
    },
    [],
  );

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    voice.setMuted(!next);
  }

  async function toggleCamera() {
    if (camOn) {
      camStream.current?.getTracks().forEach((track) => track.stop());
      camStream.current = null;
      setCamOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: false,
      });
      camStream.current = stream;
      setCamOn(true);
    } catch {
      setNotice("The camera isn't available. Check the browser's permission.");
    }
  }

  useEffect(() => {
    if (selfVideo.current !== null) {
      selfVideo.current.srcObject = camOn ? camStream.current : null;
    }
  }, [camOn, layout, sharing]);

  /** Q stops seeing them at once: no more frames, and the held one is forgotten. */
  function toggleSeeing() {
    const next = !qSees;
    consent.current = next;
    setQSees(next);
    if (!next) {
      void shareScreenFrameAction(initial.id, null, "CAMERA").catch(
        () => undefined,
      );
    } else {
      lastLook.current = 0;
      if (!camOn) setNotice(`Turn on your camera so ${name} can see you.`);
      void look("IDLE");
    }
  }

  // Between turns, one look per idle period, only while they consent.
  useEffect(() => {
    if (!qSees || !camOn || ended) return;
    const id = window.setInterval(() => void look("IDLE"), 5_000);
    return () => window.clearInterval(id);
  }, [qSees, camOn, ended, look]);

  async function raiseHand() {
    if (hand) {
      setHand(false);
      return;
    }
    setHand(true);
    sound("HAND");
    if (lineLive) {
      voice.sendText(REHEARSAL_HAND_RAISED_SIGNAL);
      return;
    }
    const result = await raiseHandAction(initial.id);
    if (result.ok) setRehearsal(result.value);
    else setNotice(result.message);
  }

  async function send() {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setDraft("");
    setHand(false);
    await look("TURN");
    if (lineLive) {
      // Typed while the line is open: the same turn, answered aloud.
      voice.sendText(text);
      return;
    }
    setSending(true);
    const result = await sayInRehearsalAction(initial.id, text);
    setSending(false);
    if (result.ok) setRehearsal(result.value);
    else {
      setDraft(text);
      setNotice(result.message);
    }
  }

  const sendFrame = useCallback(async () => {
    const video = screenVideo.current;
    if (video === null || video.videoWidth === 0) return;
    const tiny = document.createElement("canvas");
    tiny.width = SIGNATURE_SIZE.width;
    tiny.height = SIGNATURE_SIZE.height;
    const tinyContext = tiny.getContext("2d", { willReadFrequently: true });
    if (tinyContext === null) return;
    tinyContext.drawImage(video, 0, 0, tiny.width, tiny.height);
    const signature = greySignature(
      tinyContext.getImageData(0, 0, tiny.width, tiny.height).data,
    );
    if (!screenChanged(lastSignature.current, signature)) return;
    lastSignature.current = signature;
    const scale = Math.min(1, FRAME_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);
    let quality = 0.7;
    let image = canvas.toDataURL("image/jpeg", quality);
    while (image.length > 470_000 && quality > 0.3) {
      quality -= 0.15;
      image = canvas.toDataURL("image/jpeg", quality);
    }
    const sent = await shareScreenFrameAction(initial.id, image);
    if (!sent.ok) setNotice(sent.message);
  }, [initial.id]);

  function stopSharing() {
    screenStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current = null;
    lastSignature.current = null;
    setSharing(false);
  }

  async function toggleShare() {
    if (sharing) {
      stopSharing();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      screenStream.current = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", stopSharing);
      setSharing(true);
      sound("SHARE");
      setLayout("SPOTLIGHT");
    } catch {
      // Cancelled in the browser's picker: nothing to say.
    }
  }

  useEffect(() => {
    if (!sharing) return;
    if (screenVideo.current !== null) {
      screenVideo.current.srcObject = screenStream.current;
    }
    const first = window.setTimeout(() => void sendFrame(), 1_200);
    const id = window.setInterval(() => void sendFrame(), FRAME_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [sharing, sendFrame]);

  // Captions: the newest line, from the voice line or the typed turns.
  const spoken = voice.transcript.at(-1);
  const lastTurn = rehearsal.turns.at(-1);
  const caption = lineLive
    ? spoken === undefined
      ? null
      : { who: spoken.role === "q" ? name : "You", text: spoken.text }
    : lastTurn === undefined
      ? null
      : { who: lastTurn.from === "THEM" ? name : "You", text: lastTurn.text };
  const thinking = voice.state === "THINKING" || sending;
  const mood = moodWord(
    [...rehearsal.turns].reverse().find((turn) => turn.from === "THEM"),
  );

  const personaView = (
    <div
      ref={personaTile}
      className="relative flex h-full min-h-40 w-full items-center justify-center overflow-hidden rounded-(--cq-radius-lg) bg-(--cq-stage-surface)"
      style={{ ["--level" as string]: "0" }}
    >
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute -inset-2 rounded-(--cq-radius-full) border-4 border-(--cq-stage-accent)"
          style={{ opacity: "var(--level)" }}
        />
        <div className="flex size-20 items-center justify-center rounded-(--cq-radius-full) bg-(--cq-stage-surface-strong) text-3xl font-medium text-(--cq-stage-text) sm:size-28 sm:text-4xl">
          {initialsOf(name)}
        </div>
      </div>
      <span className="cq-body-sm absolute bottom-3 left-3 max-w-[80%] truncate rounded-(--cq-radius-sm) bg-(--cq-overlay) px-2 py-1 text-(--cq-stage-text)">
        {name}
        {thinking ? (
          <span className="text-(--cq-stage-text-muted)"> · thinking</span>
        ) : mood !== null ? (
          <span className="text-(--cq-stage-text-muted)"> · {mood}</span>
        ) : null}
      </span>
    </div>
  );

  const selfView = (compact: boolean) => (
    <div
      ref={selfTile}
      className={`relative flex items-center justify-center overflow-hidden rounded-(--cq-radius-lg) bg-(--cq-stage-surface-strong) ${
        compact ? "aspect-video w-32 sm:w-48" : "h-full min-h-40 w-full"
      }`}
      style={{ ["--level" as string]: "0" }}
    >
      {camOn ? (
        <video
          ref={selfVideo}
          autoPlay
          muted
          playsInline
          className="h-full w-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute -inset-1.5 rounded-(--cq-radius-full) border-2 border-(--cq-stage-accent)"
            style={{ opacity: "var(--level)" }}
          />
          <div className="flex size-10 items-center justify-center rounded-(--cq-radius-full) bg-(--cq-stage-surface) text-(--cq-stage-text) sm:size-14">
            You
          </div>
        </div>
      )}
      {micOn ? null : (
        <span className="absolute top-2 right-2 rounded-(--cq-radius-full) bg-(--cq-overlay) p-1 text-(--cq-stage-text)">
          <MicOff size={14} aria-label="Your microphone is off" />
        </span>
      )}
      {qSees && camOn ? (
        <span
          role="status"
          className="cq-caption absolute top-2 left-2 inline-flex items-center gap-1 rounded-(--cq-radius-sm) bg-(--cq-overlay) px-1.5 py-0.5 text-(--cq-stage-text)"
        >
          <Eye size={12} aria-hidden="true" />
          {name} can see you
        </span>
      ) : null}
      <span className="cq-caption absolute bottom-2 left-2 rounded-(--cq-radius-sm) bg-(--cq-overlay) px-1.5 py-0.5 text-(--cq-stage-text)">
        You
        {hand ? " · hand raised" : ""}
      </span>
    </div>
  );

  return (
    <div
      className="cq-stage fixed inset-0 z-(--cq-z-modal) flex flex-col"
      role="region"
      aria-label={`Rehearsal with ${name}`}
    >
      <p className="cq-caption px-4 pt-3 text-(--cq-stage-text-muted)">
        {label}
      </p>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {sharing ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-(--cq-radius-lg) bg-(--cq-stage-surface)">
                <video
                  ref={screenVideo}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-contain"
                />
                <span className="cq-caption absolute top-2 left-2 rounded-(--cq-radius-sm) bg-(--cq-overlay) px-2 py-1 text-(--cq-stage-text)">
                  You’re presenting · {name} can see your screen
                </span>
              </div>
              <div className="grid h-36 shrink-0 grid-cols-2 gap-3 lg:h-auto lg:w-64 lg:grid-cols-1 lg:grid-rows-2">
                {personaView}
                {selfView(false)}
              </div>
            </div>
          ) : layout === "TILED" ? (
            <div className="grid min-h-0 flex-1 grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1">
              {personaView}
              {selfView(false)}
            </div>
          ) : (
            <div className="relative min-h-0 flex-1">
              {personaView}
              <div className="absolute right-3 bottom-3">{selfView(true)}</div>
            </div>
          )}

          {captionsOn && caption !== null ? (
            <div
              aria-live="polite"
              className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
            >
              <p className="cq-body max-w-3xl rounded-(--cq-radius-md) bg-(--cq-overlay) px-4 py-2 text-(--cq-stage-text)">
                <span className="font-medium">{caption.who}: </span>
                {caption.text.length > 280
                  ? `…${caption.text.slice(-280)}`
                  : caption.text}
              </p>
            </div>
          ) : null}
        </main>

        {panel ? (
          <aside
            aria-label="Transcript"
            className="fixed inset-x-0 bottom-20 z-(--cq-z-sheet) flex max-h-[60vh] flex-col rounded-t-(--cq-radius-lg) bg-(--cq-surface-raised) text-(--cq-text-primary) md:static md:max-h-none md:w-80 md:rounded-(--cq-radius-lg)"
          >
            <div className="flex items-center justify-between px-4 pt-3">
              <h2 className="cq-label">Transcript</h2>
              <button
                type="button"
                aria-label="Close transcript"
                onClick={() => setPanel(false)}
                className="inline-flex size-11 items-center justify-center rounded-(--cq-radius-full) hover:bg-(--cq-surface-subtle)"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-2">
              {rehearsal.turns.map((turn, index) => (
                <li key={`${turn.at}-${String(index)}`} className="cq-body-sm">
                  <span className="cq-caption block text-(--cq-text-tertiary)">
                    {turn.from === "THEM" ? name : "You"}
                  </span>
                  {turn.text}
                </li>
              ))}
            </ol>
            {ended ? (
              <p className="cq-body-sm px-4 pb-4 text-(--cq-text-secondary)">
                {name} ended the meeting.
              </p>
            ) : (
              <form
                className="flex gap-2 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <label className="sr-only" htmlFor="rehearsal-typed">
                  Type to {name}
                </label>
                <input
                  id="rehearsal-typed"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={4000}
                  placeholder={`Say something to ${name}`}
                  className="cq-body-sm min-h-11 min-w-0 flex-1 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3"
                />
                <button
                  type="submit"
                  disabled={draft.trim().length === 0 || sending}
                  className="cq-label min-h-11 rounded-(--cq-radius-md) bg-(--cq-accent) px-3 text-(--cq-text-inverse) disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            )}
          </aside>
        ) : null}
      </div>

      {notice === null ? null : (
        <div
          role="status"
          className="cq-body-sm mx-auto mb-2 flex max-w-xl items-center gap-2 rounded-(--cq-radius-md) bg-(--cq-stage-surface-strong) px-3 py-2"
        >
          <span>{notice}</span>
          {typedMode && !ended ? (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                void connect(true);
              }}
              className="cq-label min-h-11 rounded-(--cq-radius-md) bg-(--cq-stage-accent) px-3 text-(--cq-stage-canvas)"
            >
              Reconnect voice
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
            className="inline-flex size-11 items-center justify-center"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <footer className="relative flex h-20 shrink-0 items-center justify-between gap-2 px-3 pb-(--cq-safe-bottom) md:px-6">
        <p className="cq-body-sm hidden min-w-0 truncate text-(--cq-stage-text) md:block md:w-64">
          {clockLabel(new Date(now))}
          <span className="text-(--cq-stage-text-muted)">
            {" "}
            | Rehearsal with {name} · {elapsedLabel(startedAt, now)}
          </span>
        </p>
        <p className="cq-caption text-(--cq-stage-text-muted) md:hidden">
          {elapsedLabel(startedAt, now)}
        </p>

        <div className="flex items-center gap-2 sm:gap-3">
          <RoundButton
            label={micOn ? "Turn off microphone" : "Turn on microphone"}
            icon={micOn ? Mic : MicOff}
            off={!micOn}
            onClick={toggleMic}
            disabled={!lineLive}
          />
          <RoundButton
            label={camOn ? "Turn off camera" : "Turn on camera"}
            icon={camOn ? Video : VideoOff}
            off={!camOn}
            onClick={() => void toggleCamera()}
          />
          <RoundButton
            label={qSees ? `Stop letting ${name} see you` : SEE_YOU_CONSENT}
            icon={qSees ? Eye : EyeOff}
            pressed={qSees}
            onClick={toggleSeeing}
            disabled={ended}
          />
          <RoundButton
            label={captionsOn ? "Turn off captions" : "Turn on captions"}
            icon={captionsOn ? Captions : CaptionsOff}
            pressed={captionsOn}
            onClick={() => setCaptionsOn((on) => !on)}
            className="hidden sm:inline-flex"
          />
          <RoundButton
            label={hand ? "Lower hand" : "Raise hand"}
            icon={Hand}
            pressed={hand}
            onClick={() => void raiseHand()}
            disabled={ended}
          />
          {canShare ? (
            <RoundButton
              label={sharing ? "Stop presenting" : "Present your screen"}
              icon={MonitorUp}
              pressed={sharing}
              onClick={() => void toggleShare()}
              disabled={ended}
              className="hidden md:inline-flex"
            />
          ) : null}
          <div className="relative">
            <RoundButton
              label="More options"
              icon={MoreHorizontal}
              pressed={more}
              onClick={() => setMore((open) => !open)}
            />
            {more ? (
              <div
                role="menu"
                className="absolute bottom-14 left-1/2 flex w-56 -translate-x-1/2 flex-col rounded-(--cq-radius-md) bg-(--cq-surface-raised) py-1 text-(--cq-text-primary) shadow-(--cq-shadow-overlay)"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="cq-body-sm flex min-h-11 items-center gap-2 px-3 text-left hover:bg-(--cq-surface-subtle)"
                  onClick={() => {
                    setLayout((now) =>
                      now === "SPOTLIGHT" ? "TILED" : "SPOTLIGHT",
                    );
                    setMore(false);
                  }}
                >
                  <LayoutGrid size={16} aria-hidden="true" />
                  {layout === "SPOTLIGHT" ? "Tiled layout" : "Spotlight layout"}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={soundsOn}
                  className="cq-body-sm flex min-h-11 items-center gap-2 px-3 text-left hover:bg-(--cq-surface-subtle)"
                  onClick={() => {
                    const next = !soundsOn;
                    sounds.current = next;
                    setSoundsOn(next);
                    saveMeetSoundsPreference(next);
                    setMore(false);
                  }}
                >
                  {soundsOn ? (
                    <Volume2 size={16} aria-hidden="true" />
                  ) : (
                    <VolumeX size={16} aria-hidden="true" />
                  )}
                  Meeting sounds {soundsOn ? "on" : "off"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="cq-body-sm flex min-h-11 items-center gap-2 px-3 text-left hover:bg-(--cq-surface-subtle) sm:hidden"
                  onClick={() => {
                    setCaptionsOn((on) => !on);
                    setMore(false);
                  }}
                >
                  <Captions size={16} aria-hidden="true" />
                  {captionsOn ? "Turn off captions" : "Turn on captions"}
                </button>
                {canShare ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cq-body-sm flex min-h-11 items-center gap-2 px-3 text-left hover:bg-(--cq-surface-subtle) md:hidden"
                    onClick={() => {
                      setMore(false);
                      void toggleShare();
                    }}
                  >
                    <MonitorUp size={16} aria-hidden="true" />
                    {sharing ? "Stop presenting" : "Present your screen"}
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="cq-body-sm flex min-h-11 items-center gap-2 px-3 text-left hover:bg-(--cq-surface-subtle) md:hidden"
                  onClick={() => {
                    setPanel((open) => !open);
                    setMore(false);
                  }}
                >
                  <MessageSquare size={16} aria-hidden="true" />
                  {panel ? "Hide transcript" : "Transcript and typing"}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void leave()}
            aria-label="Leave the rehearsal"
            title="Leave the rehearsal"
            className="inline-flex h-12 w-16 items-center justify-center rounded-(--cq-radius-full) bg-(--cq-danger) text-(--cq-text-inverse) hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
          >
            <PhoneOff size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
        </div>

        <div className="hidden w-64 justify-end md:flex">
          <RoundButton
            label={panel ? "Hide transcript" : "Transcript and typing"}
            icon={MessageSquare}
            pressed={panel}
            onClick={() => setPanel((open) => !open)}
          />
        </div>
      </footer>
    </div>
  );
}
