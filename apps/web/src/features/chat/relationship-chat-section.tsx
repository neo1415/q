import "server-only";

import { getChatThread } from "@capital-q/api-client";
import type { ChatThreadDto } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

import { RelationshipChat } from "./relationship-chat";

/**
 * The chat on a relationship page (R34): the first page of the thread is
 * read on the server, as the person, and the client keeps it current. A
 * person who is not a party gets nothing here, because the API answers
 * them exactly as it answers a thread that does not exist.
 */
export async function RelationshipChatSection({
  relationshipId,
  counterpart,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
}) {
  const session = await apiSession();
  if (session === null) return null;
  let initial: ChatThreadDto | null;
  try {
    initial = await getChatThread(session, relationshipId);
  } catch (error: unknown) {
    // Not a party (404): no chat at all. Anything else: say it didn't load.
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 404
    ) {
      return null;
    }
    initial = null;
  }
  return (
    <RelationshipChat
      relationshipId={relationshipId}
      counterpart={counterpart}
      initial={initial}
    />
  );
}
