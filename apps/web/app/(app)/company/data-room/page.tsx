import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Data room and deck" };
export const dynamic = "force-dynamic";

/** The own-company tabs this entry opens; anything else is the data room. */
const TABS = new Set(["dataroom", "deck", "elevator", "team"]);

/**
 * The founder's own data room and deck, one stable link (owner 2026-10-15:
 * "the documents live on a profile page that is hard to reach"). The
 * sidebar, the CRM's investor requests and Q all point here; the server
 * resolves the founder's own company, then opens its profile at the tab,
 * where the owner edits. A founder is never sent to another company's
 * page: the id is the session's own context, never a query parameter.
 */
export default async function OwnDataRoomPage({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
} = {}) {
  const t = await serverT();

  const params = (await searchParams) ?? {};
  const asked = params["tab"];
  const tab = typeof asked === "string" && TABS.has(asked) ? asked : "dataroom";
  const context = await resolveOwnContext();
  if (context.kind === "FOUNDER") {
    redirect(
      `/company/${encodeURIComponent(context.companyId.toLowerCase())}?tab=${tab}`,
    );
  }
  return (
    <PageContainer>
      <QSection id="data-room" kind="DATA_ROOM" total={0} label="the data room">
        {context.kind === "INVESTOR" ? (
          <EmptyState
            title={t("Data rooms belong to companies")}
            description={t(
              "A company's data room opens from its page, as far as it has shared it with you.",
            )}
            action={
              <Link className={buttonClassName("secondary")} href="/discover">
                Open Discover
              </Link>
            }
          />
        ) : context.unavailable === true ? (
          <ErrorState
            title={t("Your data room couldn't open")}
            description={t(
              "Capital Q didn't answer just now. Nothing is lost; try again in a moment.",
            )}
            action={
              <Link
                className={buttonClassName("secondary")}
                href={`/company/data-room?tab=${tab}`}
              >
                Try again
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={t("Set up your company first")}
            description={t(
              "Your data room and deck live on your company's page once it is set up.",
            )}
            action={
              <Link className={buttonClassName("primary")} href="/welcome">
                Set up with Q
              </Link>
            }
          />
        )}
      </QSection>
    </PageContainer>
  );
}
