/** A server-action transport failure does not mean a mutation failed on the server. */
export async function recoverableAction<T>(
  request: () => Promise<T>,
): Promise<T | { readonly ok: false; readonly message: string }> {
  try {
    return await request();
  } catch {
    return {
      ok: false,
      message:
        "The connection was interrupted. Your application has not been discarded. Retry to recover the recorded result.",
    };
  }
}
