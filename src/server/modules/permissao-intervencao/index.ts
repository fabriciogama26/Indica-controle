// Fachada publica do modulo server-side da Permissao de Intervencao.
// As Route Handlers consomem SOMENTE o que sai daqui.

// Cadastro da PI (tela `permissao-intervencao`).
export {
  PI_PAGE_KEY,
  changePermissionInterventionStatus,
  getPermissionIntervention,
  getPermissionInterventionHistory,
  getPermissionInterventionMeta,
  getProgrammingStageOptions,
  linkPermissionInterventionToProgramming,
  listPermissionInterventions,
  savePermissionIntervention,
  savePermissionInterventionExecutionPlan,
  type ChangePiStatusPayload,
  type LinkPiPayload,
  type SavePiExecutionPlanPayload,
  type SavePiPayload,
} from "./handlers";
export { buildPiComparison } from "./queries";
export type {
  PiComparisonRow,
  PiCreationSource,
  PiLinkedStageClassification,
  PiLinkStatus,
  PiListItem,
  PiProgrammingStageOption,
  PiStatus,
} from "./types";

// Template do documento (tela `modelo-pi`).
export {
  activatePiTemplate,
  generatePiTemplatePreview,
  listPiTemplates,
  uploadPiTemplate,
  PI_TEMPLATE_PAGE_KEY,
  type ActivatePiTemplatePayload,
  type PiTemplatePreviewPayload,
} from "./templates";
export {
  buildPiTemplateData,
  checkbox,
  findPiTemplateDataGaps,
  validatePiDocumentData,
} from "./piTemplateMapper";
export {
  buildPiTemplateTagReport,
  isPiTemplateActivatable,
  PI_EXECUTION_PLAN_SLOTS,
  PI_REQUIRED_TEMPLATE_TAGS,
  PI_TEMPLATE_TAGS,
  type PiTemplateTagReport,
} from "./piTemplateTags";
export { buildPiDemoDocumentData, buildPiDemoFullPlanData } from "./piDemoDocument";
export { PI_TEMPLATE_BUCKET, PI_TEMPLATE_MAX_BYTES } from "./piTemplateStorage";
export type { PiDocumentData, PiDocumentIssue, PiExecutionStep } from "./types";
