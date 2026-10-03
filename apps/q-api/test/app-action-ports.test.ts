import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_ACTIONS,
  type AnyAppAction,
  type AppActionPorts,
} from "@capital-q/app-actions";
import { INSTRUCTION_DEFAULT_ACTIONS } from "@capital-q/contracts";

/**
 * Live 2026-10-03 (card 6d184093): an approved standing-instruction step,
 * app.relationship.interest.express, failed with
 * APP_ACTION_PORT_MISSING:interests -- q-api never wired the port, so the
 * action had never run through app actions in production. A missing port
 * fails here, in CI.
 *
 * Which ports an action needs is read from the action itself: its run is
 * called with recording ports (every service call rejects), so nothing is
 * listed by hand that could drift.
 */

/** Any value, any depth: property reads go on; calls reject. */
function anything(): unknown {
  const target = function probe() {
    return undefined;
  };
  return new Proxy(target, {
    get: (_t, key) =>
      key === "then"
        ? undefined
        : key === Symbol.toPrimitive
          ? () => "x"
          : anything(),
    apply: () => Promise.reject(new Error("probe")),
  });
}

async function portsUsedBy(action: AnyAppAction): Promise<string[]> {
  const used = new Set<string>();
  const ports = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key === "string") used.add(key);
        return anything();
      },
    },
  ) as AppActionPorts;
  await Promise.resolve()
    .then(() =>
      action.run(
        ports,
        {
          actor: anything() as never,
          idempotencyKey: "probe",
          correlationId: "cor_probe" as never,
          surface: "Q",
        },
        anything(),
      ),
    )
    .catch(() => undefined);
  return [...used];
}

/** The top-level keys of q-api's app-action ports, as main.ts composes them. */
function wiredPorts(): Set<string> {
  const source = readFileSync(
    resolve(import.meta.dirname, "../src/main.ts"),
    "utf8",
  );
  const start = source.indexOf("const appActionPorts: OwnReadPorts = {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n};", start);
  const block = source.slice(start, end);
  return new Set(
    [...block.matchAll(/^ {2}([A-Za-z]+)(?=[,:(])/gmu)].map(
      (match) => match[1] ?? "",
    ),
  );
}

describe("q-api provides every port the actions Q can take need", () => {
  it("every action a standing instruction can grant, and every action Q proposes or runs by its own tool", async () => {
    const granted = new Set(
      INSTRUCTION_DEFAULT_ACTIONS.map((entry) => entry.action),
    );
    const wired = wiredPorts();
    const missing: string[] = [];
    for (const action of APP_ACTIONS) {
      const reachable =
        granted.has(action.name) ||
        action.tool !== undefined ||
        action.viaTool !== undefined;
      if (!reachable) continue;
      for (const port of await portsUsedBy(action)) {
        if (!wired.has(port)) missing.push(`${action.name}: ${port}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the probe sees the port an action needs (express interest needs interests)", async () => {
    const express = APP_ACTIONS.find(
      (action) => action.name === "relationship.interest.express",
    );
    expect(express).toBeDefined();
    if (express !== undefined) {
      expect(await portsUsedBy(express)).toContain("interests");
    }
  });
});
