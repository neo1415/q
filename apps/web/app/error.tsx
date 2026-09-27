"use client";

import { useEffect } from "react";

import { Button, buttonClassName } from "@capital-q/ui/button";

import { StatusPage } from "@/components/status-page";

/**
 * A page that failed to render. The commonest cause on a live site is a
 * deploy landing mid-visit: the page asks for a script the new build no
 * longer has (a ChunkLoadError). Loading the page again fetches the new
 * build, so that case reloads the document rather than retrying in place.
 */
function isStaleBuild(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(
      error.message,
    )
  );
}

export default function PageError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  const stale = isStaleBuild(error);
  useEffect(() => {
    // The digest only: a message can carry user data.
    console.error("page error", error.digest ?? error.name);
  }, [error]);
  return (
    <StatusPage
      title={stale ? "Capital Q was just updated." : "This page couldn't load."}
      description={
        stale
          ? "Reload to get the latest version. Nothing you saved is lost."
          : "Something went wrong on our side. Nothing you saved is lost; try again in a moment."
      }
    >
      <Button
        variant="primary"
        onClick={() => {
          if (stale) window.location.reload();
          else reset();
        }}
      >
        {stale ? "Reload" : "Try again"}
      </Button>
      <a href="/home" className={buttonClassName("secondary")}>
        Go to Home
      </a>
    </StatusPage>
  );
}
