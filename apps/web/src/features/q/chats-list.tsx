"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { QConversationSummary } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronDown, ICON_SIZE, ICON_STROKE, Plus } from "@capital-q/ui/icons";

import {
  archiveQConversationAction,
  listQConversationsAction,
} from "./actions";
import { Q_CONVERSATIONS_CHANGED_EVENT } from "./use-q-conversation";

/**
 * A person's conversations with Q, as a collapsible list (ADR 0012).
 *
 * The server's list, read on mount, whenever a conversation changes on
 * this screen, and whenever the route changes; never a browser copy. The
 * only thing kept in the browser is whether the list is folded, which is
 * this viewer's convenience and nothing more. Each entry opens Home in
 * that conversation; "New chat" opens Home in none.
 */

export const Q_CONVERSATION_PARAM = "c";

const FOLD_KEY = "cq.q.chats.folded";

function readFolded(): boolean {
  try {
    return window.localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFolded(folded: boolean): void {
  try {
    window.localStorage.setItem(FOLD_KEY, folded ? "1" : "0");
  } catch {
    // A preference that cannot be kept is simply not kept.
  }
}

function whenLabel(iso: string): string {
  const at = new Date(iso);
  const now = new Date();
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) {
    return at.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatsList({
  variant = "sidebar",
}: {
  readonly variant?: "sidebar" | "inline";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const active =
    pathname === "/home" ? searchParams.get(Q_CONVERSATION_PARAM) : null;
  const [items, setItems] = useState<readonly QConversationSummary[] | null>(
    null,
  );
  const [folded, setFolded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listQConversationsAction();
    if (result.ok) {
      setItems(result.value.items);
      setNotice(null);
    } else {
      setItems((current) => current ?? []);
      setNotice(result.message);
    }
  }, []);

  useEffect(() => {
    // The fold is a per-viewer convenience read after mount, one
    // microtask later so it belongs to the load rather than the render.
    void Promise.resolve().then(() => {
      setFolded(readFolded());
      return load();
    });
    const onChange = () => void load();
    window.addEventListener(Q_CONVERSATIONS_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(Q_CONVERSATIONS_CHANGED_EVENT, onChange);
    };
  }, [load]);

  const toggle = () => {
    setFolded((current) => {
      writeFolded(!current);
      return !current;
    });
  };

  const archive = async (conversationId: string) => {
    const result = await archiveQConversationAction(conversationId);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setItems((current) =>
      (current ?? []).filter((item) => item.conversationId !== conversationId),
    );
    if (active === conversationId) {
      router.push("/home");
    }
  };

  const listId = `cq-chats-${variant}`;
  return (
    <section
      aria-labelledby={`${listId}-heading`}
      className={cx(
        "flex min-h-0 flex-col gap-2",
        variant === "sidebar" ? "px-3 pt-6" : "",
      )}
      data-q-chats
    >
      <div className="flex items-center justify-between gap-2 px-2">
        <button
          type="button"
          id={`${listId}-heading`}
          aria-expanded={!folded}
          aria-controls={listId}
          onClick={toggle}
          className="flex min-h-10 items-center gap-1 rounded-md px-1 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
        >
          <ChevronDown
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
            className={cx(
              "transition-transform duration-(--cq-motion-fast)",
              folded ? "-rotate-90" : "",
            )}
          />
          Chats
        </button>
        <Link
          href="/home"
          aria-label="New chat"
          title="New chat"
          className={buttonClassName("quiet", "compact", "min-h-10")}
          onClick={() => {
            // Home with no conversation is a new chat; the route change
            // is what the panel reads, nothing is reset here.
          }}
        >
          <Plus
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          <span className={variant === "sidebar" ? "sr-only" : ""}>
            New chat
          </span>
        </Link>
      </div>
      {folded ? null : (
        <div id={listId} className="min-h-0 overflow-y-auto">
          {items === null ? (
            <p className="px-3 py-2 cq-caption text-(--cq-text-tertiary)">
              Loading your chats…
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 cq-caption text-(--cq-text-tertiary)">
              {notice ?? "Your chats with Q appear here."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const current = item.conversationId === active;
                return (
                  <li key={item.conversationId} className="group relative">
                    <Link
                      href={`/home?${Q_CONVERSATION_PARAM}=${encodeURIComponent(item.conversationId)}`}
                      aria-current={current ? "page" : undefined}
                      className={cx(
                        "flex min-h-10 flex-col justify-center gap-0.5 rounded-md py-1.5 pr-16 pl-3 transition-colors duration-(--cq-motion-fast)",
                        current
                          ? "bg-(--cq-accent-soft) text-(--cq-text-primary)"
                          : "text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)",
                      )}
                    >
                      <span className="cq-body-sm truncate">{item.title}</span>
                      <span className="cq-caption text-(--cq-text-tertiary)">
                        {whenLabel(item.lastMessageAt)}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => void archive(item.conversationId)}
                      className={cx(
                        "absolute top-1/2 right-1 -translate-y-1/2 rounded-md px-2 py-1 cq-caption text-(--cq-text-tertiary) hover:text-(--cq-text-primary) focus-visible:opacity-100",
                        current
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                      aria-label={`Archive ${item.title}`}
                    >
                      Archive
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
