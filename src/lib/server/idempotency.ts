// src/lib/server/idempotency.ts
// Generic idempotency wrapper for critical POST/PUT/PATCH Route Handlers.
//
// Usage:
//   return withIdempotency(req, tenantId, actorUserId, '/api/foo:ACTION', () => handler(req))
//
// The caller sends an `Idempotency-Key` header (UUID recommended), generated
// once per user action and reused across retries of that same attempt.
// On the first call the handler runs and the response is cached (TTL 24h)
// together with a hash of the raw request body.
// On retries within TTL with the SAME body, the cached response is returned
// with header `Idempotency-Replayed: true`, without re-running the handler.
// If the same key arrives with a DIFFERENT body, the request is rejected
// with 409 — the key is never replayed against a payload it wasn't cached
// for (guia_backend.md regra 17: chave por tenant + usuario + rota + hash
// do request, nunca reutilizada com payload diferente).
//
// 5xx responses are never cached — they are transient and should be retried.
// Any DB error in the idempotency layer is silently ignored so the handler
// always runs when the cache cannot be consulted.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const TTL_HOURS = 24;
const HEADERS = ["idempotency-key", "Idempotency-Key"] as const;

async function hashRequestBody(req: Request): Promise<string> {
  // arrayBuffer (not text) so binary bodies (e.g. multipart file upload) hash
  // correctly instead of risking lossy UTF-8 replacement-character collisions.
  const raw = await req
    .clone()
    .arrayBuffer()
    .catch(() => new ArrayBuffer(0));
  return createHash("sha256").update(Buffer.from(raw)).digest("hex");
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type IdempotencyLookupRow = {
  response_status: number;
  response_body: unknown;
  request_hash: string | null;
};

async function lookup(
  tenantId: string,
  actorUserId: string | null,
  key: string,
  endpoint: string,
): Promise<IdempotencyLookupRow | null> {
  try {
    let query = serviceClient()
      .from("idempotency_requests")
      .select("response_status, response_body, request_hash")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", key)
      .eq("endpoint", endpoint)
      .gte("expires_at", new Date().toISOString());
    query = actorUserId ? query.eq("actor_user_id", actorUserId) : query.is("actor_user_id", null);
    const { data } = await query.maybeSingle();
    if (!data) return null;
    return data as IdempotencyLookupRow;
  } catch {
    return null;
  }
}

async function store(
  tenantId: string,
  actorUserId: string | null,
  key: string,
  endpoint: string,
  requestHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TTL_HOURS);
    await serviceClient()
      .from("idempotency_requests")
      .upsert(
        {
          tenant_id: tenantId,
          actor_user_id: actorUserId,
          idempotency_key: key,
          endpoint,
          request_hash: requestHash,
          response_status: status,
          response_body: body,
          expires_at: expiresAt.toISOString(),
        },
        {
          onConflict: "tenant_id,actor_user_id,idempotency_key,endpoint",
          ignoreDuplicates: true,
        },
      );
  } catch {
    // Never block the caller on idempotency store failures.
  }
}

function conflictResponse(): Response {
  return new Response(
    JSON.stringify({
      message: "Esta chave de idempotencia ja foi usada com um payload diferente.",
      code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
    }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Wraps a Route Handler with idempotency support.
 *
 * @param req         - The incoming Request (cloned to read header + hash the body; original stream is left untouched for `handler`).
 * @param tenantId    - The authenticated tenant ID for key scoping. Pass `null` to bypass idempotency (handler runs normally).
 * @param actorUserId - The authenticated app_users.id for key scoping. Pass `null` when unavailable (bypass still requires tenantId).
 * @param endpoint    - Stable operation identifier, e.g. '/api/programacao:BATCH_CREATE'.
 * @param handler     - Async function that performs the actual operation.
 */
export async function withIdempotency(
  req: Request,
  tenantId: string | null,
  actorUserId: string | null,
  endpoint: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get(HEADERS[0]) ?? req.headers.get(HEADERS[1]);

  if (!key || !tenantId) {
    return handler();
  }

  const requestHash = await hashRequestBody(req);
  const cached = await lookup(tenantId, actorUserId, key, endpoint);
  if (cached) {
    if (cached.request_hash && cached.request_hash !== requestHash) {
      return conflictResponse();
    }
    return new Response(JSON.stringify(cached.response_body), {
      status: cached.response_status,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Replayed": "true",
      },
    });
  }

  const response = await handler();

  if (response.status < 500) {
    try {
      const body: unknown = await response.clone().json();
      await store(tenantId, actorUserId, key, endpoint, requestHash, response.status, body);
    } catch {
      // Non-JSON body or clone failure — skip caching.
    }
  }

  return response;
}
