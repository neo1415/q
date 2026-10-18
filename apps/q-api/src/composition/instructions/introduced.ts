import type { ChatService } from "@capital-q/communication";
import type { ActorContext } from "@capital-q/security";

/**
 * Whether the person's side has already written in each conversation (live
 * QA, instruction 76d6f281: Tarmacly, Nsuo Labs and Maji Loop got a second
 * "first message" -- one had gone the night before under another
 * instruction, and the planner did not know).
 *
 * Code reads the conversation itself: any message from the person or their
 * side, sent by a human or by Q, under any instruction. Only who sent each
 * message is read, never its words. Unknown counts as written: a failed
 * read, or a window full of their messages with none of ours, never
 * licenses a first message.
 */

/** The window read per conversation (the chat service's own Q cap). */
const WINDOW = 30;
/** At most this many conversations read side by side. */
const PARALLEL = 4;

export function createIntroducedReader(dependencies: {
  readonly chat: Pick<ChatService, "readForQ">;
}): (
  actor: ActorContext,
  relationshipIds: readonly string[],
) => Promise<ReadonlySet<string>> {
  return async (actor, relationshipIds) => {
    const written = new Set<string>();
    const queue = [...new Set(relationshipIds)];
    const next = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const read = await dependencies.chat
          .readForQ({ actor, relationshipId: id, limit: WINDOW })
          .catch(() => null);
        if (
          read === null ||
          read.messages.some((message) => message.from !== "OTHER_SIDE") ||
          read.messages.length >= WINDOW
        ) {
          written.add(id);
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, next));
    return written;
  };
}
