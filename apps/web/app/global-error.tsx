"use client";

import { Button, buttonClassName } from "@capital-q/ui/button";

import { StatusPage } from "@/components/status-page";

import "./globals.css";

/**
 * The root layout itself failed. It replaces the whole document, so it
 * carries its own html and body; a full reload is the only safe recovery
 * (it also picks up a new build after a deploy).
 */
export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <StatusPage
          title="Capital Q couldn't load."
          description="Reload to try again. Nothing you saved is lost."
        >
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
          <a href="/home" className={buttonClassName("secondary")}>
            Go to Home
          </a>
        </StatusPage>
      </body>
    </html>
  );
}
