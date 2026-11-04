import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

/**
 * Where a document link opened in the browser lands when the document is
 * not there or not this person's (J7, 2026-11-04): the app's own
 * not-found page, never a raw refusal. One page for both, so it never
 * says whether a document exists.
 */
export default function DocumentUnavailable(): never {
  notFound();
}
