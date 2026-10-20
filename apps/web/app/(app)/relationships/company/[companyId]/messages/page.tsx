import type { Metadata } from "next";

import { QSection } from "@/features/q/q-section";
import { QPageSubject } from "@/features/q/q-subject";
import { RelationshipInbox } from "@/features/relationships/relationship-inbox";
import { RelationshipUnavailable } from "@/features/relationships/relationship-detail";
import { messageCountOf } from "@/features/relationships/brief-lines";
import { loadInvestorSideRelationship } from "@/features/relationships/relationship-page-data";
import { STATE_WORDS } from "@/features/relationships/relationship-words";
import { serverT, serverUiLanguage } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Messages") };
}
export const dynamic = "force-dynamic";

/**
 * An investor organisation's conversations, with the one with this company
 * open (R34; inbox split, 2026-10-20). Before both sides agree to connect
 * the thread cannot load, so its pane says why it is empty and when it
 * opens -- never "Messages couldn't load" over a live composer (demo-44).
 */
export default async function InvestorConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly companyId: string }>;
  readonly searchParams?: Promise<{ readonly inbox?: string }> | undefined;
}) {
  await serverUiLanguage();
  const t = await serverT();

  const { companyId } = await params;
  const showList = (await searchParams)?.inbox === "1";
  const loaded = await loadInvestorSideRelationship(companyId);
  if (loaded.kind === "UNAVAILABLE") {
    return <RelationshipUnavailable sentence={loaded.sentence} />;
  }
  if (loaded.relationship === null) {
    return <RelationshipUnavailable sentence={loaded.absentSentence} />;
  }
  return (
    <>
      <QPageSubject
        subject={{
          kind: "RELATIONSHIP",
          relationshipId: loaded.relationship.relationshipId,
          label: loaded.counterpart,
          scope: "relationship_shared",
        }}
      />
      {/* Q room R1: the chat on screen, by its counterpart. */}
      <QSection
        id="chat"
        kind="CHAT"
        refs={[{ kind: "COMPANY", id: loaded.companyId }]}
        total={messageCountOf(loaded)}
        label={t(`chat with ${loaded.counterpart} open`)}
      >
        <RelationshipInbox
          counterpart={loaded.counterpart}
          relationship={loaded.relationship}
          profile={loaded.profile}
          thread={loaded.thread}
          basePath={`/relationships/company/${loaded.companyId}`}
          stateLine={STATE_WORDS[loaded.relationship.state]}
          showList={showList}
        />
      </QSection>
    </>
  );
}
