// src/lib/server/idempotency.ts
// Generic idempotency wrapper for critical POST/PUT/PATCH Route Handlers.
//
// Usage:
//   return withIdempotency(req, tenantId, '/api/foo:ACTION', () => handler(req))
//
// The caller sends an `Idempotency-Key` header (UUID recommended).
// On the first call the handler runs and the response is cached (TTL 24h).
// On retries within TTL the cached response is returned with header
// `Idempotency-Replayed: true`, without re-running the handler.
//
// 5xx responses are never cached — they are transient and should be retried.
// Any DB error in the idempotency layer is silently ignored so the handler
// always runs when the cache cannot be consulted.

import { createClient } from "@supabase/supabase-js";

const TTL_HOURS = 24;
const HEADERS = ["idempotency-key", "Idempotency-Key"] as const;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function lookup(
  tenantId: string,
  key: string,
  endpoint: string,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const { data } = await serviceClient()
      .from("idempotency_requests")
      .select("response_status, response_body")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", key)
      .eq("endpoint", endpoint)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!data) return null;
    return {
      status: data.response_status as number,
      body: data.response_body as unknown,
    };
  } catch {
    return null;
  }
}

async function store(
  tenantId: string,
  key: string,
  endpoint: string,
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
          idempotency_key: key,
          endpoint,
          response_status: status,
          response_body: body,
          expires_at: expiresAt.toISOString(),
        },
        {
          onConflict: "tenant_id,idempotency_key,endpoint",
          ignoreDuplicates: true,
        },
      );
  } catch {
    // Never block the caller on idempotency store failures.
  }
}

/**
 * Wraps a Route Handler with idempotency support.
 *
 * @param req      - The incoming Request (used to read the header).
 * @param tenantId - The authenticated tenant ID for key scoping.
 *                   Pass `null` to bypass idempotency (handler runs normally).
 * @param endpoint - Stable operation identifier, e.g. '/api/programacao:BATCH_CREATE'.
 * @param handler  - Async function that performs the actual operation.
 */
export async function withIdempotency(
  req: Request,
  tenantId: string | null,
  endpoint: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get(HEADERS[0]) ?? req.headers.get(HEADERS[1]);

  if (!key || !tenantId) {
    return handler();
  }

  const cached = await lookup(tenantId, key, endpoint);
  if (cached) {
    return new Response(JSON.stringify(cached.body), {
      status: cached.status,
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
      await store(tenantId, key, endpoint, response.status, body);
    } catch {
      // Non-JSON body or clone failure — skip caching.
    }
  }

  return response;
}
