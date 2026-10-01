import type { ObservedMessage } from "./types.js";

/** A thread as the model reads it, "Name: words" per line, newest last, bounded. */
export function threadText(
  messages: readonly ObservedMessage[],
  principalName: string,
): string {
  return messages
    .slice(-20)
    .map((message) => {
      const who =
        message.from === "OTHER_SIDE"
          ? message.senderName
          : `${message.senderName} (${principalName}'s side)`;
      return `${who}${message.viaQ ? " [Q]" : ""}: ${message.text ?? "[attachment]"}`;
    })
    .join("\n")
    .slice(-12_000);
}
