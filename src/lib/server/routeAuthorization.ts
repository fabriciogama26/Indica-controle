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

/**
 * Versao para catalogo lido por mais de uma tela: libera quando QUALQUER uma das
 * `pageKeys` permite a acao.
 *
 * Existe por causa do "Padrao de permissao por tela" do CLAUDE.md: quem enxerga
 * uma tela precisa enxergar tudo que ela carrega. As Datas Bloqueadas aparecem
 * na Programacao, no Mapa de Programacao e na Visualizacao de Programacao, e
 * nenhuma dessas telas exige a permissao do cadastro. Fixar um unico `page_key`
 * no endpoint deixaria a tela abrir e o proprio painel dela falhar com 403.
 *
 * A mensagem de erro devolvida e a da PRIMEIRA chave, que por convencao e a
 * chave da tela dona do dado — as demais sao consumidoras.
 */
export async function authorizeAnyPageAction(
  context: AuthenticatedAppUserContext,
  pageKeys: readonly string[],
  action: PageAction,
) {
  if (!pageKeys.length) {
    return NextResponse.json(
      { message: "Nao foi possivel validar a permissao desta operacao.", code: "PAGE_PERMISSION_LOOKUP_FAILED" },
      { status: 500 },
    );
  }

  let firstFailure: Awaited<ReturnType<typeof requirePageAction>> | null = null;

  for (const pageKey of pageKeys) {
    const authorization = await requirePageAction({ context, pageKey, action });
    if (authorization.allowed) {
      return null;
    }
    firstFailure = firstFailure ?? authorization;
  }

  if (firstFailure && !firstFailure.allowed) {
    return NextResponse.json(
      { message: firstFailure.error.message, code: firstFailure.error.code },
      { status: firstFailure.error.status },
    );
  }

  return NextResponse.json(
    { message: "Nao foi possivel validar a permissao desta operacao.", code: "PAGE_PERMISSION_LOOKUP_FAILED" },
    { status: 500 },
  );
}
