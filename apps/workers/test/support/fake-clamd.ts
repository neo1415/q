import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net";

/**
 * A fake clamd on loopback (decision 104 tests): speaks the INSTREAM and
 * VERSION commands, reassembles the frames it is sent, and answers, stays
 * silent or drops the connection. No real scanner and no network.
 */

// The EICAR test string: a harmless file every scanner reports by name.
export const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export type FakeClamdBehaviour = "answer" | "silent" | "close";

export type FakeClamd = {
  readonly port: number;
  /** The bytes each INSTREAM carried, reassembled from its frames. */
  readonly streamed: Buffer[];
  readonly commands: string[];
};

const servers: Server[] = [];

/** Closes every fake started since the last call (an afterEach). */
export async function closeFakeClamds(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
}

/** Parses frames until the zero-length terminator; null while incomplete. */
function deframe(buffer: Buffer): Buffer | null {
  const parts: Buffer[] = [];
  let at = 0;
  for (;;) {
    if (buffer.byteLength < at + 4) return null;
    const length = buffer.readUInt32BE(at);
    at += 4;
    if (length === 0) return Buffer.concat(parts);
    if (buffer.byteLength < at + length) return null;
    parts.push(buffer.subarray(at, at + length));
    at += length;
  }
}

export async function fakeClamd(
  behaviour: FakeClamdBehaviour,
  verdictFor: (bytes: Buffer) => string = (bytes) =>
    bytes.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))
      ? "stream: Win.Test.EICAR_HDB-1 FOUND"
      : "stream: OK",
): Promise<FakeClamd> {
  const streamed: Buffer[] = [];
  const commands: string[] = [];
  const server = createServer((socket: Socket) => {
    let received = Buffer.alloc(0);
    socket.on("data", (data: Buffer) => {
      received = Buffer.concat([received, data]);
      const nul = received.indexOf(0);
      if (nul < 0) return;
      const command = received.subarray(0, nul).toString("utf8");
      if (command === "zVERSION") {
        commands.push(command);
        socket.end("ClamAV 1.4.1/27460/Mon Nov 16 09:00:00 2026\0");
        return;
      }
      if (command !== "zINSTREAM") return;
      const body = deframe(received.subarray(nul + 1));
      if (body === null) return;
      commands.push(command);
      streamed.push(body);
      if (behaviour === "silent") return;
      if (behaviour === "close") {
        socket.destroy();
        return;
      }
      socket.end(`${verdictFor(body)}\0`);
    });
    socket.on("error", () => undefined);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    streamed,
    commands,
  };
}

/** Stops one fake now, so its port refuses connections. */
export async function stopFakeClamd(fake: FakeClamd): Promise<void> {
  const index = servers.findIndex(
    (server) => (server.address() as AddressInfo | null)?.port === fake.port,
  );
  const [server] = index < 0 ? [] : servers.splice(index, 1);
  if (server === undefined) return;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
