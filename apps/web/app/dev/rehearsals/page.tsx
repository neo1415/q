import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  QRehearsalListDto,
  QRehearsalPartnersDto,
} from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { RehearsalsHome } from "@/features/rehearsal/rehearsals-home";

export const metadata: Metadata = {
  title: "Rehearsals (design review)",
  robots: { index: false },
};

/**
 * The Rehearsals page in the real shell with fictional data, for design
 * review and screenshots. Development only; reads and writes nothing.
 * `?state=empty` is a new founder; `?with=<id>` filters the history.
 */

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export default async function RehearsalsReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const empty = params["state"] === "empty";
  const withId = typeof params["with"] === "string" ? params["with"] : null;
  const now = Date.now();
  const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  const voltron = {
    kind: "INVESTOR_ORGANISATION" as const,
    id: id(1),
    name: "Voltron Capital",
  };
  const platform = {
    kind: "INVESTOR_ORGANISATION" as const,
    id: id(2),
    name: "Ventures Platform",
  };
  const savanna = {
    kind: "INVESTOR_ORGANISATION" as const,
    id: id(3),
    name: "Savanna Seed Partners",
  };
  const kestrel = {
    kind: "INVESTOR_ORGANISATION" as const,
    id: id(4),
    name: "Kestrel Ventures",
  };
  const partners: QRehearsalPartnersDto & { role: "FOUNDER" } = {
    role: "FOUNDER",
    upcoming: empty
      ? []
      : [
          {
            meetingId: id(50),
            startsAt: at(52),
            purpose: "Seed round intro",
            counterpart: voltron,
          },
        ],
    people: empty
      ? []
      : [
          {
            relationshipId: id(60),
            counterpart: voltron,
            state: "CONNECTED",
            lastRehearsal: {
              id: id(300),
              at: at(-30),
              score: 58,
              outcome: "FOUNDER_ENDED",
            },
          },
          {
            relationshipId: id(61),
            counterpart: platform,
            state: "CONNECTED",
            lastRehearsal: {
              id: id(300),
              at: at(-31),
              score: 46,
              outcome: "FOUNDER_ENDED",
            },
          },
          {
            relationshipId: id(62),
            counterpart: savanna,
            state: "CONNECTED",
            lastRehearsal: {
              id: id(300),
              at: at(-40),
              score: 40,
              outcome: "FOUNDER_ENDED",
            },
          },
          {
            relationshipId: id(63),
            counterpart: kestrel,
            state: "CONNECTED",
            lastRehearsal: null,
          },
        ],
  };
  const rows: [
    typeof voltron,
    number,
    number | null,
    QRehearsalListDto["rehearsals"][number]["outcome"],
  ][] = [
    [voltron, -30, 58, "FOUNDER_ENDED"],
    [platform, -31, 46, "FOUNDER_ENDED"],
    [platform, -33, 46, "DECLINED"],
    [platform, -35, 52, "LEFT_EARLY"],
    [voltron, -50, 46, "STRONG_LATER"],
    [platform, -60, 40, "LEFT_EARLY"],
    [savanna, -70, 40, "LEFT_EARLY"],
    [savanna, -80, null, null],
  ];
  const history: QRehearsalListDto = {
    rehearsals: empty
      ? []
      : rows.map(([counterpart, hours, score, outcome], index) => ({
          id: id(200 + index),
          counterpart,
          status: outcome === null ? "ACTIVE" : "FINISHED",
          outcome,
          score,
          exchanges: 12,
          createdAt: at(hours),
        })),
  };
  return (
    <AppShell
      context={{
        scope: "founder_private",
        label: "Ledgerfold (fictional)",
        admin: false,
      }}
    >
      <PageContainer>
        <RehearsalsHome
          basePath="/dev/rehearsals"
          partners={partners}
          history={history}
          allowance={{
            words: "22 rehearsals left this month on your Launch plan.",
            out: false,
          }}
          withId={withId}
        />
      </PageContainer>
    </AppShell>
  );
}
