import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

/**
 * A receive-only WebSocket endpoint (RFC 6455) on the API's own server, for
 * a provider that pushes to us (P5: Recall streams shared-screen frames
 * only over a websocket). Text messages in; nothing is sent back but the
 * protocol's pong and close. Kept to what that needs -- masked client
 * frames, fragmentation, ping/close, a size cap -- so no dependency is
 * added for one inbound stream. Authorization is the caller's: a
 * connection whose URL it does not accept is refused before the upgrade.
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type WsMessageHandler = {
  readonly message: (text: string) => void;
  readonly closed?: () => void;
};

export type WsReceiverOptions = {
  readonly path: string;
  /** The handler for an accepted connection, or null to refuse it (401). */
  readonly accept: (
    url: URL,
    request: IncomingMessage,
  ) => WsMessageHandler | null;
  /** The largest message accepted; a larger one closes the connection. */
  readonly maxMessageBytes?: number;
};

export function attachWebSocketReceiver(
  server: Server,
  options: WsReceiverOptions,
): void {
  const max = options.maxMessageBytes ?? 4 * 1024 * 1024;
  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      return;
    }
    // Another upgrade handler may own other paths; leave them alone.
    if (url.pathname !== options.path) return;
    const key = request.headers["sec-websocket-key"];
    const upgrade = String(request.headers.upgrade ?? "").toLowerCase();
    const handler =
      typeof key === "string" && upgrade === "websocket"
        ? options.accept(url, request)
        : null;
    if (handler === null || typeof key !== "string") {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const acceptKey = createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
    );
    readFrames(socket, handler, max);
  });
}

function readFrames(
  socket: Duplex,
  handler: WsMessageHandler,
  max: number,
): void {
  let buffered: Buffer = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let partsBytes = 0;
  let partsText = false;
  let done = false;

  const send = (opcode: number, payload: Buffer) => {
    // Server frames are never masked.
    const head =
      payload.length < 126
        ? Buffer.from([0x80 | opcode, payload.length])
        : Buffer.from([
            0x80 | opcode,
            126,
            payload.length >> 8,
            payload.length & 0xff,
          ]);
    socket.write(Buffer.concat([head, payload]));
  };
  const close = (code: number) => {
    if (done) return;
    done = true;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    send(0x8, body);
    socket.end();
    handler.closed?.();
  };

  socket.on("data", (chunk: Buffer) => {
    if (done) return;
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    for (;;) {
      if (buffered.length < 2) return;
      const first = buffered[0] ?? 0;
      const second = buffered[1] ?? 0;
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        const big = buffered.readBigUInt64BE(2);
        if (big > BigInt(max)) {
          close(1009);
          return;
        }
        length = Number(big);
        offset = 10;
      }
      // A client must mask (RFC 6455 5.1); an unmasked frame is refused.
      if (!masked) {
        close(1002);
        return;
      }
      if (length > max) {
        close(1009);
        return;
      }
      if (buffered.length < offset + 4 + length) return;
      const mask = buffered.subarray(offset, offset + 4);
      const payload = Buffer.from(
        buffered.subarray(offset + 4, offset + 4 + length),
      );
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
      }
      buffered = buffered.subarray(offset + 4 + length);

      if (opcode === 0x8) {
        close(1000);
        return;
      }
      if (opcode === 0x9) {
        send(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x2) {
        parts = [payload];
        partsBytes = payload.length;
        partsText = opcode === 0x1;
      } else if (opcode === 0x0) {
        parts.push(payload);
        partsBytes += payload.length;
      } else {
        close(1002);
        return;
      }
      if (partsBytes > max) {
        close(1009);
        return;
      }
      if (fin) {
        const message = Buffer.concat(parts);
        parts = [];
        partsBytes = 0;
        if (partsText) {
          try {
            handler.message(message.toString("utf8"));
          } catch {
            // A handler's failure never takes the connection down.
          }
        }
      }
    }
  });
  socket.on("close", () => {
    if (done) return;
    done = true;
    handler.closed?.();
  });
  socket.on("error", () => {
    socket.destroy();
  });
}
