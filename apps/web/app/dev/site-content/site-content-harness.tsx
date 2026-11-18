"use client";

import { useRef, useState } from "react";

import type { AdminSitePageDetailDto } from "@capital-q/contracts";

import {
  ContentEditor,
  type ContentEditorActions,
} from "@/features/site-content/editor/content-editor";

/**
 * The content editor over fictional in-memory actions, for design review
 * and the browser checks (apps/web/e2e/site-content.spec.ts). Saves bump
 * a revision, publish returns the next version; nothing leaves the page.
 * The last saved draft is exposed on `window.__cmsHarness` so a test can
 * read what the editor would have sent.
 */
export function SiteContentHarness({
  detail,
  slug,
}: {
  readonly detail: AdminSitePageDetailDto;
  readonly slug: string;
}) {
  const state = useRef({
    revision: detail.draft.revision,
    version: 1,
    saves: 0,
  });
  const [actions] = useState<Partial<ContentEditorActions>>(() => ({
    save: (_slug, input) => {
      state.current.revision += 1;
      state.current.saves += 1;
      Object.assign(window, {
        __cmsHarness: {
          saves: state.current.saves,
          blocks: input.blocks,
          title: input.title,
        },
      });
      return Promise.resolve({
        ok: true as const,
        value: {
          revision: state.current.revision,
          updatedAt: new Date().toISOString(),
        },
      });
    },
    publish: () => {
      state.current.version += 1;
      return Promise.resolve({
        ok: true as const,
        value: { versionNumber: state.current.version },
      });
    },
    unpublish: () => Promise.resolve({ ok: true as const, value: undefined }),
    restore: () => Promise.resolve({ ok: true as const, value: undefined }),
    loadVersion: () =>
      Promise.resolve({
        ok: true as const,
        value: {
          versionNumber: 1,
          title: detail.draft.title,
          summary: detail.draft.summary,
          blocks: detail.draft.blocks,
          createdAt: detail.draft.updatedAt,
        },
      }),
    upload: () => Promise.resolve(null),
  }));
  return (
    <ContentEditor
      detail={detail}
      slug={slug}
      actions={actions}
      imageSrc={() => "/icons/icon-512.png"}
    />
  );
}
