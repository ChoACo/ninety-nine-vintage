import { OperatorChatConsole } from "@/components/admin/operator/OperatorChatConsole";

export default function EmployeeInquiriesPage() {
  return (
    <OperatorChatConsole
      basePath="/admin/employee/inquiries"
      requiresStoreScope={false}
      staffLabel="직원센터"
    />
  );
}
