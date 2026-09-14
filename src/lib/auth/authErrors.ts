import { AuthUnknownError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Status HTTP que indica falha de infraestrutura (Supabase fora do ar, timeout, gateway),
 * e nao resposta do servico sobre a sessao. `0` e o status que o supabase-js usa quando a
 * requisicao nem chegou a ter resposta (rede, abort por timeout).
 */
export function isTransientHttpStatus(status: number | null | undefined) {
  return status === 0 || (typeof status === "number" && status >= 500);
}

/**
 * Erro do Supabase Auth que NAO prova sessao invalida: rede, timeout ou 5xx.
 *
 * Existe porque tratar qualquer erro de `getUser`/`setSession` como "sessao expirada" fez,
 * no incidente de 2026-09-14 (banco Nano com Disk IO em 100%), a API responder 401 com
 * sessao valida e o front deslogar os usuarios em loop enquanto o Supabase estava fora.
 *
 * Tres formatos, conferidos com a versao instalada do auth-js:
 * - rede, abort por timeout e 502/503/504 -> `AuthRetryableFetchError`;
 * - 5xx com corpo JSON (ex.: 500) -> erro comum com `status` >= 500;
 * - resposta de erro que NAO e JSON (ex.: pagina HTML do 522 do gateway) -> `AuthUnknownError`
 *   SEM `status`. O GoTrue sempre responde erro em JSON, entao corpo nao-JSON nunca e veredito
 *   do Auth sobre a sessao — veio de gateway/proxy.
 */
export function isTransientAuthError(error: unknown) {
  if (isAuthRetryableFetchError(error)) return true;
  if (error instanceof AuthUnknownError) return true;
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && isTransientHttpStatus(status);
}
