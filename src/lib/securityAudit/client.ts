import type { SupabaseClient } from "@supabase/supabase-js";

export type SecurityLogRequestStatus =
  | "awaiting_subject_consent"
  | "awaiting_owner_approval"
  | "approved"
  | "denied"
  | "revoked"
  | "expired";

export type SecurityConsentDecision = "approved" | "denied" | "not_required";
export type SecurityOwnerDecision = "approved" | "denied";

export interface SecurityLogAccessRequest {
  requestId: string;
  requesterDisplayName: string;
  subjectDisplayName: string;
  isRequester: boolean;
  isSubject: boolean;
  requestedFrom: string;
  requestedTo: string;
  reason: string;
  createdAt: string;
  requestExpiresAt: string;
  subjectDecision: SecurityConsentDecision | null;
  ownerDecision: SecurityOwnerDecision | null;
  accessExpiresAt: string | null;
  status: SecurityLogRequestStatus;
}

export interface MaskedSecurityActivity {
  logKey: string;
  occurredAt: string;
  category: string;
  eventType: string;
  action: string;
  source: string;
  actorLabel: string | null;
  subjectLabel: string | null;
  entityType: string | null;
  entityIdMasked: string | null;
  severity: "info" | "notice" | "warning" | "critical";
  ipAddressMasked: string | null;
  userAgentMasked: string | null;
  metadata: Record<string, unknown>;
}

export interface OwnerSecurityActivity {
  logKey: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  subjectUserId: string | null;
  subjectDisplayName: string | null;
  category: string;
  eventType: string;
  action: string;
  source: string;
  entityType: string | null;
  entityId: string | null;
  severity: "info" | "notice" | "warning" | "critical";
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface OwnerSecurityLogAccessRequest
  extends SecurityLogAccessRequest {
  requesterUserId: string;
  subjectUserId: string;
}

export interface OwnerSecuritySession {
  sessionRecordId: string;
  userId: string;
  displayName: string | null;
  authSessionId: string | null;
  browserTabSessionId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  latestIp: string;
  latestUserAgent: string | null;
  lastEvent: "session_started" | "session_resumed" | "heartbeat";
  lastOutcome: "allowed" | "blocked";
  matchedRuleId: string | null;
}

export interface OwnerSecuritySessionIpHistory {
  historyId: number;
  sessionRecordId: string;
  userId: string;
  displayName: string | null;
  ipAddress: string;
  userAgent: string | null;
  eventType: "session_started" | "session_resumed" | "heartbeat";
  outcome: "allowed" | "blocked";
  matchedRuleId: string | null;
  observedAt: string;
}

export interface OwnerIpBlockRule {
  ruleId: string;
  network: string;
  label: string | null;
  reason: string;
  enabled: boolean;
  expiresAt: string | null;
  archivedAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestSecurityLogAccessInput {
  reason: string;
  from: string;
  to: string;
  /** Exact public nickname. Omit for the signed-in member's own logs. */
  subjectDisplayName?: string;
}

export interface OwnerActivityFilters {
  /** Required operational purpose; the raw-log read is itself audited. */
  reason: string;
  userId?: string;
  category?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface OwnerLogRequestFilters {
  /** Required operational purpose; viewing the approval queue is audited. */
  reason: string;
  status?: SecurityLogRequestStatus;
  userId?: string;
  limit?: number;
  offset?: number;
}

export interface OwnerSessionFilters {
  /** Required operational purpose; the raw IP/session read is itself audited. */
  reason: string;
  userId?: string;
  ip?: string;
  outcome?: "allowed" | "blocked";
  limit?: number;
  offset?: number;
}

export interface CreateOwnerIpBlockRuleInput {
  network: string;
  reason: string;
  label?: string | null;
  expiresAt?: string | null;
}

export interface UpdateOwnerIpBlockRuleInput {
  /** Required audit reason for this specific enable/disable/edit/archive action. */
  changeReason: string;
  network?: string;
  reason?: string;
  label?: string | null;
  enabled?: boolean;
  expiresAt?: string | null;
  archive?: boolean;
}

type SnakeRow = Record<string, unknown>;

export class SecurityAuditError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, options?: { cause?: unknown; status?: number }) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SecurityAuditError";
    this.code = code;
    this.status = options?.status;
  }
}

function stringValue(row: SnakeRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new SecurityAuditError("invalid_security_response");
  return value;
}

function nullableString(row: SnakeRow, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new SecurityAuditError("invalid_security_response");
  return value;
}

function booleanValue(row: SnakeRow, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") throw new SecurityAuditError("invalid_security_response");
  return value;
}

function objectValue(row: SnakeRow, key: string): Record<string, unknown> {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toLogRequest(row: SnakeRow): SecurityLogAccessRequest {
  return {
    requestId: stringValue(row, "request_id"),
    requesterDisplayName: stringValue(row, "requester_display_name"),
    subjectDisplayName: stringValue(row, "subject_display_name"),
    isRequester: booleanValue(row, "is_requester"),
    isSubject: booleanValue(row, "is_subject"),
    requestedFrom: stringValue(row, "requested_from"),
    requestedTo: stringValue(row, "requested_to"),
    reason: stringValue(row, "reason"),
    createdAt: stringValue(row, "created_at"),
    requestExpiresAt: stringValue(row, "request_expires_at"),
    subjectDecision: nullableString(row, "subject_decision") as SecurityConsentDecision | null,
    ownerDecision: nullableString(row, "owner_decision") as SecurityOwnerDecision | null,
    accessExpiresAt: nullableString(row, "access_expires_at"),
    status: stringValue(row, "status") as SecurityLogRequestStatus,
  };
}

function toMaskedActivity(row: SnakeRow): MaskedSecurityActivity {
  return {
    logKey: stringValue(row, "log_key"),
    occurredAt: stringValue(row, "occurred_at"),
    category: stringValue(row, "category"),
    eventType: stringValue(row, "event_type"),
    action: stringValue(row, "action"),
    source: stringValue(row, "source"),
    actorLabel: nullableString(row, "actor_label"),
    subjectLabel: nullableString(row, "subject_label"),
    entityType: nullableString(row, "entity_type"),
    entityIdMasked: nullableString(row, "entity_id_masked"),
    severity: stringValue(row, "severity") as MaskedSecurityActivity["severity"],
    ipAddressMasked: nullableString(row, "ip_address_masked"),
    userAgentMasked: nullableString(row, "user_agent_masked"),
    metadata: objectValue(row, "metadata"),
  };
}

function toOwnerActivity(row: SnakeRow): OwnerSecurityActivity {
  return {
    logKey: stringValue(row, "log_key"),
    actorUserId: nullableString(row, "actor_user_id"),
    actorDisplayName: nullableString(row, "actor_display_name"),
    subjectUserId: nullableString(row, "subject_user_id"),
    subjectDisplayName: nullableString(row, "subject_display_name"),
    category: stringValue(row, "category"),
    eventType: stringValue(row, "event_type"),
    action: stringValue(row, "action"),
    source: stringValue(row, "source"),
    entityType: nullableString(row, "entity_type"),
    entityId: nullableString(row, "entity_id"),
    severity: stringValue(row, "severity") as OwnerSecurityActivity["severity"],
    ipAddress: nullableString(row, "ip_address"),
    userAgent: nullableString(row, "user_agent"),
    metadata: objectValue(row, "metadata"),
    occurredAt: stringValue(row, "occurred_at"),
  };
}

function toOwnerRequest(row: SnakeRow): OwnerSecurityLogAccessRequest {
  return {
    ...toLogRequest(row),
    requesterUserId: stringValue(row, "requester_user_id"),
    subjectUserId: stringValue(row, "subject_user_id"),
  };
}

function toOwnerSession(row: SnakeRow): OwnerSecuritySession {
  return {
    sessionRecordId: stringValue(row, "session_record_id"),
    userId: stringValue(row, "user_id"),
    displayName: nullableString(row, "display_name"),
    authSessionId: nullableString(row, "auth_session_id"),
    browserTabSessionId: stringValue(row, "browser_tab_session_id"),
    firstSeenAt: stringValue(row, "first_seen_at"),
    lastSeenAt: stringValue(row, "last_seen_at"),
    latestIp: stringValue(row, "latest_ip"),
    latestUserAgent: nullableString(row, "latest_user_agent"),
    lastEvent: stringValue(row, "last_event") as OwnerSecuritySession["lastEvent"],
    lastOutcome: stringValue(row, "last_outcome") as OwnerSecuritySession["lastOutcome"],
    matchedRuleId: nullableString(row, "matched_rule_id"),
  };
}

function toOwnerSessionHistory(row: SnakeRow): OwnerSecuritySessionIpHistory {
  const historyId = Number(row.history_id);
  if (!Number.isSafeInteger(historyId) || historyId < 1) {
    throw new SecurityAuditError("invalid_security_response");
  }
  return {
    historyId,
    sessionRecordId: stringValue(row, "session_record_id"),
    userId: stringValue(row, "user_id"),
    displayName: nullableString(row, "display_name"),
    ipAddress: stringValue(row, "ip_address"),
    userAgent: nullableString(row, "user_agent"),
    eventType: stringValue(row, "event_type") as OwnerSecuritySessionIpHistory["eventType"],
    outcome: stringValue(row, "outcome") as OwnerSecuritySessionIpHistory["outcome"],
    matchedRuleId: nullableString(row, "matched_rule_id"),
    observedAt: stringValue(row, "observed_at"),
  };
}

function toIpRule(row: SnakeRow): OwnerIpBlockRule {
  return {
    ruleId: stringValue(row, "rule_id"),
    network: stringValue(row, "network"),
    label: nullableString(row, "label"),
    reason: stringValue(row, "reason"),
    enabled: booleanValue(row, "enabled"),
    expiresAt: nullableString(row, "expires_at"),
    archivedAt: nullableString(row, "archived_at"),
    createdBy: stringValue(row, "created_by"),
    updatedBy: stringValue(row, "updated_by"),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
  };
}

async function rpcRows(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown> = {},
): Promise<SnakeRow[]> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw new SecurityAuditError(error.code ?? "security_rpc_failed", { cause: error });
  return Array.isArray(data) ? (data as SnakeRow[]) : [];
}

export async function requestSecurityLogAccess(
  client: SupabaseClient,
  input: RequestSecurityLogAccessInput,
): Promise<string> {
  const { data, error } = await client.rpc("request_security_log_access", {
    p_reason: input.reason,
    p_requested_from: input.from,
    p_requested_to: input.to,
    p_subject_display_name: input.subjectDisplayName?.trim() || null,
  });
  if (error) throw new SecurityAuditError(error.code ?? "security_request_failed", { cause: error });
  if (typeof data !== "string") throw new SecurityAuditError("invalid_security_response");
  return data;
}

export async function listMySecurityLogAccessRequests(
  client: SupabaseClient,
): Promise<SecurityLogAccessRequest[]> {
  return (await rpcRows(client, "list_my_security_log_access_requests")).map(toLogRequest);
}

export async function respondSecurityLogSubjectConsent(
  client: SupabaseClient,
  requestId: string,
  approved: boolean,
  note?: string,
): Promise<void> {
  const { error } = await client.rpc("respond_security_log_subject_consent", {
    p_request_id: requestId,
    p_approved: approved,
    p_note: note?.trim() || null,
  });
  if (error) throw new SecurityAuditError(error.code ?? "security_consent_failed", { cause: error });
}

export async function getApprovedMaskedSecurityLogs(
  client: SupabaseClient,
  requestId: string,
  limit = 100,
  offset = 0,
): Promise<MaskedSecurityActivity[]> {
  return (await rpcRows(client, "get_approved_masked_security_logs", {
    p_request_id: requestId,
    p_limit: limit,
    p_offset: offset,
  })).map(toMaskedActivity);
}

export async function revokeSecurityLogAccess(
  client: SupabaseClient,
  requestId: string,
  reason: string,
): Promise<void> {
  const { error } = await client.rpc("revoke_security_log_access", {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw new SecurityAuditError(error.code ?? "security_revoke_failed", { cause: error });
}

async function apiRequest<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new SecurityAuditError(payload?.error ?? "security_api_failed", {
      status: response.status,
    });
  }
  return payload;
}

export async function listOwnerSecurityActivity(
  accessToken: string,
  filters: OwnerActivityFilters,
): Promise<OwnerSecurityActivity[]> {
  const payload = await apiRequest<{ items: SnakeRow[] }>(
    accessToken,
    "/api/owner/security/activity",
    { method: "POST", body: JSON.stringify({ action: "list", ...filters }) },
  );
  return payload.items.map(toOwnerActivity);
}

export async function listOwnerSecurityLogRequests(
  accessToken: string,
  filters: OwnerLogRequestFilters,
): Promise<OwnerSecurityLogAccessRequest[]> {
  const payload = await apiRequest<{ items: SnakeRow[] }>(
    accessToken,
    "/api/owner/security/requests",
    { method: "POST", body: JSON.stringify({ action: "list", ...filters }) },
  );
  return payload.items.map(toOwnerRequest);
}

export async function decideOwnerSecurityLogRequest(
  accessToken: string,
  requestId: string,
  approved: boolean,
  note: string,
  accessHours = 24,
): Promise<void> {
  await apiRequest<{ decided: true }>(accessToken, "/api/owner/security/requests", {
    method: "POST",
    body: JSON.stringify({ requestId, approved, note, accessHours }),
  });
}

export async function revokeOwnerSecurityLogAccess(
  accessToken: string,
  requestId: string,
  reason: string,
): Promise<void> {
  await apiRequest<{ revoked: true }>(accessToken, "/api/owner/security/requests", {
    method: "POST",
    body: JSON.stringify({ action: "revoke", requestId, reason }),
  });
}

export async function listOwnerSecuritySessions(
  accessToken: string,
  filters: OwnerSessionFilters,
): Promise<OwnerSecuritySession[]> {
  const payload = await apiRequest<{ items: SnakeRow[] }>(
    accessToken,
    "/api/owner/security/sessions",
    { method: "POST", body: JSON.stringify({ action: "list", ...filters }) },
  );
  return payload.items.map(toOwnerSession);
}

export async function listOwnerSecuritySessionHistory(
  accessToken: string,
  sessionRecordId: string,
  reason: string,
  limit = 100,
  offset = 0,
): Promise<OwnerSecuritySessionIpHistory[]> {
  const payload = await apiRequest<{ items: SnakeRow[] }>(
    accessToken,
    "/api/owner/security/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        action: "history",
        sessionRecordId,
        reason,
        limit,
        offset,
      }),
    },
  );
  return payload.items.map(toOwnerSessionHistory);
}

export async function listOwnerIpBlockRules(
  accessToken: string,
  reason: string,
): Promise<OwnerIpBlockRule[]> {
  const payload = await apiRequest<{ items: SnakeRow[] }>(
    accessToken,
    "/api/owner/security/ip-blocks",
    { method: "POST", body: JSON.stringify({ action: "list", reason }) },
  );
  return payload.items.map(toIpRule);
}

export async function createOwnerIpBlockRule(
  accessToken: string,
  input: CreateOwnerIpBlockRuleInput,
): Promise<string> {
  const payload = await apiRequest<{ ruleId: string }>(
    accessToken,
    "/api/owner/security/ip-blocks",
    { method: "POST", body: JSON.stringify({ action: "create", ...input }) },
  );
  return payload.ruleId;
}

export async function updateOwnerIpBlockRule(
  accessToken: string,
  ruleId: string,
  input: UpdateOwnerIpBlockRuleInput,
): Promise<void> {
  await apiRequest<{ updated: true }>(accessToken, "/api/owner/security/ip-blocks", {
    method: "PATCH",
    body: JSON.stringify({ ruleId, ...input }),
  });
}

export function getOrCreateSecurityClientSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const key = "ninety-nine:security-session-id";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

export async function recordSecuritySession(
  accessToken: string,
  input: {
    clientSessionId: string;
    event: "session_started" | "session_resumed" | "heartbeat";
  },
): Promise<{ allowed: true; sessionRecordId: string; recorded: boolean }> {
  return apiRequest(accessToken, "/api/security/session", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
