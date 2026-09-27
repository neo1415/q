import "server-only";

import { listRelationshipMail } from "@capital-q/api-client";
import type { RelationshipMailItem } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";
import { formatRelationshipDate } from "@/features/relationships/relationship-words";

/**
 * The person's own email on one relationship (BIZ-007): what they sent
 * from their connected Gmail after approving it, and the replies Capital Q
 * matched to it. Subjects and dates only; bodies of replies are never
 * read. Renders nothing when there is no mail or it cannot be read.
 */
export async function RelationshipMail({
  relationshipId,
  counterpart,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
}) {
  const session = await apiSession();
  if (session === null) return null;
  let items: readonly RelationshipMailItem[];
  try {
    items = (await listRelationshipMail(session, relationshipId)).items;
  } catch {
    return null;
  }
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="relationship-mail"
      className="flex flex-col gap-3"
    >
      <h2
        id="relationship-mail"
        className="cq-title-sm text-(--cq-text-primary)"
      >
        Email
      </h2>
      <ol
        className="flex max-w-(--cq-layout-reading) flex-col gap-3"
        data-relationship-mail
      >
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-0.5"
            data-mail={item.direction}
          >
            <time
              dateTime={item.occurredAt}
              className="cq-caption cq-numeric text-(--cq-text-tertiary)"
            >
              {formatRelationshipDate(item.occurredAt)}
            </time>
            <span className="cq-body text-(--cq-text-primary)">
              {item.direction === "INBOUND"
                ? `${counterpart} replied`
                : item.status === "SENT"
                  ? `You emailed ${counterpart}`
                  : item.status === "FAILED"
                    ? `Your email to ${counterpart} didn't send`
                    : `Your email to ${counterpart} is sending`}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {item.subject}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
