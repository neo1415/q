"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { ChatMessageDto, ChatThreadDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { FileText, ICON_SIZE, Play, Upload } from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QAperture } from "@/features/q-aperture";
import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "@/features/onboarding-kit/material-actions";
import { formatRelationshipDate } from "@/features/relationships/relationship-words";

import {
  chatAttachmentAction,
  chatThreadAction,
  markChatReadAction,
  sendChatMessageAction,
  shareableDocumentsAction,
  unsendChatMessageAction,
} from "./chat-actions";
import { VoiceRecorder } from "./voice-recorder";

/**
 * The 1:1 chat on one relationship (R34; ADR 0019).
 *
 * The thread is the server's: this component polls its cursor while the
 * page is visible and merges what changed (a new message, an unsend). Q is
 * present but silent: it acts only when the person presses Ask Q or starts
 * a message with "@Q", and then it opens beside the page with that
 * question -- the chat line is never sent to the other side, and nothing
 * from the thread reaches Q unless the person asks. Files go straight from
 * the browser to private storage through the document pipeline and are
 * shared once they have been checked.
 */

const POLL_MS = 3000;
const CHECK_RETRIES = 15;
const Q_PREFIX = /^@q\b[\s,:]*/i;

type Status = ChatThreadDto["status"];

function merge(
  current: readonly ChatMessageDto[],
  changes: readonly ChatMessageDto[],
): ChatMessageDto[] {
  const byId = new Map(current.map((message) => [message.messageId, message]));
  for (const change of changes) byId.set(change.messageId, change);
  return [...byId.values()].sort(
    (a, b) =>
      a.sentAt.localeCompare(b.sentAt) ||
      a.messageId.localeCompare(b.messageId),
  );
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function RelationshipChat({
  relationshipId,
  counterpart,
  initial,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly initial: ChatThreadDto | null;
}) {
  const { askAbout } = useGlobalQ();
  const [messages, setMessages] = useState<ChatMessageDto[]>(
    () => initial?.messages.slice() ?? [],
  );
  const [status, setStatus] = useState<Status>(initial?.status ?? "OPEN");
  const [seenId, setSeenId] = useState<string | null>(
    initial?.counterpartLastReadMessageId ?? null,
  );
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(
    initial === null ? "Messages couldn't load just now." : null,
  );
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<{
    readonly messageId: string;
    readonly url: string;
  } | null>(null);
  const [documents, setDocuments] = useState<
    readonly { id: string; name: string; ready: boolean }[] | null
  >(null);
  const cursor = useRef<string | null>(initial?.cursor ?? null);
  const readUpTo = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLLIElement>(null);

  const markRead = useCallback(
    (list: readonly ChatMessageDto[]) => {
      const last = [...list].reverse().find((message) => !message.mine);
      if (last === undefined || last.messageId === readUpTo.current) return;
      readUpTo.current = last.messageId;
      void markChatReadAction(relationshipId, last.messageId);
    },
    [relationshipId],
  );

  const poll = useCallback(async () => {
    const result = await chatThreadAction(relationshipId, cursor.current);
    if (!result.ok) return;
    const thread = result.value;
    setStatus(thread.status);
    setSeenId(thread.counterpartLastReadMessageId);
    cursor.current = thread.cursor;
    if (thread.messages.length > 0) {
      setMessages((current) => {
        const next = merge(current, thread.messages);
        markRead(next);
        return next;
      });
    }
  }, [relationshipId, markRead]);

  // Poll while the page is visible; stop when it is hidden or unmounted.
  useEffect(() => {
    markRead(messages);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await poll();
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // messages is read once for the initial read marker only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const deliver = async (
    message:
      | { kind: "TEXT"; body: string }
      | { kind: "ATTACHMENT"; documentId: string; body?: string }
      | { kind: "VOICE_NOTE"; documentId: string; durationMs: number },
  ): Promise<boolean> => {
    const key = newKey();
    for (let attempt = 0; attempt <= CHECK_RETRIES; attempt += 1) {
      const result = await sendChatMessageAction(relationshipId, message, key);
      if (result.ok) {
        setMessages((current) => merge(current, [result.value]));
        setNotice(null);
        return true;
      }
      if (result.kind === "NOT_READY" && attempt < CHECK_RETRIES) {
        setNotice("Checking the file before it's shared…");
        await wait(4000);
        continue;
      }
      if (result.kind === "CLOSED") setStatus("NOT_CONNECTED");
      setNotice(result.message);
      return false;
    }
    return false;
  };

  const invokeQ = (question: string) => {
    askAbout(
      question.length > 0
        ? question
        : `Summarise my chat with ${counterpart}: what's outstanding, and what should I say next?`,
    );
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    // "@Q …" is for Q, never for the other side.
    if (Q_PREFIX.test(text)) {
      invokeQ(text.replace(Q_PREFIX, "").trim());
      setDraft("");
      return;
    }
    setBusy(true);
    if (await deliver({ kind: "TEXT", body: text })) setDraft("");
    setBusy(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  /** Browser → private storage through the document pipeline; the new document id. */
  const uploadToStorage = async (file: File): Promise<string | null> => {
    const target = await materialUploadTargetAction({
      documentType: "UNCLASSIFIED",
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    if (!target.ok) {
      setNotice(target.message);
      return null;
    }
    // Bytes go from the browser to private storage, never through us.
    const put = await fetch(target.value.url, {
      method: target.value.method,
      headers: target.value.headers,
      body: file,
    });
    if (!put.ok) {
      setNotice("That file didn't upload. Please try again.");
      return null;
    }
    const done = await materialUploadCompleteAction(
      target.value.uploadSessionId,
    );
    if (!done.ok) {
      setNotice(done.message);
      return null;
    }
    return done.value.documentId;
  };

  const sendVoiceNote = async (file: File, durationMs: number) => {
    setBusy(true);
    setNotice("Sending your voice note…");
    try {
      const documentId = await uploadToStorage(file);
      if (documentId !== null) {
        await deliver({ kind: "VOICE_NOTE", documentId, durationMs });
      }
    } catch {
      setNotice("That voice note didn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (message: ChatMessageDto) => {
    const result = await chatAttachmentAction(
      relationshipId,
      message.messageId,
    );
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    if (message.kind === "VOICE_NOTE") {
      setPlaying({ messageId: message.messageId, url: result.value.url });
    } else {
      // A one-minute signed read, straight from storage, in a new tab.
      window.open(result.value.url, "_blank", "noopener,noreferrer");
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setNotice("Uploading…");
    try {
      const documentId = await uploadToStorage(file);
      if (documentId === null) return;
      const caption = draft.trim();
      const sent = await deliver({
        kind: "ATTACHMENT",
        documentId,
        ...(caption.length > 0 && !Q_PREFIX.test(caption)
          ? { body: caption }
          : {}),
      });
      if (sent && caption.length > 0) setDraft("");
    } catch {
      setNotice("That file didn't upload. Please try again.");
    } finally {
      setBusy(false);
      if (fileInput.current !== null) fileInput.current.value = "";
    }
  };

  const openDocuments = async () => {
    if (documents !== null) {
      setDocuments(null);
      return;
    }
    const result = await shareableDocumentsAction();
    if (result.ok) setDocuments(result.value);
    else setNotice(result.message);
  };

  const share = async (documentId: string) => {
    setDocuments(null);
    setBusy(true);
    await deliver({ kind: "ATTACHMENT", documentId });
    setBusy(false);
  };

  const unsend = async (messageId: string) => {
    const result = await unsendChatMessageAction(relationshipId, messageId);
    if (result.ok) await poll();
    else setNotice(result.message);
  };

  const lastMine = [...messages]
    .reverse()
    .find((message) => message.mine && !message.unsent);
  const seenIndex =
    seenId === null ? -1 : messages.findIndex((m) => m.messageId === seenId);
  const lastMineIndex =
    lastMine === undefined ? -1 : messages.indexOf(lastMine);

  return (
    <section
      aria-labelledby="relationship-chat"
      className="flex max-w-(--cq-layout-reading) flex-col gap-3"
      data-relationship-chat={status}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="relationship-chat"
          className="cq-title-sm text-(--cq-text-primary)"
        >
          Messages
        </h2>
        <Button
          variant="quiet"
          onClick={() => invokeQ(draft.replace(Q_PREFIX, "").trim())}
        >
          <QAperture state="IDLE" size="chrome" />
          Ask Q
        </Button>
      </div>

      {messages.length === 0 ? (
        <p className="cq-body text-(--cq-text-secondary)">
          {status === "OPEN"
            ? `No messages yet. Say hello to ${counterpart}.`
            : "Messages open once you're connected: when interest has been expressed and accepted."}
        </p>
      ) : (
        <ol
          role="log"
          aria-live="polite"
          aria-label={`Messages with ${counterpart}`}
          className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-md border border-(--cq-border-subtle) p-3"
        >
          {messages.map((message, index) => (
            <li
              key={message.messageId}
              className={`flex max-w-[85%] flex-col gap-1 ${message.mine ? "items-end self-end" : "items-start self-start"}`}
              data-chat-message={message.mine ? "mine" : "theirs"}
            >
              <span className="cq-caption text-(--cq-text-tertiary)">
                {message.mine ? "You" : message.senderName}
                {" · "}
                <time dateTime={message.sentAt} className="cq-numeric">
                  {formatRelationshipDate(message.sentAt)}
                </time>
                {message.viaQ ? " · approved from Q" : null}
              </span>
              <div
                className={`rounded-md px-3 py-2 ${
                  message.mine
                    ? "bg-(--cq-accent-soft) text-(--cq-text-primary)"
                    : "bg-(--cq-surface-subtle) text-(--cq-text-primary)"
                }`}
              >
                {message.unsent ? (
                  <p className="cq-body-sm italic text-(--cq-text-secondary)">
                    {message.mine
                      ? "You unsent this message."
                      : "This message was unsent."}
                  </p>
                ) : (
                  <>
                    {message.attachment === null ? null : message.kind ===
                      "VOICE_NOTE" ? (
                      playing?.messageId === message.messageId ? (
                        // The signed URL lasts a minute; the element has
                        // already fetched the bytes by then.
                        <audio
                          controls
                          autoPlay
                          src={playing.url}
                          className="max-w-full"
                          aria-label={`Voice note from ${message.mine ? "you" : message.senderName}`}
                        />
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => void openAttachment(message)}
                        >
                          <Play size={ICON_SIZE.regular} aria-hidden="true" />
                          Play voice note
                          {message.voiceDurationMs === null ? null : (
                            <span className="cq-numeric text-(--cq-text-secondary)">
                              {formatDuration(message.voiceDurationMs)}
                            </span>
                          )}
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="quiet"
                        className="-mx-2 max-w-full justify-start"
                        onClick={() => void openAttachment(message)}
                        aria-label={`Open ${message.attachment.title}`}
                      >
                        <FileText size={ICON_SIZE.regular} aria-hidden="true" />
                        <span className="truncate">
                          {message.attachment.title}
                        </span>
                      </Button>
                    )}
                    {message.body === null ? null : (
                      <p className="cq-body whitespace-pre-wrap break-words">
                        {message.body}
                      </p>
                    )}
                  </>
                )}
              </div>
              <span className="flex items-center gap-2">
                {message.edited && !message.unsent ? (
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    Edited
                  </span>
                ) : null}
                {index === lastMineIndex && seenIndex >= lastMineIndex ? (
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    Seen
                  </span>
                ) : null}
                {message.mine && !message.unsent ? (
                  <Button
                    variant="quiet"
                    size="compact"
                    className="min-h-11"
                    onClick={() => void unsend(message.messageId)}
                  >
                    Unsend
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
          <li ref={end} aria-hidden="true" />
        </ol>
      )}

      {notice === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {notice}
        </p>
      )}

      {status === "OPEN" ? (
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-2"
        >
          <label htmlFor="chat-draft" className="sr-only">
            Message {counterpart}
          </label>
          <textarea
            id="chat-draft"
            value={draft}
            maxLength={4000}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message ${counterpart}, or @Q to ask Q`}
            className="cq-body min-h-11 w-full resize-y rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 py-2 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary)"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || draft.trim().length === 0}
            >
              Send
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={ICON_SIZE.regular} aria-hidden="true" />
              Attach a file
            </Button>
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => void openDocuments()}
              aria-expanded={documents !== null}
            >
              <FileText size={ICON_SIZE.regular} aria-hidden="true" />
              Share a document
            </Button>
            <VoiceRecorder
              disabled={busy}
              onRecorded={(file, durationMs) =>
                void sendVoiceNote(file, durationMs)
              }
              onError={setNotice}
            />
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              accept=".pdf,.pptx,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void upload(file);
              }}
            />
          </div>
          {documents === null ? null : documents.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              You haven&apos;t uploaded any documents yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Your documents">
              {documents.map((document) => (
                <li key={document.id}>
                  <Button
                    type="button"
                    variant="quiet"
                    className="w-full justify-start"
                    disabled={!document.ready || busy}
                    onClick={() => void share(document.id)}
                  >
                    <FileText size={ICON_SIZE.regular} aria-hidden="true" />
                    <span className="truncate">{document.name}</span>
                    {document.ready ? null : (
                      <span className="cq-caption text-(--cq-text-tertiary)">
                        Still being checked
                      </span>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </form>
      ) : null}
    </section>
  );
}
