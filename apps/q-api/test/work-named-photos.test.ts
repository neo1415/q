import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { QWorkDto } from "@capital-q/contracts";
import type { NamedImageSubject } from "@capital-q/public-identity";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp } from "../src/app.js";
import type { WorkPort } from "../src/composition/work/actions.js";
import type { WorkPage } from "../src/composition/work/page.js";

/**
 * The Work page's rows name counterparts to the person whose work it is,
 * so each named counterpart's logo is signed with the name, in one batch
 * per response (founder decision 2026-10-04). Rows that name no one carry
 * no picture.
 */

const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const COMPANY = "44444444-0000-4000-8000-000000000001";
const INVESTOR = "a1000000-0000-4000-8000-000000000001";
const LOGO = "https://storage.test/object/sign/cq-profile-images/l?t=1";
const AT = "2026-10-04T09:00:00.000Z";

const lane = (
  counterpart: QWorkDto["lanes"][number]["counterpart"],
): QWorkDto["lanes"][number] => ({
  id: "70000000-0000-4000-8000-000000000001",
  counterpartName: "Kora",
  counterpart,
  stage: "NEEDS_TIMES",
  lastStep: null,
  reasons: [],
  offered: [],
  report: null,
  chatPath: null,
  updatedAt: AT,
});

const WORK: QWorkDto = {
  id: "60000000-0000-4000-8000-000000000001",
  kind: "INVESTOR_OUTREACH",
  status: "ACTIVE",
  summary: null,
  createdAt: AT,
  expiresAt: AT,
  lanes: [lane({ kind: "COMPANY", id: COMPANY, photoUrl: null }), lane(null)],
  goal: null,
  run: null,
  lastStep: null,
  spend: null,
  delegation: null,
};

function build() {
  const asked: NamedImageSubject[][] = [];
  const work = Object.assign({} as WorkPort, {
    seen: () => Promise.resolve(),
    list: () => Promise.resolve([WORK]),
  });
  const page = Object.assign({} as WorkPage, {
    suggestions: () =>
      Promise.resolve([
        {
          key: "connect_waiting:a",
          kind: "CONNECT_WAITING" as const,
          lead: 2,
          unit: "days",
          subject: "Beacon Ventures",
          question: "Say hello?",
          prompt: "Say hello to Beacon Ventures.",
          linkPath: `/relationships/investor/${INVESTOR}`,
        },
        {
          key: "mandate_gaps:b",
          kind: "MANDATE_GAPS" as const,
          lead: 1,
          unit: "gap",
          subject: "Your mandate",
          question: "Fill it in?",
          prompt: "Help me fill my mandate.",
          linkPath: "/profile",
        },
      ]),
  });
  const { app } = createApp(
    parseQApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: {
        authenticate: () =>
          Promise.resolve({
            authUserId: AuthUserIdSchema.parse(
              "a0000000-0000-4000-8000-000000000001",
            ),
          }),
      },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
      },
    },
    {
      work,
      workPage: page,
      namedPhotos: {
        photos: (subjects) => {
          asked.push([...subjects]);
          return Promise.resolve(
            new Map(
              subjects.map(
                (s) => [`${s.subjectType}:${s.subjectId}`, LOGO] as const,
              ),
            ),
          );
        },
      },
    },
  );
  return { app, asked };
}

describe("Work rows carry the named counterpart's picture", () => {
  it("a lane naming a company carries its logo; a lane naming no one, none", async () => {
    const { app, asked } = build();
    const response = await app.inject({ method: "GET", url: "/v1/q/work" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: QWorkDto[] }>();
    expect(body.items[0]?.lanes.map((item) => item.counterpart)).toEqual([
      { kind: "COMPANY", id: COMPANY, photoUrl: LOGO },
      null,
    ]);
    expect(asked).toEqual([[{ subjectType: "COMPANY", subjectId: COMPANY }]]);
    await app.close();
  });

  it("a suggestion linking to the person's own relationship names that side", async () => {
    const { app, asked } = build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/work/suggestions",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { named: unknown }[] }>();
    expect(body.items.map((item) => item.named)).toEqual([
      { kind: "INVESTOR_ORGANISATION", id: INVESTOR, photoUrl: LOGO },
      null,
    ]);
    expect(asked).toEqual([
      [{ subjectType: "INVESTOR_ORGANISATION", subjectId: INVESTOR }],
    ]);
    await app.close();
  });
});
