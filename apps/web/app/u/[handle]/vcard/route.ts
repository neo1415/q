import { NextResponse } from "next/server";

import { appOrigin, loadPublicCard } from "@/features/q-card/public-card-data";
import { cardTagline } from "@/features/q-card/card-content";
import { buildVCard } from "@/features/q-card/vcard";

export const dynamic = "force-dynamic";

/**
 * `/@handle.vcf` (BIZ-004, through a rewrite): the card as a vCard 3.0
 * contact. Public fields only, never indexed, never shared-cached (the
 * projection can differ for a signed-in participant, and the file must not
 * carry one visitor's audience to another).
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly handle: string }> },
) {
  const { handle } = await params;
  const result = await loadPublicCard(handle);
  if (result === null) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex" },
    });
  }
  if (result.kind === "REDIRECT") {
    return NextResponse.redirect(`${appOrigin()}/@${result.handle}.vcf`, 308);
  }
  const publicFields = result.fields.filter(
    (field) => field.scope === "public_external",
  );
  const website =
    publicFields.find((field) => field.key === "websiteUrl")?.value ?? null;
  const body = buildVCard({
    name: result.name,
    cardUrl: `${appOrigin()}/@${result.handle}`,
    websiteUrl: website,
    note: cardTagline(result.subjectType, publicFields),
  });
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.handle}.vcf"`,
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    },
  });
}
