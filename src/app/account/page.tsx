import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";
import { AccountSessionPanel } from "@/components/features/account/AccountSessionPanel";

export const dynamic = "force-dynamic";
export default function AccountPage() { return <><AccountDashboard /><AccountSessionPanel /><BidHistory /><OrderHistory /></>; }
