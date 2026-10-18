import { QConversationPanel } from "@/features/q/q-conversation";

/** The Q page, bare: the real panel, as a bare /home renders it. */
export default function QNavQPage() {
  return (
    <section aria-label="Ask Q" className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Q</h1>
      <QConversationPanel
        connected={false}
        context={{ scope: "unset", suggestions: [] }}
        conversationId={null}
      />
    </section>
  );
}
