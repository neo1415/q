import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import {
  boundConversationSearch,
  createPostgresQRuntimeRepositories,
  escapeLikePattern,
} from "../src/infrastructure/postgres-q-runtime-repositories.js";

/**
 * Relevant recall's search of a person's own conversations. The terms
 * come from what a person typed, so the bounds and the LIKE escaping are
 * proven here, and the statement is checked for the predicates that keep
 * it to one owner in one tenant: no other user's or tenant's
 * conversation, no archived one, never the current one.
 */

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const COMPANY = "d0000000-0000-4000-8000-000000000001";
const CURRENT = "f0000000-0000-4000-8000-000000000001";

function recordingSql() {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("$?"), values });
    return Promise.resolve([]);
  }) as unknown as DatabaseExecutor;
  return { sql, calls };
}

describe("bounding a conversation search", () => {
  it("escapes LIKE wildcards so a term only matches literally", () => {
    expect(escapeLikePattern("100%_sure\\")).toBe("100\\%\\_sure\\\\");
  });

  it("caps terms at 8 of 3-60 characters, de-duplicated, and the limit at 4", () => {
    const bounded = boundConversationSearch({
      companyIds: [COMPANY, COMPANY, "not-a-uuid"],
      terms: [
        "Tensorgate",
        "tensorgate",
        "ab",
        "x".repeat(61),
        ...Array.from({ length: 12 }, (_, i) => `Name${String(i)}`),
      ],
      except: [CURRENT, "not-a-uuid"],
      limit: 50,
    });
    expect(bounded).not.toBeNull();
    expect(bounded?.companyIds).toEqual([COMPANY]);
    expect(bounded?.patterns).toHaveLength(8);
    expect(bounded?.patterns[0]).toBe("%Tensorgate%");
    expect(bounded?.except).toEqual([CURRENT]);
    expect(bounded?.limit).toBe(4);
    expect(
      boundConversationSearch({
        companyIds: [],
        terms: ["Tensorgate"],
        except: [],
        limit: 0,
      })?.limit,
    ).toBe(1);
  });

  it("is nothing to search when no company or usable term is left", () => {
    expect(
      boundConversationSearch({
        companyIds: ["nope"],
        terms: ["ab", " "],
        except: [],
        limit: 4,
      }),
    ).toBeNull();
  });
});

describe("conversations.searchForOwner", () => {
  it("scopes the statement to the owner in the tenant, open and summarised, never the current one", async () => {
    const { sql, calls } = recordingSql();
    const repositories = createPostgresQRuntimeRepositories();
    const found = await repositories.conversations.searchForOwner(
      sql,
      TENANT,
      USER,
      {
        companyIds: [COMPANY],
        terms: ["Tensor%gate"],
        except: [CURRENT],
        limit: 9,
      },
    );
    expect(found).toEqual([]);
    const statement = calls.find((call) => call.text.includes("c.tenant_id ="));
    expect(statement).toBeDefined();
    const text = statement?.text.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("c.tenant_id = $? and c.user_id = $?");
    expect(text).toContain("c.archived_at is null");
    expect(text).toContain("c.summary is not null");
    expect(text).toContain("c.id <> all($?::uuid[])");
    expect(text).toContain("s->>'kind' = 'COMPANY'");
    expect(text).toContain("s->>'companyId' = any($?::text[])");
    expect(text).toContain("c.title ilike any($?::text[])");
    expect(text).toContain("c.summary ilike any($?::text[])");
    expect(text).toContain(
      "coalesce(c.last_message_at, c.created_at) desc, c.id desc",
    );
    // Every value is a parameter; the term arrives escaped, the limit bounded.
    const values = statement?.values ?? [];
    expect(values).toContain(TENANT);
    expect(values).toContain(USER);
    expect(values).toContainEqual([CURRENT]);
    expect(values).toContainEqual([COMPANY]);
    expect(values).toContainEqual(["%Tensor\\%gate%"]);
    expect(values.at(-1)).toBe(4);
  });

  it("makes no query at all when there is nothing to match on", async () => {
    const { sql, calls } = recordingSql();
    const repositories = createPostgresQRuntimeRepositories();
    const found = await repositories.conversations.searchForOwner(
      sql,
      TENANT,
      USER,
      { companyIds: [], terms: [], except: [], limit: 4 },
    );
    expect(found).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("ranks exact company subjects before recent loose summary hits, before limiting", async () => {
    const { sql, calls } = recordingSql();
    await createPostgresQRuntimeRepositories().conversations.searchForOwner(
      sql,
      TENANT,
      USER,
      { companyIds: [COMPANY], terms: ["Compare"], except: [], limit: 4 },
    );
    const statement = calls.find((call) => call.text.includes("c.tenant_id ="));
    const ordering = statement?.text
      .split("order by")
      .at(-1)
      ?.replace(/\s+/g, " ");
    expect(ordering).toMatch(
      /^ exists \(.*s->>'kind' = 'COMPANY'.*s->>'companyId' = any\(\$\?::text\[\]\).*\) desc, coalesce\(c.last_message_at, c.created_at\) desc, c.id desc limit \$\?$/,
    );
    expect(
      statement?.values.filter(
        (value) => Array.isArray(value) && value.includes(COMPANY),
      ),
    ).toHaveLength(2);
  });
});
