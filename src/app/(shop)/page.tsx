import { redirect } from "next/navigation";
import { EntryGate } from "@/components/layout/EntryGate";
import { ENTRY_GATE_ENABLED } from "@/lib/featureFlags";

export default function EntryPage() {
  if (!ENTRY_GATE_ENABLED) redirect("/home");
  return <EntryGate />;
}
