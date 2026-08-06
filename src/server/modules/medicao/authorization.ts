import { NextResponse } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { requirePageAction } from "@/lib/server/pageAuthorization";
import type { PageAction, PageActionAuthorization } from "@/lib/server/pageAuthorization";

export const MEASUREMENT_PAGE_KEY = "medicao";
export const MEASUREMENT_VISUALIZATION_PAGE_KEY = "medicao-visualizacao";

function buildMeasurementAuthorizationResponse(authorization: PageActionAuthorization) {
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

// A tela `medicao-visualizacao` consome os mesmos endpoints de leitura/extracao da
// tela de cadastro. A autorizacao aceita QUALQUER uma das duas permissoes: quem so
// tem a tela de consulta nao pode ser barrado por nao ter `medicao`, e quem so tem
// a tela de cadastro continua funcionando sem mudanca. As rotas de gravacao
// (`POST`/`PUT`/`PATCH` de `/api/medicao`) nao passam por aqui.
export async function authorizeMeasurementReadOrExportAction(
  context: AuthenticatedAppUserContext,
  action: Extract<PageAction, "read" | "export">,
) {
  const registrationAuthorization = await requirePageAction({
    context,
    pageKey: MEASUREMENT_PAGE_KEY,
    action,
  });

  if (registrationAuthorization.allowed) return null;
  if (registrationAuthorization.error.status === 500) {
    return buildMeasurementAuthorizationResponse(registrationAuthorization);
  }

  const visualizationAuthorization = await requirePageAction({
    context,
    pageKey: MEASUREMENT_VISUALIZATION_PAGE_KEY,
    action,
  });

  if (visualizationAuthorization.allowed) return null;
  if (visualizationAuthorization.error.status === 500) {
    return buildMeasurementAuthorizationResponse(visualizationAuthorization);
  }

  return NextResponse.json(
    {
      message: `Acesso negado para executar ${action} em ${MEASUREMENT_PAGE_KEY} ou ${MEASUREMENT_VISUALIZATION_PAGE_KEY}.`,
      code: "PAGE_ACTION_FORBIDDEN",
      pageKey: MEASUREMENT_PAGE_KEY,
      action,
    },
    { status: 403 },
  );
}
