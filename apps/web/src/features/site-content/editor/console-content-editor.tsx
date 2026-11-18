"use client";

import type { AdminSitePageDetailDto } from "@capital-q/contracts";

import { ContentEditor } from "./content-editor";
import { uploadSiteImage } from "./upload-image";

const CONSOLE_ACTIONS = { upload: uploadSiteImage } as const;

/** The editor as the console runs it: server actions and real uploads. */
export function ConsoleContentEditor({
  detail,
  slug,
}: {
  readonly detail: AdminSitePageDetailDto;
  readonly slug: string;
}) {
  return (
    <ContentEditor detail={detail} slug={slug} actions={CONSOLE_ACTIONS} />
  );
}
