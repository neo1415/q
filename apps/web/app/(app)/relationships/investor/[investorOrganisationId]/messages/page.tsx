import type { Metadata } from "next";

import { QSection } from "@/features/q/q-section";
import { QPageSubject } from "@/features/q/q-subject";
import { RelationshipInbox } from "@/features/relationships/relationship-inbox";
import { RelationshipUnavailable } from "@/features/relationships/relationship-detail";
import { messageCountOf } from "@/features/relationships/brief-lines";
import { loadCompanySideRelationship } from "@/features/relationships/relationship-page-data";
import { STATE_WORDS } from "@/features/relationships/relationship-words";
import { serverT, serverUiLanguage } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Messages") };
}
export const dynamic = "force-dynamic";

/**
 * A company's conversations, with the one with this investor organisation
 * open (R34; inbox split, 2026-10-20). Before both sides agree to connect
 * the pane says why it is empty and when it opens.
 */
export default async function CompanyConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly investorOrganisationId: string }>;
  readonly searchParams?: Promise<{ readonly inbox?: string }> | undefined;
}) {
  await serverUiLanguage();
  const t = await serverT();

  const { investorOrganisationId } = await params;
  const showList = (await searchParams)?.inbox === "1";
  const loaded = await loadCompanySideRelationship(investorOrganisationId);
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
        refs={[{ kind: "INVESTOR_ORGANISATION", id: investorOrganisationId }]}
        total={messageCountOf(loaded)}
        label={t(`chat with ${loaded.counterpart} open`)}
      >
        <RelationshipInbox
          counterpart={loaded.counterpart}
          relationship={loaded.relationship}
          profile={loaded.profile}
          thread={loaded.thread}
          basePath={`/relationships/investor/${investorOrganisationId}`}
          stateLine={STATE_WORDS[loaded.relationship.state]}
          showList={showList}
        />
      </QSection>
    </>
  );
}
