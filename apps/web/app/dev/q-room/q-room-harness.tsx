"use client";

import "@/features/q/answer-canvas.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createQStreamState } from "@capital-q/api-client";
import {
  QConversationDetailSchema,
  type QArtifactSummary,
  type QConversationDetail,
  type QMessage,
  type QShowInQRoomIntent,
} from "@capital-q/contracts";

import type {
  MaterialResult,
  OpenedFile,
} from "@/features/company/material/material-actions";
import type { DocumentActionResult } from "@/features/documents/actions";
import { QAperture } from "@/features/q-aperture";
import { QEdgeFlow } from "@/features/q-swarm/q-edge-flow";
import { performClientAction } from "@/features/q/client-actions";
import { turnsFrom } from "@/features/q/conversation";
import { QMaterialViewer } from "@/features/q/material-viewer";
import { QCanSee } from "@/features/q/q-can-see";
import { QPresenceStage } from "@/features/q/q-presence-stage";
import { QSection, useQDialog } from "@/features/q/q-section";
import type { RoomCardResult } from "@/features/q/room/room-actions";
import type { DeckState, FillResult } from "@/features/q/room/deck-actions";
import { deckDrawingOf } from "@/features/q/room/deck-room";
import type { DeckLoaders } from "@/features/q/room/q-room-deck";
import { currentScreen } from "@/features/q/screen";

const RECORD = "/dev/q-room/record";
const CARD = "/dev/q-room/card";
const DOCUMENT = "/dev/q-room/document";
const EXPORT = "/dev/q-room/export";

/** Q room W3: the data room's signed read, as the test serves it. */
async function openFile(
  companyId: string,
  documentId: string,
): Promise<MaterialResult<OpenedFile>> {
  const response = await fetch(
    `${DOCUMENT}?company=${companyId}&document=${documentId}`,
    { cache: "no-store" },
  );
  return (await response.json()) as MaterialResult<OpenedFile>;
}

/** Q room W3: an answer filed as a PDF, as the test serves it. */
async function exportAnswer(input: {
  readonly runId: string;
  readonly messageId: string;
}): Promise<DocumentActionResult<QArtifactSummary>> {
  const response = await fetch(EXPORT, {
    method: "POST",
    body: JSON.stringify(input),
    cache: "no-store",
  });
  return (await response.json()) as DocumentActionResult<QArtifactSummary>;
}

/** The screen follows each new answer's data-room open, as the Q page does. */
function follow(messages: readonly QMessage[], seen: Set<string>): void {
  for (const message of messages) {
    if (seen.has(message.messageId)) continue;
    seen.add(message.messageId);
    if (message.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (
        block.kind === "UI_INTENT" &&
        block.intent.kind === "OPEN_RECORD_PAGE" &&
        block.intent.page === "DATA_ROOM_DOCUMENT"
      ) {
        performClientAction(block.intent);
      }
    }
  }
}

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

/**
 * Q room W5: the deck surface's reads and writes, as the test serves them
 * (`/dev/q-room/deck`, `/dev/q-room/slides`, `/dev/q-room/upload`,
 * `/dev/q-room/fill`), in place of the Q API and the upload path.
 */
const DECK_LOADERS: DeckLoaders = {
  read: async (artifactId) => {
    const response = await fetch(`/dev/q-room/deck?id=${artifactId}`, {
      cache: "no-store",
    });
    return (await response.json()) as DeckState;
  },
  slides: async (artifactId, version) => {
    const response = await fetch(
      `/dev/q-room/slides?id=${artifactId}&version=${String(version)}`,
      { cache: "no-store" },
    );
    if (response.status === 409) return null;
    // As the real read: a failed read throws, so the room retries it.
    if (!response.ok) throw new Error("Slides read failed.");
    return deckDrawingOf(await response.json());
  },
  upload: async (file) => {
    const response = await fetch("/dev/q-room/upload", {
      method: "POST",
      body: JSON.stringify({ name: file.name, type: file.type }),
      cache: "no-store",
    });
    const body = (await response.json()) as { documentId: string | null };
    return body.documentId;
  },
  fill: async (input) => {
    const response = await fetch("/dev/q-room/fill", {
      method: "POST",
      body: JSON.stringify(input),
      cache: "no-store",
    });
    return (await response.json()) as FillResult;
  },
};

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
  // R9: Q "working", so the edge particles run while a test measures.
  const [working, setWorking] = useState(false);
  const seen = useRef(new Set<string>());
  const read = useCallback(async () => {
    const detail = await fetchRecord();
    if (detail !== null) {
      setMessages(detail.messages);
      // After the turns render, as the Q page's follow runs.
      window.setTimeout(() => follow(detail.messages, seen.current), 0);
    }
  }, []);
  // The conversation is read once as the page opens.
  useEffect(() => {
    let live = true;
    void fetchRecord().then((detail) => {
      if (live && detail !== null) {
        setMessages(detail.messages);
        for (const message of detail.messages) {
          seen.current.add(message.messageId);
        }
      }
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
        <button
          type="button"
          className="cq-ac-btn"
          aria-pressed={working}
          onClick={() => setWorking((on) => !on)}
          data-harness-working
        >
          Q working
        </button>
        <QCanSee />
      </header>
      <QEdgeFlow state={working ? "WORKING" : "IDLE"} />
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-4">
        <QPresenceStage
          turns={turns}
          captions={false}
          caption={null}
          loadRoomCard={loadCard}
          deckLoaders={DECK_LOADERS}
          exportAnswer={exportAnswer}
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
      <QMaterialViewer turns={turns} openFile={openFile} />
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
