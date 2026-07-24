export const TEMPORARY_MEMBER_OWNER_ID =
  "30be08c2-6259-42c6-af26-4ded6362de12";

export const OWNER_MEMBER_MODE_DURATION_MS = 3 * 60 * 1000;

export interface OwnerMemberModeState {
  active: boolean;
  eligible: boolean;
  expiresAt: string | null;
}
