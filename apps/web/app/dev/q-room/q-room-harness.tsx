"use client";

import "@/features/q/answer-canvas.css";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createQStreamState } from "@capital-q/api-client";
import {
  QConversationDetailSchema,
  type QConversationDetail,
  type QMessage,
  type QShowInQRoomIntent,
} from "@capital-q/contracts";

import { QAperture } from "@/features/q-aperture";
import { turnsFrom } from "@/features/q/conversation";
import { QCanSee } from "@/features/q/q-can-see";
import { QPresenceStage } from "@/features/q/q-presence-stage";
import { QSection, useQDialog } from "@/features/q/q-section";
import type { RoomCardResult } from "@/features/q/room/room-actions";
import { currentScreen } from "@/features/q/screen";

const RECORD = "/dev/q-room/record";
const CARD = "/dev/q-room/card";

async function fetchRecord(): Promise<QConversationDetail | null> {
  try {
    const response = await fetch(RECORD, { cache: "no-store" });
    if (!response.ok) return null;
    const detail = QConversationDetailSchema.safeParse(await response.json());
    return detail.success ? detail.data : null;
  } catch {
    return null;
  }
}

/** The card's content as the test serves it, in place of the server read. */
async function loadCard(intent: QShowInQRoomIntent): Promise<RoomCardResult> {
  const response = await fetch(
    `${CARD}?object=${intent.object}&id=${intent.id ?? ""}`,
    { cache: "no-store" },
  );
  return (await response.json()) as RoomCardResult;
}

const PREVIEW_ID = "00000000-0000-4000-8000-000000000002";

/**
 * The Q page's stage over a recorded conversation, beside a page part that
 * publishes its manifest (two sections and a modal), so a test can read
 * exactly what would travel to Q (`data-harness-wire`).
 */
export function QRoomHarness() {
  const [messages, setMessages] = useState<readonly QMessage[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [wire, setWire] = useState("");
  const read = useCallback(async () => {
    const detail = await fetchRecord();
    if (detail !== null) setMessages(detail.messages);
  }, []);
  // The conversation is read once as the page opens.
  useEffect(() => {
    let live = true;
    void fetchRecord().then((detail) => {
      if (live && detail !== null) setMessages(detail.messages);
    });
    return () => {
      live = false;
    };
  }, []);
  useQDialog(
    previewOpen,
    "preview",
    "COMPANY_PREVIEW",
    [{ kind: "COMPANY", id: PREVIEW_ID }],
    "Clearwater preview",
  );
  const turns = useMemo(
    () => turnsFrom({ ...createQStreamState(), messages: [...messages] }, []),
    [messages],
  );

  return (
    <div className="min-h-dvh bg-(--cq-canvas) text-(--cq-text-primary)">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" className="cq-ac-btn" onClick={() => void read()}>
          Next answer
        </button>
        <button
          type="button"
          className="cq-ac-btn"
          onClick={() => setPreviewOpen((open) => !open)}
        >
          {previewOpen ? "Close preview" : "Open preview"}
        </button>
        <button
          type="button"
          className="cq-ac-btn"
          onClick={() => setWire(JSON.stringify(currentScreen("/home")))}
        >
          Read wire
        </button>
        <QCanSee />
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-4">
        <QPresenceStage
          turns={turns}
          captions={false}
          caption={null}
          loadRoomCard={loadCard}
          presence={(compact, mini) => (
            <QAperture
              state="IDLE"
              size={mini === true ? 44 : compact ? 64 : 200}
              face
              showing={compact}
            />
          )}
        />
        <QSection
          id="approvals"
          kind="APPROVAL_LIST"
          refs={[]}
          total={2}
          label="2 waiting approvals"
        >
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Two changes wait for you.
          </p>
        </QSection>
        <pre
          className="cq-caption break-all whitespace-pre-wrap"
          data-harness-wire
        >
          {wire}
        </pre>
      </main>
      {previewOpen ? (
        <div
          role="dialog"
          aria-label="Clearwater preview"
          className="fixed inset-x-4 bottom-4 rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface-raised) p-4"
        >
          Clearwater Pay: a seed round.
        </div>
      ) : null}
    </div>
  );
}
