import "server-only";

import { ApiProblemError, getQCard } from "@capital-q/api-client";
import {
  COMPANY_CARD_FIELDS,
  INVESTOR_CARD_FIELDS,
  type QCardDto,
  type QCardSubjectType,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

import { cardFieldLabel, suggestHandle } from "./card-content";
import { appOrigin, displayUrlFor } from "./public-card-data";
import { QCard, type CardBrand } from "./q-card";
import { QCardPanel } from "./q-card-panel";
import { qrSvg } from "./qr";

/**
 * The Q Card slot on the profile page (BIZ-004). Reads the organisation's
 * own card under the person's session; none yet reads as "create one".
 * The preview is drawn from the owner's own declared values -- what the
 * owner sees, not what a stranger sees; the public page is one link away.
 */

async function loadCard(
  subjectType: QCardSubjectType,
  subjectId: string,
): Promise<QCardDto | null | "UNAVAILABLE"> {
  const session = await apiSession();
  if (session === null) return "UNAVAILABLE";
  try {
    return await getQCard(session, subjectType, subjectId);
  } catch (error) {
    if (error instanceof ApiProblemError && error.status === 404) return null;
    return "UNAVAILABLE";
  }
}

export async function QCardSection({
  subjectType,
  subjectId,
  name,
  tagline,
  brand,
}: {
  readonly subjectType: QCardSubjectType;
  readonly subjectId: string;
  readonly name: string;
  /** The owner's own one-liner, for the preview. */
  readonly tagline: string | null;
  /** BIZ-005 feeds this from the brand kit; absent uses Capital Q tokens. */
  readonly brand?: CardBrand | undefined;
}) {
  const card = await loadCard(subjectType, subjectId);
  if (card === "UNAVAILABLE") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        The Q Card couldn&apos;t load just now. Reload in a moment.
      </p>
    );
  }
  const nameField = subjectType === "COMPANY" ? "canonicalName" : "displayName";
  const fields = (
    subjectType === "COMPANY" ? COMPANY_CARD_FIELDS : INVESTOR_CARD_FIELDS
  )
    .filter((key) => key !== nameField)
    .map((key) => ({ key, label: cardFieldLabel(key) }));
  const handle = card?.handle ?? null;
  const origin = appOrigin();

  return (
    <QCardPanel
      subjectType={subjectType}
      subjectId={subjectId}
      name={name}
      suggestedHandle={suggestHandle(name)}
      card={card}
      cardUrl={handle === null ? null : `${origin}/@${handle}`}
      fields={fields}
      preview={
        card === null || handle === null ? null : (
          <QCard
            name={name}
            tagline={tagline}
            handle={handle}
            displayUrl={displayUrlFor(handle)}
            qrSvg={qrSvg(`${origin}/c/${card.publicCode}`)}
            brand={brand}
          />
        )
      }
    />
  );
}
