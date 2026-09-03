import { InlineNotice, type NoticeTone } from "@capital-q/ui/states";

/** A calm, associated message. Errors announce themselves (role=alert). */
export function FormNotice({
  tone,
  children,
}: {
  readonly tone: NoticeTone;
  readonly children: string;
}) {
  return <InlineNotice tone={tone}>{children}</InlineNotice>;
}
