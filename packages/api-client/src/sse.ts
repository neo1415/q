/**
 * An incremental Server-Sent Events parser (WHATWG "Parsing an event
 * stream"), used by the fetch-based Q stream client (CQ-Q-009 §75, §105).
 *
 * Feed it text as it arrives; it dispatches complete events and keeps
 * whatever is incomplete for the next chunk. Nothing about network chunk
 * boundaries is assumed: an event may span chunks and a chunk may hold
 * several events. Lines end with CRLF, LF or CR. A comment line (`:`) is
 * dropped. `data` lines are joined with `\n`; an event with no data is
 * not dispatched. An `id` containing NUL is ignored, as the spec requires.
 */

export type SseMessage = {
  readonly event: string;
  readonly data: string;
  /** The last `id:` seen, carried on every later message until replaced. */
  readonly lastEventId: string;
};

export type SseParser = {
  readonly feed: (chunk: string) => readonly SseMessage[];
  /** The retry hint the server last sent, in milliseconds, if any. */
  readonly retryMs: () => number | undefined;
  readonly lastEventId: () => string;
};

export function createSseParser(): SseParser {
  let buffer = "";
  let dataLines: string[] = [];
  let eventName = "";
  let lastEventId = "";
  let retryMs: number | undefined;

  function dispatch(out: SseMessage[]): void {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }
    out.push({
      event: eventName === "" ? "message" : eventName,
      data: dataLines.join("\n"),
      lastEventId,
    });
    dataLines = [];
    eventName = "";
  }

  function processLine(line: string, out: SseMessage[]): void {
    if (line === "") {
      dispatch(out);
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
    }
    switch (field) {
      case "event":
        eventName = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\0")) {
          lastEventId = value;
        }
        break;
      case "retry":
        if (/^[0-9]+$/.test(value)) {
          retryMs = Number(value);
        }
        break;
      default:
        break;
    }
  }

  return {
    feed: (chunk) => {
      const out: SseMessage[] = [];
      buffer += chunk;
      // A trailing CR may be the first half of CRLF: hold it back.
      let searchFrom = 0;
      for (;;) {
        const lf = buffer.indexOf("\n", searchFrom);
        const cr = buffer.indexOf("\r", searchFrom);
        let end: number;
        let skip: number;
        if (cr !== -1 && (lf === -1 || cr < lf)) {
          if (cr === buffer.length - 1) {
            break;
          }
          end = cr;
          skip = buffer[cr + 1] === "\n" ? 2 : 1;
        } else if (lf !== -1) {
          end = lf;
          skip = 1;
        } else {
          break;
        }
        processLine(buffer.slice(0, end), out);
        buffer = buffer.slice(end + skip);
        searchFrom = 0;
      }
      return out;
    },
    retryMs: () => retryMs,
    lastEventId: () => lastEventId,
  };
}
