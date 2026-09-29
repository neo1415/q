"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@capital-q/ui/button";

import { openGatewayAction } from "./gateway-actions";

/** One press opens the organisation's gateway, then the page shows it. */
export function OpenGatewayButton() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await openGatewayAction();
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            router.refresh();
          })
        }
      >
        {pending ? "Opening…" : "Open my gateway"}
      </Button>
      {message === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </span>
      )}
    </div>
  );
}

/** Copies one exact string; says so for a moment. */
export function CopyButton({
  text,
  label,
}: {
  readonly text: string;
  readonly label: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="compact"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
