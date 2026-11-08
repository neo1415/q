import { describe, expect, it } from "vitest";

import { namedRecordRequestOf } from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

import { warmAfterListen } from "../src/composition/boot-warmup.js";

const quietLogger = () => {
  const lines: { level: string; message: string; context: unknown }[] = [];
  const log =
    (level: string) =>
    (context: unknown, message: string): void => {
      lines.push({ level, message, context });
    };
  return {
    lines,
    logger: {
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
      child: () => {
        throw new Error("not used");
      },
    } as never,
  };
};

describe("q-api boot warm-up (batch 13: the slow first fast navigation)", () => {
  it("opens the whole pool at once, then runs one fast navigation as nobody", async () => {
    let inFlight = 0;
    let peak = 0;
    const ping = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
    };
    const actors: ActorContext[] = [];
    const texts: string[] = [];
    const { lines, logger } = quietLogger();
    await warmAfterListen({
      ping,
      poolMax: 6,
      fastNavigation: (actor, text) => {
        actors.push(actor);
        texts.push(text);
        return Promise.resolve();
      },
      logger,
    });
    expect(peak).toBe(6);
    expect(actors).toHaveLength(1);
    // The record path, so the firewall plan and open_page are exercised.
    expect(namedRecordRequestOf(texts[0] ?? "")).not.toBeNull();
    expect(lines.map((l) => l.message)).toEqual(["q-api boot warm-up done"]);
  });

  it("never throws: failed pings and a failed navigation are a log line", async () => {
    const { lines, logger } = quietLogger();
    await expect(
      warmAfterListen({
        ping: () => Promise.reject(new Error("no database")),
        poolMax: 3,
        fastNavigation: () => Promise.reject(new Error("refused")),
        logger,
      }),
    ).resolves.toBeUndefined();
    expect(lines[0]?.message).toBe("q-api boot warm-up done");
    expect(lines[0]?.context).toMatchObject({ connections: 0 });
  });
});
