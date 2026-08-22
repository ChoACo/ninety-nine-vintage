import { redirect } from "next/navigation";

export default async function StaffCompatibilityPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  redirect(`/admin/employee${path.length > 0 ? `/${path.join("/")}` : ""}`);
}
