/**
 * Why the microphone could not be opened. Only a refusal (permission, or a
 * page the browser will not let capture) is "microphone": the person must
 * act. Anything else -- the device is busy because a call is still letting
 * it go, it was unplugged, the request was aborted -- is "interrupted", and
 * the listener tries again on its own.
 */
export function microphoneFailure(
  error: unknown,
): "microphone" | "interrupted" {
  const name: unknown =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "name")
      : undefined;
  return name === "NotAllowedError" || name === "SecurityError"
    ? "microphone"
    : "interrupted";
}
