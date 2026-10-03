import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NotificationKindSchema, NotificationListSchema } from "../src/index.js";

/**
 * The notifications list is parsed whole, so a kind the table accepts but the
 * contract does not know failed every notification for that person (the
 * investor's bell, 2026-10-03). The contract must cover the latest
 * `notifications_kind_check`.
 */
const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

function latestTableKinds(): string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let latest: string | undefined;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = /add constraint notifications_kind_check\s+check \(kind in \(([^)]*)\)\)/.exec(
      sql,
    );
    if (match?.[1] !== undefined) latest = match[1];
  }
  if (latest === undefined) throw new Error("no notifications_kind_check");
  return [...latest.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] ?? "");
}

describe("notification kinds", () => {
  it("covers every kind the notifications table accepts", () => {
    const contract = new Set<string>(NotificationKindSchema.options);
    const missing = latestTableKinds().filter((k) => !contract.has(k));
    expect(missing).toEqual([]);
  });

  it("parses a verification notice", () => {
    const parsed = NotificationListSchema.safeParse({
      unread: 1,
      items: [
        {
          id: "7f1e2a4c-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
          kind: "VERIFICATION_DECIDED",
          title: "Your organisation is verified",
          body: null,
          linkPath: "/verification",
          read: false,
          createdAt: "2026-10-03T07:00:00.000Z",
          priority: "UPDATE",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
