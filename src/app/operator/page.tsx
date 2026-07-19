import Link from "next/link";
import { OperatorConsole } from "@/components/features/operator/OperatorConsole";

export const dynamic = "force-dynamic";
export default function OperatorPage() { return <div><div className="mb-8 flex gap-3 border-b border-line pb-4 text-xs font-bold"><Link className="border-b-2 border-ink pb-4" href="/operator">OVERVIEW</Link><Link className="text-muted" href="/operator/products">PRODUCTS</Link><Link className="text-muted" href="/operator/orders">ORDERS</Link><Link className="text-muted" href="/operator/shipping">SHIPPING</Link><Link className="text-muted" href="/operator/chat">CHAT</Link></div><OperatorConsole /></div>; }
