import type { ProfileImageSubjectType } from "@capital-q/contracts";

import { WhenAllowed } from "@/features/organisation/capabilities";
import { CAP } from "@/features/organisation/role-words";

import { ProfileImageEditor } from "./profile-image-editor";

/**
 * The organisation's own logo and cover: what its Q Card shows (through
 * the card's photo and cover settings). Each opens a sheet to upload,
 * replace or remove it.
 */
export function OrganisationImages({
  subjectType,
  subjectId,
  name,
  avatarUrl,
  coverUrl,
  open,
}: {
  readonly subjectType: ProfileImageSubjectType;
  readonly subjectId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly coverUrl: string | null;
  /** Design review only: the sheet that opens on its own. */
  readonly open?: "photo" | "logo" | "cover" | undefined;
}) {
  // A member sees the logo and cover; changing them is an admin's (the
  // upload path authorises again).
  const editCapability =
    subjectType === "COMPANY" ? CAP.COMPANY_EDIT : CAP.INVESTOR_EDIT;
  return (
    <div
      className="flex flex-col gap-0.5 border-t border-(--cq-border-subtle) py-2.5 sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-0"
      data-organisation-images
    >
      <span className="text-[13px] text-(--cq-text-secondary) sm:pt-2.5">
        Logo and cover
      </span>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="size-14 overflow-hidden rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle)">
            {avatarUrl === null ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
              <img
                src={avatarUrl}
                alt="Logo"
                className="size-full object-cover"
              />
            )}
          </div>
          <div className="absolute -end-1.5 -bottom-1.5">
            <WhenAllowed capability={editCapability}>
              <ProfileImageEditor
                subjectType={subjectType}
                subjectId={subjectId}
                kind="AVATAR"
                label="logo"
                hasImage={avatarUrl !== null}
                previewUrl={avatarUrl}
                previewName={name}
                square
                compact
                initiallyOpen={open === "logo"}
              />
            </WhenAllowed>
          </div>
        </div>
        <div className="relative aspect-[4/1] h-14 min-w-0 overflow-hidden rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-strong)">
          {coverUrl === null ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, browser to storage directly
            <img src={coverUrl} alt="" className="size-full object-cover" />
          )}
          <div className="absolute top-1/2 end-2 -translate-y-1/2">
            <WhenAllowed capability={editCapability}>
              <ProfileImageEditor
                subjectType={subjectType}
                subjectId={subjectId}
                kind="COVER"
                label="cover"
                hasImage={coverUrl !== null}
                previewUrl={coverUrl}
                compact
                initiallyOpen={open === "cover"}
              />
            </WhenAllowed>
          </div>
        </div>
      </div>
    </div>
  );
}
