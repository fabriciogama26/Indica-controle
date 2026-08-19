// Fachada publica do modulo server-side de Medicao.
//
// Existe para atender a regra de arquitetura do CLAUDE.md: a rota em
// `src/app/api/<rota>` delega e nao contem regra de negocio, e feature irma nao
// importa `queries.ts` direto.
//
// Motivo concreto de existir: antes deste corte, TODA a leitura de Medicao vivia
// dentro de `src/app/api/medicao/route.ts` (2.022 linhas). Como route.ts do Next
// so pode exportar handlers HTTP, a rota de exportacao nao tinha como reusar
// nada -- e chamava a propria rota de listagem por HTTP interno, pagina a pagina,
// e depois uma vez por ordem para o detalhamento.
//
// O que NAO entra nesta fachada: normalizadores internos (`normalizers.ts`) e o
// pipeline de listagem, que continua dentro do handler da rota.
export {
  fetchMeasurementOrderDetail,
  fetchMeasurementOrderDetailsForExport,
} from "./queries";

export { authorizeMeasurementReadOrExportAction } from "./authorization";
