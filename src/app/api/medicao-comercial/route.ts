// Rota da tela Medicao Comercial (equipes COMERCIAIS). Mesma regra da Medicao
// tecnica, trocando apenas o `MeasurementRouteConfig`.
import { NextRequest } from "next/server";

import {
  handleMeasurementGet,
  handleMeasurementPatch,
  handleMeasurementPost,
  handleMeasurementPut,
} from "@/server/modules/medicao/handlers";
import { COMMERCIAL_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementGet(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}

export async function POST(request: NextRequest) {
  return handleMeasurementPost(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}

export async function PUT(request: NextRequest) {
  return handleMeasurementPut(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}

export async function PATCH(request: NextRequest) {
  return handleMeasurementPatch(request, COMMERCIAL_MEASUREMENT_ROUTE_CONFIG);
}
