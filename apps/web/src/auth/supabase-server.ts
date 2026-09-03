import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { loadWebServerConfig } from "@capital-q/config/web";

import { sessionCookieOptions } from "./cookie-options";

/**
 * The server-side Supabase Auth client for Server Components, server actions
 * and route handlers. A new instance per request: it reads the session from
 * the request cookies and writes refreshed or new session cookies back.
 *
 * Built from the project URL and the publishable key only. There is no
 * browser client in Capital Q and no admin client: nothing in the web app
 * holds a secret or service-role key, and nothing here can act as another
 * user or bypass RLS.
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const { auth } = loadWebServerConfig();
  const cookieStore = await cookies();

  return createServerClient(auth.supabase.url, auth.supabase.publishableKey, {
    cookieOptions: sessionCookieOptions(auth),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A Server Component cannot write cookies. The request proxy runs
          // before every protected page and performs the refresh there, so
          // a session never silently expires because a page could not write.
        }
      },
    },
  });
}
