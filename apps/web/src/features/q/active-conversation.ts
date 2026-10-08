"use client";

import { useSyncExternalStore } from "react";

import { conversationIdOf } from "./wire-constants";

import { Q_CONVERSATION_PARAM } from "./chats-list";

/**
 * Which conversation each Q surface is in, for this tab (UX2 item 2).
 *
 * The conversation itself is the server's, and so is every turn in it:
 * what is kept here is only a pointer, so that leaving a surface and
 * coming back -- Home to Discover and back to Home, closing the Q sheet
 * and opening it again, reloading a page with the sheet open -- lands in
 * the same thread instead of an empty new one. Home already keeps its
 * pointer in the URL for a reload (`?c=`); the navigation's Home link had
 * no way to know it, and the sheet kept it only while it was open.
 *
 * Per tab, deliberately (sessionStorage): a new tab or a fresh sign-in
 * arrives at Q's welcome, as acceptance A asks, with every conversation
 * one click away in Chats. A pointer is never authority -- opening it is
 * still read, and refused, by the Q API under the person's own session --
 * and one that no longer opens is forgotten. Storage that throws or is
 * empty simply means "no pointer".
 */

const KEY = "cq.q.active-conversation.v1";
const CHANGED_EVENT = "cq:q-active-conversation";

/** A surface that holds its own thread: Home, or the sheet about one subject. */
export type QSurfaceKey = "home" | `sheet:${string}`;

function readAll(): Record<string, string> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [surface, value] of Object.entries(parsed)) {
      // Whatever is in storage is input, not a fact.
      const id = conversationIdOf(value);
      if (id !== undefined) out[surface] = id;
    }
    return out;
  } catch {
    return {};
  }
}

export function readActiveConversation(surface: QSurfaceKey): string | null {
  if (typeof window === "undefined") return null;
  return readAll()[surface] ?? null;
}

export function rememberActiveConversation(
  surface: QSurfaceKey,
  conversationId: string | null,
): void {
  if (typeof window === "undefined") return;
  const all = readAll();
  if (conversationId === null) {
    if (!(surface in all)) return;
    delete all[surface];
  } else {
    if (all[surface] === conversationId) return;
    if (conversationIdOf(conversationId) === undefined) return;
    all[surface] = conversationId;
  }
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch {
    // Not kept: the next visit starts at the welcome, which is still right.
  }
}

/** Signing out ends every pointer in this tab; the next person starts clean. */
export function forgetActiveConversations(): void {
  try {
    window.sessionStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** "New chat": the Q page with a new conversation (a bare /home keeps this tab's). */
export const NEW_CHAT_HREF = "/home?new=1";

/** Where Home is for this tab: its open conversation, if it has one. */
export function homeHref(conversationId: string | null): string {
  return conversationId === null
    ? "/home"
    : `/home?${Q_CONVERSATION_PARAM}=${encodeURIComponent(conversationId)}`;
}

/**
 * The Home link, following the conversation Home is in. Rendered as
 * `/home` on the server and on first paint (storage is a browser fact),
 * then pointed at the conversation once mounted.
 */
export function useHomeHref(): string {
  return useSyncExternalStore(
    subscribe,
    () => homeHref(readActiveConversation("home")),
    () => "/home",
  );
}

function subscribe(onChange: () => void): () => void {
  // Another tab's writes never reach this tab's sessionStorage, so only
  // this tab's own event matters.
  window.addEventListener(CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CHANGED_EVENT, onChange);
}
