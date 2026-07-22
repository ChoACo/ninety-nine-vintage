import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";

export const dynamic = "force-dynamic";
export default function AccountPage() { return <><AccountDashboard surface="desktop" /><BidHistory surface="desktop" /><OrderHistory surface="desktop" /></>; }
