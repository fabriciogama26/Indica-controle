// src/lib/server/rateLimit.ts
// Rate limit para Route Handlers, sobre a mesma RPC que as Edge Functions ja
// usam (`rate_limit_check_and_hit`, migration 011).
//
// Contexto: a infraestrutura de rate limit existe desde a 011, mas so quatro
// Edge Functions a consumiam. Nenhuma das rotas do Next chamava, deixando
// importacao de XLSX, exportacao de CSV e as RPCs de agregacao dos dashboards
// sem teto de frequencia — autenticadas, mas repetiveis a vontade.
//
// Uso:
//   const limited = await enforceRateLimit(supabase, {
//     route: "api.projects.forecast.import",
//     identity: appUser.id,
//     maxHits: 5,
//     windowSeconds: 60,
//   });
//   if (limited) return limited;
//
// A chave e o id do app_user, nao o IP: o usuario ja foi resolvido pelo
// `resolveAuthenticatedAppUser` antes da operacao, e id de usuario nao e
// forjavel pelo cliente como um header de IP seria.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

type RateLimitInput = {
  /** Identificador estavel da operacao, ex.: "api.medicao.export". */
  route: string;
  /** Normalmente `appUser.id`. Combinado com `route` para formar a chave. */
  identity: string;
  /** Quantas chamadas sao aceitas dentro da janela. */
  maxHits: number;
  /** Tamanho da janela, em segundos. */
  windowSeconds: number;
  /** Escopo logico; separa contadores de familias diferentes de rota. */
  scope?: string;
};

type RateLimitRow = {
  allowed: boolean | null;
  retry_after: number | null;
  hits: number | null;
};

function identityHash(route: string, identity: string) {
  return createHash("sha256").update(`${route}|${identity}`).digest("hex");
}

/**
 * Retorna `NextResponse` 429 quando o limite estourou, ou `null` quando a rota
 * pode seguir.
 *
 * Falha ABERTA de proposito: se a RPC de rate limit estiver indisponivel, a
 * operacao continua. Diferente de permissao (que falha fechada), rate limit e
 * protecao contra abuso, nao barreira de autorizacao — derrubar operacao
 * legitima por indisponibilidade do contador seria pior que o abuso que ele
 * evita. Quem barra usuario sem direito continua sendo `requirePageAction`.
 */
export async function enforceRateLimit(
  supabase: SupabaseClient,
  { route, identity, maxHits, windowSeconds, scope = "api" }: RateLimitInput,
): Promise<NextResponse | null> {
  if (!identity) return null;

  const { data, error } = await supabase.rpc("rate_limit_check_and_hit", {
    p_scope: scope,
    p_route: route,
    p_identity_hash: identityHash(route, identity),
    p_owner_id: null,
    p_ip_hash: null,
    p_max_hits: maxHits,
    p_window_seconds: windowSeconds,
  });

  if (error) return null;

  const result = (Array.isArray(data) ? data[0] : data) as RateLimitRow | null;
  // `allowed` pode vir null se a RPC nao retornar linha; so bloqueia no false
  // explicito, pela mesma logica de falha aberta descrita acima.
  if (result?.allowed !== false) return null;

  const retryAfterSeconds = Number(result.retry_after) || windowSeconds;

  return NextResponse.json(
    {
      message: `Limite de requisicoes excedido. Tente novamente em ${retryAfterSeconds} segundos.`,
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
