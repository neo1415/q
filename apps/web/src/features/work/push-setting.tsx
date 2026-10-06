"use client";

import { useEffect, useState, useTransition } from "react";

import type { NotificationSettingsDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { disablePush, enablePush, pushState, type PushState } from "./push";
import { noticeSettingsAction, saveNoticeSettingsAction } from "./work-actions";

/**
 * How Q reaches the person beyond the app (AUTO; spec auto.md §3.5): a
 * push on this device and email for what needs them. The browser's
 * permission prompt only ever follows their own tap on "Turn on pushes";
 * on an iPhone in a Safari tab they are told how to add Capital Q to the
 * Home Screen first, because that is the only way iOS allows pushes.
 */
export function PushSetting({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const [state, setState] = useState<PushState | null>(null);
  const [settings, setSettings] = useState<NotificationSettingsDto | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
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

  const turnOn = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await enablePush();
      setState(await pushState());
      if (!result.ok && result.message !== null) setMessage(result.message);
    });
  const turnOff = () =>
    startTransition(async () => {
      setMessage(null);
      await disablePush();
      setState(await pushState());
    });
  const setEmail = (email: boolean) =>
    startTransition(async () => {
      if (settings === null) return;
      const saved = await saveNoticeSettingsAction({
        push: settings.push,
        email,
      });
      if (saved.ok) setSettings(saved.value);
      else setMessage(saved.message);
    });

  const pushLine =
    state === null
      ? "Checking this device."
      : state === "ON"
        ? "Notifications are on for this device."
        : state === "OFF"
          ? "Get a notification on this device when Q needs you."
          : state === "BLOCKED"
            ? "Notifications are blocked for Capital Q in this browser's settings."
            : state === "NEEDS_INSTALL"
              ? "To get notifications on iPhone, add Capital Q to your Home Screen: tap Share, then Add to Home Screen, and open it from there."
              : "This browser can't show notifications.";

  return (
    <div className="flex flex-col gap-3" data-push-setting>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="cq-body-sm text-(--cq-text-secondary)" aria-live="polite">
          {pushLine}
        </p>
        {state === "OFF" && settings?.pushAvailable !== false ? (
          <Button
            variant="secondary"
            size="compact"
            disabled={pending}
            onClick={turnOn}
          >
            Turn on notifications
          </Button>
        ) : null}
        {state === "ON" ? (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={turnOff}
          >
            Turn off
          </Button>
        ) : null}
      </div>
      {compact || settings === null ? null : (
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="cq-body-sm text-(--cq-text-primary)">
            Email me what needs me if I haven&rsquo;t seen it in 10 minutes
          </span>
          <input
            type="checkbox"
            className="size-5 accent-(--cq-accent)"
            checked={settings.email}
            disabled={pending}
            onChange={(event) => setEmail(event.currentTarget.checked)}
          />
        </label>
      )}
      {message === null ? null : (
        <p className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
