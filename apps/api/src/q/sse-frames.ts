/**
 * Server-Sent Events frames from a response body: each frame's `event`
 * and its `data` lines joined. Comments, ids and unknown fields are
 * skipped; a frame with no data is never dispatched (the SSE rule).
 */
export async function* sseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ readonly event: string; readonly data: string }> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  const frameOf = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r\n|\r|\n/u)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length === 0 ? null : { event, data: data.join("\n") };
  };
  const BLANK_LINE = /\r?\n\r?\n/u;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value !== undefined) {
        buffer += decoder.decode(value, { stream: true });
      }
      let blank = BLANK_LINE.exec(buffer);
      while (blank !== null) {
        const frame = frameOf(buffer.slice(0, blank.index));
        buffer = buffer.slice(blank.index + blank[0].length);
        if (frame !== null) yield frame;
        blank = BLANK_LINE.exec(buffer);
      }
      if (done) break;
    }
    const last = frameOf(buffer);
    if (last !== null) yield last;
  } finally {
    reader.releaseLock();
  }
}
