import { redirect } from "next/navigation";

/** The old "Find by handle" address, now the People tab of Search. */
export default async function FindPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly handle?: string | string[] }>;
} = {}) {
  const handle = (await searchParams)?.handle;
  redirect(
    typeof handle === "string" && handle.length > 0
      ? `/search?${new URLSearchParams({
          // A handle, so the palette opens that Q Card.
          q: handle.startsWith("@") ? handle : `@${handle}`,
        }).toString()}`
      : "/search",
  );
}
