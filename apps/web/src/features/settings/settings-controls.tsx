"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  PERSONAL_ETIQUETTE_TEXT_MAX,
  Q_DAILY_OPTIONAL_SECTIONS,
  Q_PERSONALITIES,
  Q_VOICE_LISTENING_LEVELS,
  type GoogleConnectionDto,
  type InboundEmailAddressDto,
  type MyEtiquetteGuideDto,
  type NotificationSettingsDto,
  type QDailyFrequency,
  type QDailyOptionalSection,
  type QDailyPreferences,
  type QLanguagePreference,
  type QPersonality,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Check, ICON_SIZE, ICON_STROKE, Moon, Sun } from "@capital-q/ui/icons";

import { useThemeChoice } from "@/features/appearance/theme-toggle";
import type { ThemeChoice } from "@/features/appearance/theme";
import { setDailyPreferencesAction } from "@/features/daily/daily-actions";
import {
  removeMyGuideAction,
  saveMyGuideAction,
} from "@/features/etiquette/etiquette-actions";
import {
  EMPTY_DRAFT,
  GuideInput,
  type GuideDraft,
} from "@/features/etiquette/guide-input";
import {
  connectGmail,
  disconnectGmail,
  readGmailConnection,
  readQEmailAddress,
  rotateQEmailAddress,
} from "@/features/integrations/integration-actions";
import {
  Q_MOTION_CHOICES,
  Q_MOTION_LABELS,
  storeQMotion,
  useQMotion,
} from "@/features/q-aperture/q-motion";
import { playSound } from "@/features/q-sound/sound-engine";
import {
  storeSoundPreference,
  useSoundPreference,
} from "@/features/q-sound/sound-preference";
import { SOUND_MODES, SOUND_MODE_LABELS } from "@/features/q-sound/sound-rules";
import { CrmSheet, Tag } from "@/features/relationships/crm-kit";
import {
  storeListeningPreference,
  useListeningPreference,
} from "@/features/voice/listening-preference";
import {
  storeVoicePreference,
  useVoicePreference,
} from "@/features/voice/voice-preference";
import { useWakeControl } from "@/features/wake/wake-setting";
import {
  disablePush,
  enablePush,
  pushState,
  type PushState,
} from "@/features/work/push";
import {
  noticeSettingsAction,
  saveNoticeSettingsAction,
} from "@/features/work/work-actions";
import { useT } from "@/features/i18n/language";

import {
  accountButton,
  Pending,
  RadioList,
  Segments,
  useAccountToast,
  WordSwitch,
} from "./account-kit";
import { SRow } from "./account-layout";
import { LanguageSetting } from "./language-setting";
import { setPersonalityAction } from "./personality-actions";

/**
 * Settings' own controls, drawn as the chosen design draws them ("One page
 * with an index", 2026-10-21). Every one saves what it says, through the
 * same stores and server actions the rest of the app uses; per-device
 * choices stay on this device, Q's personality, The Q Daily, the guide and
 * notification email are kept by Capital Q.
 */

/* ---------------- Appearance ---------------- */

const THEME_CARDS: readonly {
  readonly key: ThemeChoice;
  readonly label: string;
  readonly preview: string;
}[] = [
  { key: "light", label: "Light", preview: "cq-preview-light" },
  { key: "dark", label: "Dark", preview: "cq-preview-dark" },
  { key: "system", label: "Automatic", preview: "cq-preview-auto" },
];

/** Three cards, each a small picture of its theme; the choice applies at once. */
export function ThemeCards() {
  const t = useT();
  const toast = useAccountToast();
  const [choice, choose] = useThemeChoice();
  const { choice: motion, motion: effective } = useQMotion();
  return (
    <div className="py-3">
      <div
        role="radiogroup"
        aria-label={t("Appearance")}
        className="grid grid-cols-3 gap-2.5"
        data-appearance-cards
      >
        {THEME_CARDS.map((card) => {
          const on = choice === card.key;
          return (
            <button
              key={card.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                choose(card.key);
                toast(t(`Appearance: ${card.label}`));
              }}
              className={cx(
                "cq-crm-press flex flex-col gap-2 rounded-(--cq-radius-lg) border p-2.5 text-start transition-[border-color,box-shadow] duration-(--cq-motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)",
                on
                  ? "border-(--cq-text-secondary) shadow-[0_0_0_3px_var(--cq-accent-soft)]"
                  : "border-(--cq-border)",
              )}
              data-theme-card={card.key}
            >
              <span
                aria-hidden="true"
                className={cx(
                  card.preview,
                  "flex h-[60px] gap-1.5 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-preview-canvas) p-2",
                )}
              >
                <i className="flex-1 rounded-(--cq-radius-xs) bg-(--cq-preview-surface)" />
                <i className="flex-[0.4] rounded-(--cq-radius-xs) bg-(--cq-preview-accent)" />
              </span>
              <b className="flex items-center gap-1.5 text-sm font-medium text-(--cq-text-primary)">
                {card.key === "light" ? (
                  <Sun
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                  />
                ) : card.key === "dark" ? (
                  <Moon
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                  />
                ) : (
                  <HalfCircle />
                )}
                {t(card.label)}
              </b>
            </button>
          );
        })}
      </div>
      <span className="mt-3 block text-xs text-(--cq-text-tertiary)">
        {t("Automatic follows your device.")}
        {motion === "full" && effective === "calm"
          ? ` ${t("Your device asks for reduced motion, so Q stays calm.")}`
          : ""}
      </span>
    </div>
  );
}

function HalfCircle() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={ICON_SIZE.compact}
      height={ICON_SIZE.compact}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

export function MotionChoice() {
  const t = useT();
  const { choice } = useQMotion();
  return (
    <Segments
      label={t("Q motion")}
      value={choice}
      options={Q_MOTION_CHOICES.map((key) => ({
        key,
        label: t(Q_MOTION_LABELS[key]),
      }))}
      onChange={storeQMotion}
      data-q-motion-toggle
    />
  );
}

export function SoundChoice() {
  const t = useT();
  const mode = useSoundPreference();
  return (
    <Segments
      label={t("Q's sounds")}
      value={mode}
      options={SOUND_MODES.map((key) => ({
        key,
        label: t(SOUND_MODE_LABELS[key]),
      }))}
      onChange={(next) => {
        storeSoundPreference(next);
        if (next !== "OFF") playSound("ping");
      }}
      data-sound-setting
    />
  );
}

/* ---------------- Q ---------------- */

const PERSONALITY: Readonly<
  Record<QPersonality, { readonly label: string; readonly said: string }>
> = {
  AUTO: {
    label: "Auto",
    said: "Q reads you and adapts as you talk: playful when you are, brisk when you're busy, gentle when you're unsure.",
  },
  SHARP: {
    label: "Sharp",
    said: "Direct and efficient, like a seasoned analyst. Short sentences, no fluff.",
  },
  WARM: {
    label: "Warm",
    said: "Encouraging and patient. Q makes you feel in good hands, and still gets to the point.",
  },
  CALM: {
    label: "Calm",
    said: "Steady and unhurried, in plain words. Good company when things are busy.",
  },
  WITTY: {
    label: "Witty",
    said: "Playful and quick, with jokes and gentle teasing, never at the expense of the work.",
  },
};

/** Q's personality: each choice with what it means, saved at once. */
export function PersonalityChoice({
  initial,
}: {
  readonly initial: QPersonality;
}) {
  const t = useT();
  const toast = useAccountToast();
  const [chosen, setChosen] = useState<QPersonality>(initial);
  const [, startTransition] = useTransition();
  const order: readonly QPersonality[] = [
    "SHARP",
    "WARM",
    "CALM",
    "WITTY",
    "AUTO",
  ].filter((key): key is QPersonality =>
    (Q_PERSONALITIES as readonly string[]).includes(key),
  );
  return (
    <div className="py-3" data-personality-setting>
      <div className="mb-2 text-[15px] font-semibold text-(--cq-text-primary)">
        {t("Q’s personality")}
      </div>
      <RadioList
        name="personality"
        label={t("Q’s personality")}
        value={chosen}
        choices={order.map((key) => ({
          key,
          title: t(PERSONALITY[key].label),
          description: t(PERSONALITY[key].said),
        }))}
        onChange={(next) => {
          const before = chosen;
          setChosen(next);
          startTransition(async () => {
            const result = await setPersonalityAction(next);
            if (!result.ok) {
              setChosen(before);
              toast(t(result.message));
              return;
            }
            toast(t("Saved. Q follows it from its next message for you."));
          });
        }}
      />
    </div>
  );
}

/** Which language Q writes and speaks in; the list opens in a sheet. */
export function LanguageButton({
  initial,
  current,
}: {
  readonly initial: QLanguagePreference;
  /** The chosen language's own name, or null for Automatic. */
  readonly current: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={accountButton("secondary", "sm")}
        onClick={() => setOpen(true)}
        data-language-open
      >
        {current ?? t("Automatic")}
      </button>
      <CrmSheet
        open={open}
        onOpenChange={setOpen}
        title={t("Language")}
        sub={t("Written and spoken in this language.")}
      >
        <LanguageSetting initial={initial} />
      </CrmSheet>
    </>
  );
}

export function VoiceChoice() {
  const t = useT();
  const voice = useVoicePreference();
  return (
    <Segments
      label={t("Q's voice")}
      value={voice}
      options={[
        { key: "FEMALE", label: t("Female voice") },
        { key: "MALE", label: t("Male voice") },
      ]}
      onChange={storeVoicePreference}
      data-voice-setting
    />
  );
}

const LISTENING_LABELS = {
  OFF: "Off",
  SUBTLE: "Subtle",
  NATURAL: "Natural",
} as const;

export function ListeningChoice() {
  const t = useT();
  const level = useListeningPreference();
  return (
    <Segments
      label={t("Listening sounds")}
      value={level}
      options={Q_VOICE_LISTENING_LEVELS.map((key) => ({
        key,
        label: t(LISTENING_LABELS[key]),
      }))}
      onChange={storeListeningPreference}
      data-listening-setting
    />
  );
}

/** "Say Hey Q to start": the row, its switch, and why it can't, if it can't. */
export function WakeRow() {
  const t = useT();
  const toast = useAccountToast();
  const { on, supported, asking, notice, turnOn, turnOff } = useWakeControl();
  return (
    <SRow
      title={t("Say “Hey Q” to start")}
      description={
        <>
          {supported
            ? t(
                "This browser can listen for it. The Q button and Ctrl/Cmd+K always open Q.",
              )
            : t(
                "This browser can’t listen for “Hey Q”. Chrome, Edge and Safari can. The Q button and Ctrl/Cmd+K always open Q.",
              )}
          {notice === null ? null : (
            <span role="alert" className="mt-1 block text-(--cq-text-primary)">
              {t(notice)}
            </span>
          )}
        </>
      }
    >
      <WordSwitch
        on={on}
        disabled={!supported || asking}
        label={t("Say “Hey Q” to start")}
        onWord={t("On")}
        offWord={t("Off")}
        data-wake-toggle
        onChange={(next) => {
          if (next) {
            void turnOn().then(() =>
              toast(t("Say “Hey Q” to start. Only on this device.")),
            );
          } else turnOff();
        }}
      />
    </SRow>
  );
}

/* ---------------- How Q speaks for you ---------------- */

const GUIDE_PLACEHOLDER = `For example:
- Formal with investors, first names with founders once they use mine.
- Never use exclamation marks or "hope this finds you well".
- Sign off "Kind regards, Ada".
- Never mention our other investors by name.`;

/**
 * Capital Q's house guide, or your own on top of it (ADR 0050). Choosing
 * the house guide while you have your own asks before removing it; your
 * own is written or replaced in place and saved as a new version.
 */
export function SpeakingGuide({
  initial,
}: {
  readonly initial: MyEtiquetteGuideDto;
}) {
  const t = useT();
  const toast = useAccountToast();
  const [mine, setMine] = useState(initial);
  const [picked, setPicked] = useState<"house" | "mine">(
    initial.guide === null ? "house" : "mine",
  );
  const [draft, setDraft] = useState<GuideDraft>(() =>
    initial.guide === null
      ? EMPTY_DRAFT
      : {
          sourceKind: initial.guide.sourceKind,
          fileName: initial.guide.fileName,
          mediaType: initial.guide.mediaType,
          text: initial.guide.text,
        },
  );
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const house =
    mine.house.source === "BUILT_IN"
      ? t("Capital Q’s house guide")
      : t(`Your organisation’s house guide, “${mine.house.title}”`);
  const save = () => {
    setPhase("pending");
    setError(null);
    void saveMyGuideAction(draft).then((result) => {
      if (!result.ok) {
        setPhase("idle");
        setError(t(result.message));
        return;
      }
      setMine(result.mine);
      setPhase("done");
      toast(t("Saved. Q uses this from your next message or call."));
      setTimeout(() => setPhase("idle"), 1400);
    });
  };
  const remove = () => {
    setPhase("pending");
    setError(null);
    void removeMyGuideAction().then((result) => {
      if (!result.ok) {
        setPhase("idle");
        setError(t(result.message));
        return;
      }
      setMine(result.mine);
      setDraft(EMPTY_DRAFT);
      setPhase("idle");
      toast(t(`Removed. Q follows ${house} alone.`));
    });
  };
  return (
    <div className="py-3" data-my-guide>
      <RadioList
        name="guide"
        label={t("How Q speaks for you")}
        value={picked}
        onChange={setPicked}
        choices={[
          {
            key: "house",
            title: house,
            description: t(
              "Plain, courteous, short. Used for every message Q drafts for you.",
            ),
          },
          {
            key: "mine",
            title: t("Your guide"),
            description: t(
              "Your own words on tone, sign-off and what never to say. Q follows the house guide too; yours wins on style.",
            ),
          },
        ]}
      />
      {picked === "mine" ? (
        <div className="cq-crm-swap mt-3 flex flex-col gap-2.5">
          <GuideInput
            label={t("Your guide")}
            placeholder={GUIDE_PLACEHOLDER}
            maxCharacters={PERSONAL_ETIQUETTE_TEXT_MAX}
            draft={draft}
            onChange={setDraft}
            disabled={phase === "pending"}
          />
          {mine.guide === null ? null : (
            <span className="text-xs text-(--cq-text-tertiary)">
              {t(
                `Version ${String(mine.guide.version)}, saved ${new Date(mine.guide.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
              )}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={accountButton(
                phase === "done" ? "done" : "primary",
                "sm",
              )}
              disabled={phase !== "idle" || draft.text.trim().length === 0}
              aria-busy={phase === "pending"}
              onClick={save}
              data-guide-save
            >
              {phase === "pending" ? (
                <Pending>{t("Saving…")}</Pending>
              ) : phase === "done" ? (
                <>
                  <Check size={14} aria-hidden="true" />
                  {t("Saved")}
                </>
              ) : (
                t("Save guide")
              )}
            </button>
          </div>
        </div>
      ) : mine.guide !== null ? (
        <div className="cq-crm-swap mt-3 flex flex-wrap items-center gap-2 text-[13px] text-(--cq-text-secondary)">
          <span>
            {t(
              "You have your own guide. Remove it, and Q follows the house guide alone.",
            )}
          </span>
          <button
            type="button"
            className={accountButton("secondary", "sm")}
            disabled={phase !== "idle"}
            onClick={remove}
            data-guide-remove
          >
            {phase === "pending" ? (
              <Pending>{t("Removing…")}</Pending>
            ) : (
              t("Remove your guide")
            )}
          </button>
        </div>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="mt-2 text-[13px] text-(--cq-text-primary)">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------- Notifications ---------------- */

const PUSH_LINE: Readonly<Record<PushState, string>> = {
  ON: "Get a notification on this device when Q needs you.",
  OFF: "Get a notification on this device when Q needs you.",
  BLOCKED:
    "Notifications are blocked for Capital Q in this browser's settings.",
  NEEDS_INSTALL:
    "To get notifications on iPhone, add Capital Q to your Home Screen: tap Share, then Add to Home Screen, and open it from there.",
  UNSUPPORTED: "This browser can't show notifications.",
};

/** A push on this device, and email for what needs them (AUTO §3.5). */
export function NotificationRows() {
  const t = useT();
  const toast = useAccountToast();
  const [state, setState] = useState<PushState | null>(null);
  const [settings, setSettings] = useState<NotificationSettingsDto | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    void pushState().then((next) => {
      if (live) setState(next);
    });
    void noticeSettingsAction().then((result) => {
      if (live && result.ok) setSettings(result.value);
    });
    return () => {
      live = false;
    };
  }, []);
  const canSwitch =
    (state === "ON" || state === "OFF") && settings?.pushAvailable !== false;
  return (
    <>
      <SRow
        title={t("This device")}
        description={t(
          state === null ? "Checking this device." : PUSH_LINE[state],
        )}
      >
        <WordSwitch
          on={state === "ON"}
          disabled={!canSwitch || pending}
          label={t("Notifications on this device")}
          onWord={t("On")}
          offWord={t("Off")}
          data-push-toggle
          onChange={(next) =>
            startTransition(async () => {
              if (next) {
                const result = await enablePush();
                if (!result.ok && result.message !== null) {
                  toast(t(result.message));
                }
              } else {
                await disablePush();
              }
              const now = await pushState();
              setState(now);
              toast(
                now === "ON"
                  ? t("Notifications are on for this device.")
                  : t("Notifications are off for this device."),
              );
            })
          }
        />
      </SRow>
      <SRow
        title={t("Email me what needs me")}
        description={t("If I haven’t seen it in 10 minutes.")}
      >
        <WordSwitch
          on={settings?.email === true}
          disabled={settings === null || pending}
          label={t("Email me what needs me")}
          onWord={t("On")}
          offWord={t("Off")}
          data-email-toggle
          onChange={(email) =>
            startTransition(async () => {
              if (settings === null) return;
              const saved = await saveNoticeSettingsAction({
                push: settings.push,
                email,
              });
              if (saved.ok) setSettings(saved.value);
              else toast(t(saved.message));
            })
          }
        />
      </SRow>
    </>
  );
}

const DAILY_OPTIONS: readonly {
  readonly key: QDailyFrequency;
  readonly label: string;
}[] = [
  { key: "DAILY", label: "Every morning" },
  { key: "WEEKLY", label: "Every Monday" },
  { key: "OFF", label: "Off" },
];

const SECTION: Readonly<Record<QDailyOptionalSection, string>> = {
  YOUR_SECTOR: "Your sector",
  YOUR_MARKET: "Your market",
  DEALS: "Deals and rounds",
  PEOPLE: "People you know",
  Q_TAKE: "Q's take",
};

/**
 * The Q Daily (DAILY spec §3): how often, whether each edition is emailed,
 * and which sections it carries. Each change saves at once; a failed save
 * puts the earlier choice back and says so.
 */
export function DailyRows({
  initial,
}: {
  readonly initial: QDailyPreferences | null;
}) {
  const t = useT();
  const toast = useAccountToast();
  const [preferences, setPreferences] = useState(initial);
  const [pending, startTransition] = useTransition();
  if (preferences === null) {
    return (
      <SRow
        title={t("The Q Daily")}
        description={t("These choices couldn't load. Reload in a moment.")}
      />
    );
  }
  const save = (
    next: QDailyPreferences,
    patch: Parameters<typeof setDailyPreferencesAction>[0],
  ) => {
    const before = preferences;
    setPreferences(next);
    startTransition(async () => {
      const result = await setDailyPreferencesAction(patch);
      if (result.ok) setPreferences(result.preferences);
      else {
        setPreferences(before);
        toast(t(result.message));
      }
    });
  };
  const off = preferences.frequency === "OFF";
  return (
    <>
      <SRow title={t("The Q Daily")} description={t("How often")}>
        <Segments
          label={t("How often")}
          value={preferences.frequency}
          disabled={pending}
          options={DAILY_OPTIONS.map((option) => ({
            key: option.key,
            label: t(option.label),
          }))}
          onChange={(frequency) =>
            save({ ...preferences, frequency }, { frequency })
          }
          data-daily-setting
        />
      </SRow>
      <SRow title={t("Email me each edition")}>
        <WordSwitch
          on={preferences.email && !off}
          disabled={pending || off}
          label={t("Email me each edition")}
          onWord={t("On")}
          offWord={t("Off")}
          onChange={(email) => save({ ...preferences, email }, { email })}
        />
      </SRow>
      {off ? null : (
        <SRow
          title={t("Sections")}
          description={t("The lead story is always included.")}
        >
          <div className="flex max-w-[22rem] flex-wrap justify-end gap-1.5">
            {Q_DAILY_OPTIONAL_SECTIONS.map((section) => {
              const on = preferences.sections.includes(section);
              return (
                <button
                  key={section}
                  type="button"
                  aria-pressed={on}
                  disabled={pending}
                  onClick={() => {
                    const sections = on
                      ? preferences.sections.filter((code) => code !== section)
                      : Q_DAILY_OPTIONAL_SECTIONS.filter(
                          (code) =>
                            code === section ||
                            preferences.sections.includes(code),
                        );
                    save({ ...preferences, sections }, { sections });
                  }}
                  className={cx(
                    "inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors duration-(--cq-motion-fast) lg:min-h-[30px]",
                    on
                      ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-text-inverse)"
                      : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
                  )}
                >
                  {t(SECTION[section])}
                </button>
              );
            })}
          </div>
        </SRow>
      )}
    </>
  );
}

/* ---------------- Connections ---------------- */

/**
 * Google (BIZ-007): connected, with Disconnect, or not, with Connect. A
 * connection Google ended says so, with Reconnect; the reconnect link from
 * Q or a notice (`reconnect`) starts the reconnect itself.
 */
export function GoogleRow({
  outcome,
  reconnect = false,
}: {
  readonly outcome?: string | undefined;
  readonly reconnect?: boolean | undefined;
}) {
  const t = useT();
  const toast = useAccountToast();
  const [connection, setConnection] = useState<GoogleConnectionDto | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(
    outcome === "denied"
      ? "Gmail wasn't connected: mail access wasn't granted."
      : outcome === "failed"
        ? "Gmail couldn't be connected. Try again."
        : null,
  );
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    void readGmailConnection().then((result) => {
      if (result.ok) setConnection(result.value);
      else setMessage(result.message);
    });
  }, []);
  const connect = () =>
    startTransition(async () => {
      const result = await connectGmail();
      if (result.ok) window.location.assign(result.value);
      else setMessage(result.message);
    });
  const started = useRef(false);
  useEffect(() => {
    if (
      !reconnect ||
      started.current ||
      outcome !== undefined ||
      connection === null ||
      (connection.status !== "REVOKED" && connection.status !== "NOT_CONNECTED")
    ) {
      return;
    }
    started.current = true;
    connect();
    // `connect` is stable in effect: it only starts a transition.
  }, [reconnect, outcome, connection]);
  const disconnect = () =>
    startTransition(async () => {
      const result = await disconnectGmail();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setConnection({ status: "NOT_CONNECTED" });
      setMessage(null);
      toast(t("Gmail is disconnected, and Capital Q no longer holds access."));
    });
  return (
    <SRow
      title={t("Google")}
      description={
        <>
          {connection?.status === "CONNECTED"
            ? t(
                `Calendar and Gmail, as ${connection.email}. Capital Q reads only what Q needs for the work you approve.`,
              )
            : connection?.status === "REVOKED"
              ? t(
                  "Disconnected by Google. Calendar, email and Meet links are paused until you reconnect.",
                )
              : t(
                  "Calendar and Gmail. Capital Q reads only what Q needs for the work you approve.",
                )}
          {message === null ? null : (
            <span role="status" className="mt-1 block">
              {t(message)}
            </span>
          )}
        </>
      }
    >
      <span
        data-gmail-connection={connection?.status ?? "LOADING"}
        className="contents"
      >
        {connection === null ? (
          <span className="text-[13px] text-(--cq-text-tertiary)">
            {t("Checking…")}
          </span>
        ) : connection.status === "UNAVAILABLE" ? (
          <Tag tone="stone">{t("Not available yet")}</Tag>
        ) : connection.status === "CONNECTED" ? (
          <>
            <Tag tone="positive" icon={<Check aria-hidden="true" />}>
              {t("Connected")}
            </Tag>
            <button
              type="button"
              className={accountButton("secondary", "sm")}
              disabled={pending}
              onClick={disconnect}
            >
              {t("Disconnect")}
            </button>
          </>
        ) : (
          <>
            <Tag tone="stone">{t("Not connected")}</Tag>
            <button
              type="button"
              className={accountButton("primary", "sm")}
              disabled={pending}
              onClick={connect}
            >
              {connection.status === "REVOKED"
                ? t("Reconnect Google")
                : t("Connect Google")}
            </button>
          </>
        )}
      </span>
    </SRow>
  );
}

/**
 * "Your Q email address" (inbound email): the address, and a new one when
 * the old has spread too far. A new address stops the old one at once, so
 * a sheet asks first.
 */
export function QEmailRow() {
  const t = useT();
  const toast = useAccountToast();
  const [address, setAddress] = useState<InboundEmailAddressDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    void readQEmailAddress().then((result) => {
      if (result.ok) setAddress(result.value);
      else setMessage(result.message);
    });
  }, []);
  const rotate = (current: string) =>
    startTransition(async () => {
      const result = await rotateQEmailAddress(current);
      setConfirming(false);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setAddress(result.value);
      toast(t("New address ready. The old one no longer receives email."));
    });
  return (
    <SRow
      title={t("Your Q email address")}
      description={
        <>
          {address?.status === "UNAVAILABLE"
            ? t("Receiving email isn't available yet.")
            : t(
                "Email sent here reaches Q for you. Q tells you, and replies only when you approve.",
              )}
          {message === null ? null : (
            <span role="status" className="mt-1 block">
              {t(message)}
            </span>
          )}
        </>
      }
    >
      {address === null ? (
        <span className="text-[13px] text-(--cq-text-tertiary)">
          {t("Checking…")}
        </span>
      ) : address.status === "UNAVAILABLE" ? null : (
        <>
          <span
            className="max-w-80 rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) px-3 py-2 text-sm break-all text-(--cq-text-primary)"
            data-q-email-address={address.status}
          >
            {address.address}
          </span>
          <button
            type="button"
            className={accountButton("quiet", "sm")}
            onClick={() => setConfirming(true)}
            data-q-email-new
          >
            {t("Get a new address")}
          </button>
          <CrmSheet
            open={confirming}
            onOpenChange={setConfirming}
            title={t("Get a new address?")}
            sub={t("Your Q email address")}
          >
            <p className="m-0 text-[15px] text-(--cq-text-primary)">
              {t("Anyone with the old address won't reach you any more.")}
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                className={accountButton("secondary")}
                onClick={() => setConfirming(false)}
              >
                {t("Keep this one")}
              </button>
              <button
                type="button"
                className={accountButton("primary")}
                disabled={pending}
                aria-busy={pending}
                onClick={() => rotate(address.address)}
              >
                {pending ? (
                  <Pending>{t("Getting a new address…")}</Pending>
                ) : (
                  t("Get a new address")
                )}
              </button>
            </div>
          </CrmSheet>
        </>
      )}
    </SRow>
  );
}
