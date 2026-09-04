"use client";

// Medicao Comercial: a mesma tela da Medicao, apontada para as equipes
// COMERCIAIS e com os dois eletricistas da execucao.
//
// A tela nao e um clone: recebe a variante e o PageView de Medicao troca a base
// da API, os campos dos integrantes e o cadastro em massa. O backend segue o
// mesmo desenho -- `/api/medicao-comercial/*` delega para os handlers de
// `src/server/modules/medicao`.
import { MeasurementPageView } from "@/modules/dashboard/medicao/MeasurementPageView";
import { COMMERCIAL_MEASUREMENT_VARIANT } from "@/modules/dashboard/medicao/variant";

export function CommercialMeasurementPageView() {
  return <MeasurementPageView variant={COMMERCIAL_MEASUREMENT_VARIANT} />;
}
