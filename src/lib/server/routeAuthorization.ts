import { NextResponse } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";

/**
 * Aplica `requirePageAction` e devolve a resposta de erro pronta quando a acao
 * nao e permitida, ou `null` quando o handler pode seguir.
 *
 * Existe para que cada rota nao repita o mesmo bloco de `if (!allowed) return
 * NextResponse.json(...)`. O formato do corpo (`{ message, code }`) e o mesmo ja
 * usado por `/api/materials` e pelas rotas de estoque, entao o frontend nao
 * precisa de tratamento novo.
 */
export async function authorizePageAction(
  context: AuthenticatedAppUserContext,
  pageKey: string,
  action: PageAction,
) {
  const authorization = await requirePageAction({ context, pageKey, action });

  if (!authorization.allowed) {
    return NextResponse.json(
      { message: authorization.error.message, code: authorization.error.code },
      { status: authorization.error.status },
    );
  }

  return null;
}
