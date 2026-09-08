// Checagem de duplicidade da `Ordem` da Medicao Comercial (Ordem + Equipe +
// Data). Existe so na variante comercial: a Medicao tecnica nao tem o campo.
import { NextRequest } from "next/server";

import { handleCommercialOrderRefCheck } from "@/server/modules/medicao/orderRefCheckHandler";

export async function GET(request: NextRequest) {
  return handleCommercialOrderRefCheck(request);
}
