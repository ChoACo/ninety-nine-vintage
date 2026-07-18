"use client";

export const MEMBER_ACCOUNT_CHANGED_EVENT = "nnv:member-account-changed";

export interface MemberAccountChangedDetail {
  memberId: string;
  productId?: string;
}

export function notifyMemberAccountChanged(
  memberId: string,
  productId?: string,
): void {
  window.dispatchEvent(
    new CustomEvent<MemberAccountChangedDetail>(MEMBER_ACCOUNT_CHANGED_EVENT, {
      detail: { memberId, productId },
    }),
  );
}
