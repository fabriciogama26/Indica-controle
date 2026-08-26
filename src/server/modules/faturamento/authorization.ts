import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { authorizePageAction } from "@/lib/server/routeAuthorization";
import type { PageAction } from "@/lib/server/pageAuthorization";

export const BILLING_PAGE_KEY = "faturamento";

/**
 * Autorizacao unica do modulo de Faturamento.
 *
 * Antes desta funcao, `/api/faturamento`, `/api/faturamento/meta` e
 * `/api/faturamento/activities/catalog` carregavam tres copias de um
 * `ensureBillingPageAccess` local que divergia do `requirePageAction` canonico em
 * dois pontos:
 *
 *   1. pulava o gate `app_pages.default_user_access = true and ativo = true` antes
 *      do fallback por role, entao uma tela desativada continuava servindo dados;
 *   2. tratava falha de lookup da permissao do usuario como "sem registro" e caia
 *      para o role, em vez de devolver `PAGE_PERMISSION_LOOKUP_FAILED`.
 *
 * A pagina `faturamento` foi criada pela migration 176, anterior a 245, entao ela
 * ja nasce com `default_user_access = true` e `ativo = true` — passar a aplicar o
 * gate nao altera quem tem acesso hoje.
 */
export async function resolveBillingContext(
  request: NextRequest,
  params: { invalidSessionMessage: string; action: PageAction },
): Promise<{ context: AuthenticatedAppUserContext } | { errorResponse: NextResponse }> {
  const resolution = await resolveAuthenticatedAppUser(request, {
    invalidSessionMessage: params.invalidSessionMessage,
    inactiveMessage: "Usuario inativo.",
  });

  if ("error" in resolution) {
    return {
      errorResponse: NextResponse.json(
        { message: resolution.error.message },
        { status: resolution.error.status },
      ),
    };
  }

  const authorizationError = await authorizePageAction(resolution, BILLING_PAGE_KEY, params.action);
  if (authorizationError) {
    return { errorResponse: authorizationError };
  }

  return { context: resolution };
}
