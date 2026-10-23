/**
 * QA F-28 (23 Oct 2026): a founder asked "Who can see my data room right
 * now?" and Q said its access settings "aren't available": the model never
 * read them. A question about who can see their data room or documents is
 * read by code, as the asker, through read_my (the access editor's own
 * reads: each document's level, the investors granted access and until
 * when, and what investors asked for), and the answer is spoken from it.
 * Changing a level stays the existing approval path (set_data_room_level).
 */

const WHO_CAN_SEE =
  /\b(?:who|which\s+investors?|anyone|anybody)\b[^.?!]*\b(?:see|access|open|view|read|look\s+at|has|have|got)\b[^.?!]*\b(?:data[\s-]?room|documents?|files?|deck|financials|financial\s+model)\b|\b(?:data[\s-]?room|documents?)\b[^.?!]*\b(?:access|visibility|permissions?|who\s+(?:can|has))\b|\baccess\s+(?:to|settings\s+(?:for|on))\s+(?:my|our)\s+(?:data[\s-]?room|documents?)\b/iu;

/** They ask who can see their own data room or documents. */
export function asksWhoCanSeeDataRoom(text: string): boolean {
  const plain = text.replace(/[’]/gu, "'");
  return (
    /\b(?:my|our)\b/iu.test(plain) &&
    WHO_CAN_SEE.test(plain) &&
    // Not a request to change it: that is an action, with its own path.
    !/\b(?:make|set|change|share|revoke|remove|hide|give|grant|approve|decline)\b/iu.test(
      plain,
    )
  );
}

type Item = {
  readonly title?: unknown;
  readonly status?: unknown;
  readonly facts?: Readonly<Record<string, unknown>>;
};

function itemsOf(data: unknown): readonly Item[] | null {
  if (typeof data !== "object" || data === null) return null;
  if (Reflect.get(data, "available") !== true) return null;
  const items: unknown = Reflect.get(data, "items");
  return Array.isArray(items)
    ? items.filter(
        (item): item is Item => typeof item === "object" && item !== null,
      )
    : null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * The access and request reads as one fact. Null when the access read was
 * not available to them (not a founder, or no data room service): the
 * answer then says what it can, never "not available" for a room it read.
 */
export function dataRoomAccessStatement(
  access: unknown,
  requests: unknown,
): string | null {
  const documents = itemsOf(access);
  if (documents === null) return null;
  const lines = documents.slice(0, 30).map((document) => {
    const shared = text(document.facts?.["sharedWith"]);
    const opened = document.facts?.["openedBy"];
    return `- ${text(document.title) ?? "Untitled"}: ${text(document.status) ?? "level not set"}; ${
      shared === null ? "not shared with any investor" : `shared with ${shared}`
    }${typeof opened === "number" && opened > 0 ? `; opened by ${String(opened)} investor${opened === 1 ? "" : "s"}` : ""}`;
  });
  const asked = (itemsOf(requests) ?? [])
    .filter((item) => item.facts?.["kind"] === "document request")
    .slice(0, 15)
    .map(
      (item) =>
        `- ${text(item.facts?.["from"]) ?? "An investor"} asked for ${text(item.title) ?? "a document"}: ${text(item.status) ?? ""}`,
    );
  return [
    documents.length === 0
      ? "WHO CAN SEE THEIR DATA ROOM (read just now from their data room): it holds no documents yet, so no investor can see anything in it."
      : `WHO CAN SEE THEIR DATA ROOM (read just now from their data room, ${String(documents.length)} document${documents.length === 1 ? "" : "s"}): answer from this exactly, document by document where it differs, and offer to change a document's level (they approve it first).`,
    ...lines,
    ...(asked.length === 0
      ? []
      : ["Investors who asked for documents:", ...asked]),
  ]
    .join("\n")
    .slice(0, 7_900);
}
