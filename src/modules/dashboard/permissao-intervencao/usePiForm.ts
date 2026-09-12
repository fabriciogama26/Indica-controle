"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  changePiStatus,
  fetchPiDetail,
  fetchPiMeta,
  PiRequestError,
  savePi,
  savePiExecutionPlan,
} from "./api";
import type {
  PiCatalogOption,
  PiComparisonRow,
  PiDetailResponse,
  PiExecutionStepRow,
  PiFormState,
  PiPersonOption,
  PiStageClassification,
  PiStatus,
  PiTeamOption,
} from "./types";

/**
 * Estado do formulario da PI.
 *
 * Concentra carga, edicao, gravacao e transicoes de status para o PageView
 * cuidar so de layout. Duas regras vivem aqui:
 *
 * 1. `expectedUpdatedAt` acompanha TODA escrita. O backend recusa com 409 se a
 *    PI mudou por outro usuario, e cada resposta devolve o novo valor.
 * 2. O payload enviado e o conjunto COMPLETO dos campos editaveis, porque o
 *    backend trata chave ausente como nulo. E o que permite limpar um campo.
 */

const EMPTY_FORM: PiFormState = {
  primaryOperationAreaCode: "",
  primaryVoltageLevelCode: "",
  operationAreas: [],
  contactOperationAreas: [],
  voltageLevels: [],
  interferingVoltageLevels: [],
  managerName: "",
  companyName: "",
  contractNumber: "",
  managerPhone: "",
  managerEmail: "",
  utilityContactName: "",
  utilityContactPhone: "",
  utilityContactEmail: "",
  activityDescription: "",
  workPlan: "",
  liveWorkAuthorization: "",
  preApr: "",
  emergencyAuthorization: "",
  startTime: "",
  endDate: "",
  endTime: "",
  secondaryDate: "",
  secondaryStartTime: "",
  installationDescription: "",
  feeder: "",
  address: "",
  coordX: "",
  coordY: "",
  blockedElements: "",
  cutElements: "",
  hasInterferingInstallation: null,
  interferingDescription: "",
  trafficInstructions: "",
  supervisorPersonId: "",
  supervisorAlternatePersonId: "",
  foremanPersonId: "",
  foremanAlternatePersonId: "",
  authorPersonId: "",
  validatorPersonId: "",
  observations: "",
};

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Hora do banco chega `HH:mm:ss`; o `<input type="time">` quer `HH:mm`. */
function time(value: unknown): string {
  return text(value).slice(0, 5);
}

function toFormState(detail: PiDetailResponse): PiFormState {
  const pi = detail.pi ?? {};
  return {
    primaryOperationAreaCode: text(pi.primaryOperationAreaCode),
    primaryVoltageLevelCode: text(pi.primaryVoltageLevelCode),
    operationAreas: detail.operationAreas ?? [],
    contactOperationAreas: detail.contactOperationAreas ?? [],
    voltageLevels: detail.voltageLevels ?? [],
    interferingVoltageLevels: detail.interferingVoltageLevels ?? [],
    managerName: text(pi.managerName),
    companyName: text(pi.companyName),
    contractNumber: text(pi.contractNumber),
    managerPhone: text(pi.managerPhone),
    managerEmail: text(pi.managerEmail),
    utilityContactName: text(pi.utilityContactName),
    utilityContactPhone: text(pi.utilityContactPhone),
    utilityContactEmail: text(pi.utilityContactEmail),
    activityDescription: text(pi.activityDescription),
    workPlan: text(pi.workPlan),
    liveWorkAuthorization: text(pi.liveWorkAuthorization),
    preApr: text(pi.preApr),
    emergencyAuthorization: text(pi.emergencyAuthorization),
    startTime: time(pi.startTime),
    endDate: text(pi.endDate),
    endTime: time(pi.endTime),
    secondaryDate: text(pi.secondaryDate),
    secondaryStartTime: time(pi.secondaryStartTime),
    installationDescription: text(pi.installationDescription),
    feeder: text(pi.feeder),
    address: text(pi.address),
    coordX: text(pi.coordX),
    coordY: text(pi.coordY),
    blockedElements: text(pi.blockedElements),
    cutElements: text(pi.cutElements),
    hasInterferingInstallation:
      pi.hasInterferingInstallation === null || pi.hasInterferingInstallation === undefined
        ? null
        : Boolean(pi.hasInterferingInstallation),
    interferingDescription: text(pi.interferingDescription),
    trafficInstructions: text(pi.trafficInstructions),
    supervisorPersonId: text(pi.supervisorPersonId),
    supervisorAlternatePersonId: text(pi.supervisorAlternatePersonId),
    foremanPersonId: text(pi.foremanPersonId),
    foremanAlternatePersonId: text(pi.foremanAlternatePersonId),
    authorPersonId: text(pi.authorPersonId),
    validatorPersonId: text(pi.validatorPersonId),
    observations: text(pi.observations),
  };
}

export type PiFormFeedback = {
  type: "success" | "error";
  message: string;
  /** Pendencias devolvidas por `pi_validate_for_issue`, uma por linha. */
  errors?: Array<{ code: string; message: string }>;
};

export type PiHeader = {
  piCode: string | null;
  status: PiStatus;
  linkStatus: string;
  creationSource: string;
  workDate: string;
  projectCode: string;
  projectCity: string | null;
  linkedStage: PiStageClassification | null;
  emergencyPlanSnapshot: string | null;
  updatedAt: string;
};

export function usePiForm(accessToken: string | null, piId: string) {
  const [form, setForm] = useState<PiFormState>(EMPTY_FORM);
  const [baseline, setBaseline] = useState<PiFormState>(EMPTY_FORM);
  const [steps, setSteps] = useState<PiExecutionStepRow[]>([]);
  const [baselineSteps, setBaselineSteps] = useState<PiExecutionStepRow[]>([]);
  const [comparison, setComparison] = useState<PiComparisonRow[]>([]);
  const [header, setHeader] = useState<PiHeader | null>(null);

  const [operationAreas, setOperationAreas] = useState<PiCatalogOption[]>([]);
  const [voltageLevels, setVoltageLevels] = useState<PiCatalogOption[]>([]);
  const [people, setPeople] = useState<PiPersonOption[]>([]);
  const [teams, setTeams] = useState<PiTeamOption[]>([]);
  const [stepTemplates, setStepTemplates] = useState<Array<{ code: string; description: string }>>([]);
  const [roleFilter, setRoleFilter] = useState({ foreman: false, supervisor: false });
  const [supervisorTeamLimit, setSupervisorTeamLimit] = useState(3);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<PiFormFeedback | null>(null);

  const applyDetail = useCallback((detail: PiDetailResponse) => {
    const next = toFormState(detail);
    setForm(next);
    setBaseline(next);
    setSteps(detail.executionSteps ?? []);
    setBaselineSteps(detail.executionSteps ?? []);
    setComparison(detail.comparison ?? []);

    const pi = detail.pi ?? {};
    setHeader({
      piCode: (pi.piCode as string | null) ?? null,
      status: (pi.status as PiStatus) ?? "DRAFT",
      linkStatus: text(pi.linkStatus),
      creationSource: text(pi.creationSource),
      workDate: text(pi.workDate),
      projectCode: detail.project?.code ?? "Nao identificado",
      projectCity: detail.project?.city ?? null,
      linkedStage: (pi.linkedStage as PiStageClassification | null) ?? null,
      emergencyPlanSnapshot: (pi.emergencyPlanSnapshot as string | null) ?? null,
      updatedAt: text(pi.updatedAt),
    });
  }, []);

  const load = useCallback(async () => {
    if (!accessToken || !piId) return;
    setIsLoading(true);
    try {
      const [detail, meta] = await Promise.all([fetchPiDetail(accessToken, piId), fetchPiMeta(accessToken)]);
      applyDetail(detail);
      setOperationAreas(meta.operationAreas ?? []);
      setVoltageLevels(meta.voltageLevels ?? []);
      setPeople(meta.people ?? []);
      setTeams(meta.teams ?? []);
      setStepTemplates(meta.executionStepTemplates ?? []);
      setRoleFilter(meta.roleFilterConfigured ?? { foreman: false, supervisor: false });
      setSupervisorTeamLimit(meta.supervisorRequiredTeamCount ?? 3);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar a PI." });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, applyDetail, piId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline) || JSON.stringify(steps) !== JSON.stringify(baselineSteps),
    [baseline, baselineSteps, form, steps],
  );

  /** PI emitida ou cancelada e somente leitura; o backend recusa de qualquer forma. */
  const isEditable = header?.status === "DRAFT" || header?.status === "READY";

  function setField<K extends keyof PiFormState>(key: K, value: PiFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleInList(key: "operationAreas" | "contactOperationAreas" | "voltageLevels" | "interferingVoltageLevels", code: string) {
    setForm((current) => {
      const list = current[key];
      const next = list.includes(code) ? list.filter((item) => item !== code) : [...list, code];
      // Escolher o principal so faz sentido entre os marcados. Desmarcar o que
      // era principal limpa a escolha, em vez de deixar um valor que a tela nao
      // mostra mais e que o backend recusaria na emissao.
      if (key === "operationAreas" && current.primaryOperationAreaCode && !next.includes(current.primaryOperationAreaCode)) {
        return { ...current, [key]: next, primaryOperationAreaCode: "" };
      }
      if (key === "voltageLevels" && current.primaryVoltageLevelCode && !next.includes(current.primaryVoltageLevelCode)) {
        return { ...current, [key]: next, primaryVoltageLevelCode: "" };
      }
      return { ...current, [key]: next };
    });
  }

  async function handleSave() {
    if (!accessToken || !header || isSaving) return false;
    setIsSaving(true);
    setFeedback(null);

    try {
      // O plano vai primeiro: as duas escritas tocam `updated_at`, e salvar o
      // cadastro depois garante que o `expectedUpdatedAt` devolvido no fim seja
      // o mais recente.
      let expected = header.updatedAt;

      if (JSON.stringify(steps) !== JSON.stringify(baselineSteps)) {
        const planResult = await savePiExecutionPlan(accessToken, piId, expected, steps);
        expected = planResult.updatedAt ?? expected;
      }

      await savePi(accessToken, piId, expected, { ...form });
      await load();
      setFeedback({ type: "success", message: "PI salva com sucesso." });
      return true;
    } catch (error) {
      const payload = error instanceof PiRequestError ? error.payload : null;
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao salvar a PI.",
        errors: payload?.errors,
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatus(action: "READY" | "REOPEN" | "ISSUE" | "CANCEL", reason?: string) {
    if (!accessToken || !header || isSaving) return false;
    setIsSaving(true);
    setFeedback(null);

    try {
      const result = await changePiStatus(accessToken, piId, action, header.updatedAt, reason);
      await load();
      setFeedback({ type: "success", message: result.message ?? "Status atualizado." });
      return true;
    } catch (error) {
      const payload = error instanceof PiRequestError ? error.payload : null;
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao alterar o status.",
        errors: payload?.errors,
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    form,
    steps,
    comparison,
    header,
    operationAreas,
    voltageLevels,
    people,
    teams,
    stepTemplates,
    roleFilter,
    supervisorTeamLimit,
    isLoading,
    isSaving,
    isDirty,
    isEditable: Boolean(isEditable),
    feedback,
    setFeedback,
    setField,
    setSteps,
    toggleInList,
    handleSave,
    handleStatus,
    reload: load,
  };
}
