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
      ? `/search?${new URLSearchParams({ q: handle, tab: "people" }).toString()}`
      : "/search",
  );
}
