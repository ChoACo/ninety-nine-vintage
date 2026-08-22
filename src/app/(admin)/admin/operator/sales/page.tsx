import { Suspense } from "react";
import { OperatorSalesConsole } from "@/components/admin/operator/OperatorSalesConsole";
import { SalesSkeleton } from "@/components/admin/operator/sales/SalesSkeleton";

export default function OperatorSalesPage() {
  return <Suspense fallback={<SalesSkeleton />}><OperatorSalesConsole /></Suspense>;
}
