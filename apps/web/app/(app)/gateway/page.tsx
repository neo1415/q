import { redirect } from "next/navigation";

/** The old Gateway page is now GateQ's "Your gate" tab (F2, 2026-10-06). */
export default function GatewayPage() {
  redirect("/gateq?tab=gate");
}
