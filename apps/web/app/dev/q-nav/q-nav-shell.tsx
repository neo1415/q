"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { GlobalQProvider } from "@/components/app-shell/global-q";
import { NO_SUBJECT } from "@/features/q/q-subject";
import { useQSession } from "@/features/q/q-session";
import { VoiceInterviewSource } from "@/features/voice/use-voice-interview";

import { DEV_VOICE_LINE_EVENT, useScriptedVoice } from "./scripted-voice";

/**
 * The app's own Q store (GlobalQProvider: one conversation, one voice
 * line) in a layout that stays while pages change, as the signed-in
 * layout does, with a scripted line in place of a provider. The strip at
 * the top reads the store from every page: the line, its captions and the
 * conversation they belong to.
 */

function Strip() {
  const session = useQSession();
  return (
    <div
      className="flex flex-col gap-2 border-b border-(--cq-border) p-3"
      data-harness-strip
    >
      <nav aria-label="Harness pages" className="flex gap-3">
        <Link href="/dev/q-nav" data-harness-link="q">
          Q page
        </Link>
        <Link href="/dev/q-nav/work" data-harness-link="work">
          Work page
        </Link>
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-h-11 px-3"
          onClick={() => void session.talk()}
          data-harness-talk
        >
          Talk
        </button>
        <button
          type="button"
          className="min-h-11 px-3"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(DEV_VOICE_LINE_EVENT, {
                detail: { role: "q", text: "Three things need you today." },
              }),
            )
          }
          data-harness-q-says
        >
          Q says a line
        </button>
        <span data-harness-voice-active={session.voice.active ? "on" : "off"}>
          {session.voice.active ? "Line open" : "No line"}
        </span>
        <span data-harness-conversation>{session.q.conversationId ?? ""}</span>
      </div>
      <ol aria-label="Captions" data-harness-captions>
        {session.spoken.map((line) => (
          <li key={line.id}>{line.text}</li>
        ))}
      </ol>
    </div>
  );
}

export function QNavShell({ children }: { readonly children: ReactNode }) {
  return (
    <VoiceInterviewSource.Provider value={useScriptedVoice}>
      <GlobalQProvider subject={NO_SUBJECT} connected={false}>
        <div className="flex min-h-dvh flex-col bg-(--cq-canvas)">
          <Strip />
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </div>
      </GlobalQProvider>
    </VoiceInterviewSource.Provider>
  );
}
