import { OnboardingChatPanel } from "@/components/features/chat/OnboardingChatPanel";

export const dynamic = "force-dynamic";

export default function OwnerOnboardingPage() {
  return <OnboardingChatPanel audience="owner" />;
}
