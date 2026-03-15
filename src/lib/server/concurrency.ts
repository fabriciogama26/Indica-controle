import { NextResponse } from "next/server";

export type ConcurrencyConflictCode =
  | "CONCURRENT_MODIFICATION"
  | "RECORD_INACTIVE"
  | "STATUS_ALREADY_CHANGED";

export function normalizeExpectedUpdatedAt(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function hasUpdatedAtConflict(expectedUpdatedAt: string | null, currentUpdatedAt: string | null) {
  if (!expectedUpdatedAt || !currentUpdatedAt) {
    return false;
  }

  return expectedUpdatedAt !== currentUpdatedAt;
}

export function buildConcurrencyConflictResponse(
  message: string,
  code: ConcurrencyConflictCode = "CONCURRENT_MODIFICATION",
) {
  return NextResponse.json({ message, code }, { status: 409 });
}
