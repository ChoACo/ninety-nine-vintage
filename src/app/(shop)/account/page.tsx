import { DesktopAccountContent } from "@/components/features/account/DesktopAccountContent";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { NicknameGate } from "@/components/account/NicknameGate";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

export const dynamic = "force-dynamic";
export default function AccountPage() {
  return (
<MemberAccountBoundary>
      <NicknameGate />
      <StandaloneBackModal />
      <DesktopAccountContent />
    </MemberAccountBoundary>
  );
}
