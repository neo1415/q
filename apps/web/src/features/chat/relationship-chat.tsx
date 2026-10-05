"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { ChatMessageDto, ChatThreadDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  ArrowUp,
  FileText,
  ICON_SIZE,
  Play,
  Plus,
  Upload,
} from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { EntityAvatar } from "@/features/entity/entity-avatar";
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
import {
  ChatSafetyDialogs,
  ChatSafetyMenu,
  type ChatSafetyDialog,
} from "./chat-safety";
import { useFollowNewest } from "@/features/q/follow-newest";
import { useDockAvoid } from "@/features/q-dock/dock-avoid";

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
 *
 * Safety (doc 10): the options menu blocks or unblocks messages and reports
 * the conversation; each message from the other side can be reported. A
 * blocked thread keeps its history and shows no composer.
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
  // By time, not by the timestamp's text: "…:05.5Z" and "…:05.123Z" (or
  // an offset form) sort wrongly as strings.
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.sentAt) - Date.parse(b.sentAt) ||
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

function blockedNotice(byYourSide: boolean): string {
  return byYourSide
    ? "You blocked messages. Unblock from the options menu to send again."
    : "You can't message this relationship right now.";
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function RelationshipChat({
  relationshipId,
  counterpart,
  initial,
  tall = false,
  headerStart,
  headerEnd,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly initial: ChatThreadDto | null;
  /** The conversation page: the thread fills the column. */
  readonly tall?: boolean | undefined;
  /** Who the chat is with: back, avatar, name, state. */
  readonly headerStart?: ReactNode | undefined;
  /** The page's own header actions (call, info). */
  readonly headerEnd?: ReactNode | undefined;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const { askNow } = useGlobalQ();
  const [messages, setMessages] = useState<ChatMessageDto[]>(
    () => initial?.messages.slice() ?? [],
  );
  const [status, setStatus] = useState<Status>(initial?.status ?? "OPEN");
  const [blockedByYourSide, setBlockedByYourSide] = useState(
    initial?.blockedByYourSide ?? false,
  );
  const [safety, setSafety] = useState<ChatSafetyDialog | null>(null);
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
  // The composer is a control the Q dock must never cover (break-it sweep
  // 2026-10-03: at 390px the dock sat on Send).
  const composer = useRef<HTMLFormElement>(null);
  useDockAvoid(composer, status === "OPEN");
  const header = useRef<HTMLDivElement>(null);
  useDockAvoid(header);

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
    setBlockedByYourSide(thread.blockedByYourSide);
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

  // The newest message is followed while the reader is at the bottom;
  // reading earlier messages is not interrupted, and their own new
  // message always brings them down (founder report 2026-10-01).
  useFollowNewest(end, String(messages.length), messages.at(-1)?.mine === true);

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
      // Not connected, or blocked: the thread says which.
      if (result.kind === "CLOSED") void poll();
      setNotice(result.message);
      return false;
    }
    return false;
  };

  const invokeQ = (question: string) => {
    askNow(
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
      setNotice("That file didn't upload. Try again.");
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
      setNotice("That voice note didn't send. Try again.");
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
      setNotice("That file didn't upload. Try again.");
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

  // The caller's side, from their own messages; the other side's messages
  // are the ones that can be reported.
  const ownSide = messages.find((message) => message.mine)?.side ?? null;

  const lastMine = [...messages]
    .reverse()
    .find((message) => message.mine && !message.unsent);
  const seenIndex =
    seenId === null ? -1 : messages.findIndex((m) => m.messageId === seenId);
  const lastMineIndex =
    lastMine === undefined ? -1 : messages.indexOf(lastMine);

  const hasDraft = draft.trim().length > 0;
  return (
    <section
      aria-labelledby="relationship-chat"
      className={`flex min-h-0 flex-col ${tall ? "h-full" : "max-w-(--cq-layout-reading) gap-3"}`}
      data-relationship-chat={status}
    >
      {/* The header (founder direction 2026-09-29: "whatsapp for that
          page"): who, where things stand, and the few actions, in one row. */}
      <div
        ref={header}
        className="flex items-center gap-2 border-b border-(--cq-border-subtle) px-2 py-2"
      >
        <h2 id="relationship-chat" className="sr-only">
          Messages with {counterpart}
        </h2>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {headerStart}
        </div>
        {headerEnd}
        <button
          type="button"
          onClick={() => invokeQ(draft.replace(Q_PREFIX, "").trim())}
          aria-label="Ask Q"
          className="flex size-11 items-center justify-center rounded-full hover:bg-(--cq-surface-subtle)"
        >
          <QAperture state="IDLE" size="chrome" />
        </button>
        <ChatSafetyMenu
          blockedByYourSide={blockedByYourSide}
          onChoose={setSafety}
        />
      </div>
      <ChatSafetyDialogs
        relationshipId={relationshipId}
        counterpart={counterpart}
        dialog={safety}
        onClose={() => setSafety(null)}
        onDone={(done) => {
          setSafety(null);
          setNotice(done);
          void poll();
        }}
      />

      <ol
        role="log"
        aria-live="polite"
        aria-label={`Messages with ${counterpart}`}
        className={`flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-4 ${tall ? "" : "max-h-[60vh]"}`}
      >
        {messages.length === 0 ? (
          <li className="m-auto max-w-xs text-center">
            <p className="cq-body-sm rounded-xl bg-(--cq-surface-subtle) px-4 py-2 text-(--cq-text-secondary)">
              {status === "OPEN"
                ? `Say hello to ${counterpart}.`
                : status === "BLOCKED"
                  ? blockedNotice(blockedByYourSide)
                  : "Messages open once you're connected."}
            </p>
          </li>
        ) : null}
        {messages.map((message, index) => (
          <li
            key={message.messageId}
            className={`group flex max-w-[80%] min-w-0 flex-col gap-0.5 ${message.mine ? "items-end self-end" : "items-start self-start"}`}
            data-chat-message={message.mine ? "mine" : "theirs"}
          >
            {!message.mine &&
            (index === 0 ||
              messages[index - 1]?.mine === true ||
              messages[index - 1]?.senderName !== message.senderName) ? (
              // Who is speaking, once per run of their messages. A
              // person's photo is theirs alone today: initials here.
              <span className="flex items-center gap-1.5" data-chat-sender>
                <EntityAvatar
                  kind="person"
                  name={message.senderName}
                  size="xs"
                  decorative
                />
                <span className="cq-caption text-(--cq-text-secondary)">
                  {message.senderName}
                </span>
              </span>
            ) : null}
            <div
              className={`max-w-full min-w-0 rounded-2xl px-3 py-2 ${
                message.mine
                  ? "rounded-br-sm bg-(--cq-accent-soft) text-(--cq-text-primary)"
                  : "rounded-bl-sm bg-(--cq-surface-subtle) text-(--cq-text-primary)"
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
                        variant="quiet"
                        className="-mx-2"
                        onClick={() => void openAttachment(message)}
                      >
                        <Play size={ICON_SIZE.regular} aria-hidden="true" />
                        Voice note
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
                    // A long unbroken word or link wraps inside the bubble
                    // (break-it sweep 2026-10-03: it ran off the left edge).
                    <p className="cq-body whitespace-pre-wrap wrap-anywhere">
                      {message.body}
                    </p>
                  )}
                </>
              )}
              <span className="cq-caption flex justify-end gap-1.5 pt-0.5 text-(--cq-text-tertiary)">
                {/* AUTO (ADR 0030): every message Q sent is labelled as Q's. */}
                {message.viaQ ? (
                  <span>Sent by Q for {message.senderName}</span>
                ) : null}
                {message.edited && !message.unsent ? <span>Edited</span> : null}
                <time dateTime={message.sentAt} className="cq-numeric">
                  {formatRelationshipDate(message.sentAt)}
                </time>
                {index === lastMineIndex && seenIndex >= lastMineIndex ? (
                  <span aria-label="Seen">✓✓</span>
                ) : null}
              </span>
            </div>
            {/* Per-message actions out of the way until hovered or
                focused, as a chat app keeps them. */}
            <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {message.mine && !message.unsent ? (
                <Button
                  variant="quiet"
                  size="compact"
                  className="min-h-8"
                  onClick={() => void unsend(message.messageId)}
                >
                  Unsend
                </Button>
              ) : null}
              {!message.mine && !message.unsent && message.side !== ownSide ? (
                <Button
                  variant="quiet"
                  size="compact"
                  className="min-h-8"
                  aria-label={`Report message from ${message.senderName}`}
                  onClick={() =>
                    setSafety({
                      kind: "REPORT",
                      messageId: message.messageId,
                    })
                  }
                >
                  Report
                </Button>
              ) : null}
            </span>
          </li>
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>

      {notice === null ? null : (
        <p role="status" className="cq-body-sm px-3 text-(--cq-text-secondary)">
          {notice}
        </p>
      )}

      {status === "BLOCKED" && messages.length > 0 ? (
        <p className="cq-body-sm px-3 text-(--cq-text-secondary)">
          {blockedNotice(blockedByYourSide)}
        </p>
      ) : null}

      {status === "OPEN" ? (
        <form
          ref={composer}
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-2 border-t border-(--cq-border-subtle) px-2 py-2"
        >
          {documents === null ? null : documents.length === 0 ? (
            <p className="cq-body-sm px-2 text-(--cq-text-secondary)">
              No documents yet.
            </p>
          ) : (
            <ul
              className="flex max-h-48 flex-col gap-1 overflow-y-auto"
              aria-label="Your documents"
            >
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
          {attachOpen ? (
            <div className="flex gap-2 px-1" role="group" aria-label="Attach">
              <Button
                type="button"
                variant="secondary"
                size="compact"
                disabled={busy}
                onClick={() => {
                  setAttachOpen(false);
                  fileInput.current?.click();
                }}
              >
                <Upload size={ICON_SIZE.compact} aria-hidden="true" />
                File
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="compact"
                disabled={busy}
                onClick={() => {
                  setAttachOpen(false);
                  void openDocuments();
                }}
                aria-expanded={documents !== null}
              >
                <FileText size={ICON_SIZE.compact} aria-hidden="true" />
                Document
              </Button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <button
              type="button"
              aria-label="Attach"
              aria-expanded={attachOpen}
              onClick={() => setAttachOpen((open) => !open)}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle)"
            >
              <Plus size={ICON_SIZE.regular} aria-hidden="true" />
            </button>
            <label htmlFor="chat-draft" className="sr-only">
              Message {counterpart}
            </label>
            <textarea
              id="chat-draft"
              value={draft}
              maxLength={4000}
              rows={1}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message"
              className="cq-body field-sizing-content max-h-40 min-h-11 flex-1 resize-none rounded-3xl border border-(--cq-border-subtle) bg-(--cq-surface) px-4 py-2.5 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary)"
            />
            {hasDraft ? (
              <button
                type="submit"
                disabled={busy}
                aria-label="Send"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--cq-accent) text-(--cq-text-inverse) hover:bg-(--cq-accent-hover) disabled:opacity-50"
              >
                <ArrowUp size={ICON_SIZE.regular} aria-hidden="true" />
              </button>
            ) : (
              <VoiceRecorder
                compact
                disabled={busy}
                onRecorded={(file, durationMs) =>
                  void sendVoiceNote(file, durationMs)
                }
                onError={setNotice}
              />
            )}
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
        </form>
      ) : null}
    </section>
  );
}
