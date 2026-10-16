import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { readAdminBreakGlassChat } from "@capital-q/api-client";
import { InlineNotice } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { when } from "@/features/admin/words";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Conversation · Admin" };

/**
 * A private conversation under an approved break-glass request. Only the
 * person who asked can open it, only until it expires; this read is
 * logged by the API.
 */
export default async function BreakGlassChatPage({
  params,
}: {
  readonly params: Promise<{ readonly requestId: string }>;
}) {
  const t = await serverT();

  const context = await adminContext();
  if (context === null || !context.can("breakglass.request")) notFound();
  const { requestId } = await params;
  const chat = await readAdminBreakGlassChat(context.session, requestId).catch(
    () => null,
  );
  if (chat === null) notFound();
  return (
    <PageSection
      id="chat"
      title={t(`${chat.companyName} ↔ ${chat.investorName}`)}
    >
      <div className="flex flex-col gap-4">
        <InlineNotice tone="warning" title={t("Private conversation")}>
          {t("Opened for: “")}
          {t(chat.reason)}
          {t("”. Access ends")} {t(when(chat.expiresAt))}
          {t(". This read is logged.")}
        </InlineNotice>
        {chat.messages.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t("No messages.")}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {chat.messages.map((message) => (
              <li key={message.messageId} className="flex flex-col gap-0.5">
                <span className="cq-caption text-(--cq-text-secondary)">
                  {message.senderName ?? t("A member")} (
                  {message.side === "COMPANY" ? "company" : "investor"}) ·{" "}
                  {t(when(message.at))}
                </span>
                <span className="cq-body-sm whitespace-pre-wrap text-(--cq-text-primary)">
                  {t(message.body ?? message.attachmentTitle ?? "(attachment)")}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </PageSection>
  );
}
