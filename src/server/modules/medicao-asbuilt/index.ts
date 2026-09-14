// Fachada publica do modulo server-side de Medicao Asbuilt.
//
// A leitura, gravacao e historico ainda vivem em `src/app/api/medicao-asbuilt/route.ts`.
// Este modulo nasceu com a exportacao do Detalhamento, que precisava de uma rota propria
// e de filtros identicos aos da listagem — e `route.ts` do Next so exporta handlers HTTP.
export { handleAsbuiltMeasurementExportGet } from "./exportHandler";
export {
  asbuiltMeasurementListFilterConditions,
  parseAsbuiltMeasurementListFilters,
  type AsbuiltMeasurementListFilters,
} from "./filters";
