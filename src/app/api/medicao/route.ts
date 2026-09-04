// Rota da tela Medicao (equipes TECNICAS). Toda a regra vive em
// `src/server/modules/medicao/handlers.ts`, compartilhada com a Medicao Comercial.
import { NextRequest } from "next/server";

import {
  handleMeasurementGet,
  handleMeasurementPatch,
  handleMeasurementPost,
  handleMeasurementPut,
} from "@/server/modules/medicao/handlers";
import { DEFAULT_MEASUREMENT_ROUTE_CONFIG } from "@/server/modules/medicao/routeConfig";

export async function GET(request: NextRequest) {
  return handleMeasurementGet(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}

export async function POST(request: NextRequest) {
  return handleMeasurementPost(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}

export async function PUT(request: NextRequest) {
  return handleMeasurementPut(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}

export async function PATCH(request: NextRequest) {
  return handleMeasurementPatch(request, DEFAULT_MEASUREMENT_ROUTE_CONFIG);
}
