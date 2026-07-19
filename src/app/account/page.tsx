import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { OrderHistory } from "@/components/features/account/OrderHistory";

export const dynamic = "force-dynamic";
export default function AccountPage() { return <><AccountDashboard /><OrderHistory /></>; }
