"use client";

import { useToastStore } from "@/store/useToastStore";

export interface ClientErrorDetails {
  code?: string;
  error?: string;
  message: string;
  stage?: string;
  status?: number;
}

interface ClientErrorPayload {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  stage?: unknown;
}

export class ClientRequestError extends Error {
  readonly details: ClientErrorDetails;

  constructor(details: ClientErrorDetails) {
    super(details.message);
    this.name = "ClientRequestError";
    this.details = details;
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function clientErrorFromPayload(
  payload: unknown,
  fallback: string,
  status?: number,
) {
  const problem =
    payload && typeof payload === "object"
      ? (payload as ClientErrorPayload)
      : null;
  const error = optionalString(problem?.error);
  const code = optionalString(problem?.code) ?? error;
  const message = optionalString(problem?.message) ?? error ?? fallback;
  return new ClientRequestError({
    code,
    error,
    message,
    stage: optionalString(problem?.stage),
    status,
  });
}

export async function clientErrorFromResponse(
  response: Response,
  fallback: string,
) {
  const payload = await response.json().catch(() => null);
  return clientErrorFromPayload(payload, fallback, response.status);
}

export function getClientErrorDetails(error: unknown, fallback: string) {
  if (error instanceof ClientRequestError) return error.details;
  if (error instanceof Error) {
    return { message: error.message || fallback } satisfies ClientErrorDetails;
  }
  return { message: fallback } satisfies ClientErrorDetails;
}

interface ReportClientErrorOptions {
  dedupeKey?: string;
  dedupeMs?: number;
  fallback: string;
  userMessage?: string;
  visibility?: "always" | "development";
}

const lastReportedAt = new Map<string, number>();

function developmentMessage(details: ClientErrorDetails, fallback: string) {
  const context = [
    details.code ? `code=${details.code}` : null,
    details.error &&
    details.error !== details.code &&
    details.error !== details.message
      ? `error=${details.error}`
      : null,
    details.stage ? `stage=${details.stage}` : null,
    details.status ? `status=${details.status}` : null,
  ].filter(Boolean);
  const message = details.message || fallback;
  return context.length > 0 ? `${message} (${context.join(", ")})` : message;
}

export function reportClientError(
  error: unknown,
  {
    dedupeKey,
    dedupeMs = 12_000,
    fallback,
    userMessage,
    visibility = "development",
  }: ReportClientErrorOptions,
) {
  const details = getClientErrorDetails(error, fallback);
  const isDevelopment = process.env.NODE_ENV !== "production";

  if (isDevelopment) {
    console.error("client_request_failed", details, error);
  }
  if (visibility === "development" && !isDevelopment) return details;

  const key = dedupeKey ?? `${details.code ?? "unknown"}:${details.stage ?? "unknown"}:${fallback}`;
  const now = Date.now();
  const previous = lastReportedAt.get(key) ?? 0;
  if (now - previous < dedupeMs) return details;
  lastReportedAt.set(key, now);

  if (lastReportedAt.size > 100) {
    for (const [candidate, reportedAt] of lastReportedAt) {
      if (now - reportedAt > 60_000) lastReportedAt.delete(candidate);
    }
  }

  useToastStore.getState().pushToast(
    "error",
    isDevelopment
      ? developmentMessage(details, fallback)
      : (userMessage ?? fallback),
  );
  return details;
}
