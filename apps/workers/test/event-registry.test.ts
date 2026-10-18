import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  QActionApprovedEvent,
  QActionExecutedEvent,
  QActionExecutionFailedEvent,
  QActionPreparedEvent,
  QActionRejectedEvent,
  qActionEvent,
} from "@capital-q/q-actions/events";
import { CorrelationIdSchema } from "@capital-q/contracts";

import { createProductionEventRegistry as createApiEventRegistry } from "../../api/src/event-registry.js";
import { createProductionEventRegistry } from "../src/event-registry.js";

/**
 * DEF-A1: the outbox publisher validates every claimed row against this
 * registry, so an event any deployable writes but this list omits is never
 * published. These tests make forgetting one a failing build rather than
 * 666 dead rows found by an audit.
 */

const REPO = resolve(import.meta.dirname, "../../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "test") {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** Every `defineEvent({ name, version })` in production source. */
function declaredEvents(): { name: string; version: number; file: string }[] {
  const found: { name: string; version: number; file: string }[] = [];
  for (const root of ["packages", "apps"]) {
    for (const pkg of readdirSync(join(REPO, root))) {
      const src = join(REPO, root, pkg, "src");
      let files: string[];
      try {
        files = sourceFiles(src);
      } catch {
        continue;
      }
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(
          /defineEvent\(\{\s*name:\s*"([^"]+)",\s*version:\s*(\d+)/g,
        )) {
          found.push({
            name: match[1] ?? "",
            version: Number(match[2]),
            file: file.slice(REPO.length + 1),
          });
        }
      }
    }
  }
  return found;
}

describe("the worker's event registry (DEF-A1)", () => {
  const registry = createProductionEventRegistry();

  it("finds the event definitions it scans for (the scan itself works)", () => {
    const declared = declaredEvents();
    expect(declared.length).toBeGreaterThan(50);
    expect(declared.map((d) => d.name)).toContain("q.action.prepared");
  });

  it("registers every event any package or app defines", () => {
    const missing = declaredEvents()
      .filter((d) => !d.name.startsWith("test."))
      .filter((d) => !registry.has(d.name, d.version))
      .map((d) => `${d.name}@${String(d.version)} (${d.file})`);
    expect(missing).toEqual([]);
  });

  it("registers the Approval Engine's five q.action events", () => {
    for (const definition of [
      QActionPreparedEvent,
      QActionApprovedEvent,
      QActionRejectedEvent,
      QActionExecutedEvent,
      QActionExecutionFailedEvent,
    ]) {
      expect(registry.has(definition.name, definition.version)).toBe(true);
    }
  });

  it("accepts a q.action.prepared envelope exactly as q-api writes it", () => {
    const actionId = randomUUID();
    // The Approval Engine's own builder, so this is the envelope q-api
    // actually commits to the outbox.
    const event = qActionEvent(
      QActionPreparedEvent,
      {
        tenantId: randomUUID(),
        organisationId: null,
        actor: { type: "Q", id: "q" },
        correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
        actionId,
        actionVersion: 1,
      },
      {
        actionId,
        runId: randomUUID(),
        actionType: "chat.message.send",
        actionVersion: 1,
        riskClass: "CONFIRM_REQUIRED",
        actionStatus: "AWAITING_APPROVAL",
        approvalId: randomUUID(),
      },
    );
    const parsed = registry.parse(event);
    expect(parsed.ok ? "OK" : parsed.rejection).toBe("OK");
  });

  it("includes everything the API's OutboxWriter can write", () => {
    const missing = createApiEventRegistry()
      .list()
      .filter((d) => !registry.has(d.name, d.version))
      .map((d) => d.name);
    expect(missing).toEqual([]);
  });
});
