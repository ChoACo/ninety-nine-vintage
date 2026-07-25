export interface MobileRoleNavigation {
  centerHref: string;
  centerLabel: string;
  chatHref: string;
  chatLabel: string;
  isStaff: boolean;
}

export function getMobileRoleNavigation(
  roleCode: string,
): MobileRoleNavigation {
  if (roleCode === "operator") {
    return {
      centerHref: "/admin/operator",
      centerLabel: "운영자센터",
      chatHref: "/admin/operator/chat",
      chatLabel: "매장 채팅",
      isStaff: true,
    };
  }
  if (roleCode === "employee") {
    return {
      centerHref: "/admin/employee",
      centerLabel: "직원센터",
      chatHref: "/admin/employee/inquiries",
      chatLabel: "매장 채팅",
      isStaff: true,
    };
  }
  if (roleCode === "owner") {
    return {
      centerHref: "/admin/owner",
      centerLabel: "소유자센터",
      chatHref: "/m/chat",
      chatLabel: "상담·채팅",
      isStaff: true,
    };
  }
  return {
    centerHref: "/m/account",
    centerLabel: "내 정보",
    chatHref: "/m/chat",
    chatLabel: "상담·채팅",
    isStaff: false,
  };
}
