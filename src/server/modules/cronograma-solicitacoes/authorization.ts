import { NextResponse } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction, type PageAction } from "@/lib/server/pageAuthorization";

export const CRONOGRAMA_PAGE_KEY = "cronograma-solicitacoes";

export async function authorizeCronogramaAction(
  context: AuthenticatedAppUserContext,
  action: PageAction,
) {
  const authorization = await requirePageAction({
    context,
    pageKey: CRONOGRAMA_PAGE_KEY,
    action,
  });

  if (authorization.allowed) return null;

  return NextResponse.json(
    {
      message: authorization.error.message,
      code: authorization.error.code,
      pageKey: authorization.pageKey,
      action: authorization.action,
    },
    { status: authorization.error.status },
  );
}
