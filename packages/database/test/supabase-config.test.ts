import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The identity, permissions and private schemas are reached by the server
 * over PostgreSQL only. Listing any of them in the Data API schema list would
 * put raw identity rows and SECURITY DEFINER helpers one HTTP call away from
 * a browser holding an anon key. Cheap to assert, expensive to get wrong.
 */
describe("supabase/config.toml exposed schemas", () => {
  const configPath = fileURLToPath(
    new URL("../../../supabase/config.toml", import.meta.url),
  );
  const config = readFileSync(configPath, "utf8");

  const match = /^schemas\s*=\s*\[([^\]]*)\]/m.exec(config);
  const exposed = (match?.[1] ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => entry.length > 0);

  it("parses the Data API schema list", () => {
    expect(exposed).toContain("public");
  });

  it.each(["identity", "permissions", "private"])(
    "does not expose the %s schema through the Data API",
    (schema) => {
      expect(exposed).not.toContain(schema);
    },
  );
});
