"use client";

import { useMemo, useState } from "react";

import { useErrorLogger } from "@/hooks/useErrorLogger";

import {
  CancelModal,
  DetailsModal,
  HistoryModal,
  PostponeModal,
  StageCard,
  StageFormPanel,
} from "./components";
import { createInitialForm } from "./constants";
import { useActivityCatalogSearch, useHistoryModal, useProgrammingMeta, useProgrammingPlan, useProgrammingStageActions } from "./hooks";
import styles from "./ProgrammingNormalizedPageView.module.css";
import { buildReasonText, isFormReadyToSave, isTimeRangeValid } from "./validators";
import { findActiveCompletedStage, sortStagesByDate, toIsoDate } from "./utils";
import type { FeedbackState, ProgrammingStage, StageDocument } from "./types";

function findDocumentEntry(documents: StageDocument[], documentType: StageDocument["documentType"]) {
  const match = documents.find((item) => item.documentType === documentType);
  return {
    number: match?.number ?? "",
    includedAt: match?.includedAt ?? "",
    deliveredAt: match?.deliveredAt ?? "",
  };
}

// Usado tanto por Editar (mesma data) quanto por "Nova etapa a partir desta"
// (mesmo cadastro, data em branco para o usuario preencher).
function buildFormFromStage(stage: ProgrammingStage, params: { executionDate: string }) {
  return {
    projectId: stage.projectId,
    projectSearch: "",
    executionDate: params.executionDate,
    isPendencia: false,
    teamIds: stage.teams.filter((team) => team.status === "ATIVA").map((team) => team.teamId),
    teamSearch: "",
    serviceDescription: stage.serviceDescription,
    period: stage.period ?? ("INTEGRAL" as const),
    startTime: (stage.startTime ?? "").slice(0, 5),
    endTime: (stage.endTime ?? "").slice(0, 5),
    outageStartTime: (stage.outageStartTime ?? "").slice(0, 5),
    outageEndTime: (stage.outageEndTime ?? "").slice(0, 5),
    feeder: stage.feeder,
    campoEletrico: stage.campoEletrico,
    affectedCustomers: stage.affectedCustomers ? String(stage.affectedCustomers) : "",
    sgdTypeId: stage.sgdTypeId ?? "",
    electricalEqCatalogId: stage.electricalEqCatalogId ?? "",
    support: stage.support,
    supportItemId: stage.supportItemId ?? "",
    posteQty: stage.posteQty ? String(stage.posteQty) : "",
    estruturaQty: stage.estruturaQty ? String(stage.estruturaQty) : "",
    trafoQty: stage.trafoQty ? String(stage.trafoQty) : "",
    redeQty: stage.redeQty ? String(stage.redeQty) : "",
    note: stage.note,
    activitySearch: "",
    activityQuantity: "",
    activities: stage.activities.map((activity) => ({
      catalogId: activity.serviceActivityId,
      code: activity.code,
      description: activity.description,
      unit: activity.unit,
      quantity: String(activity.quantity),
    })),
    documents: {
      sgd: findDocumentEntry(stage.documents, "SGD"),
      pi: findDocumentEntry(stage.documents, "PI"),
      pep: findDocumentEntry(stage.documents, "PEP"),
    },
  };
}

export function ProjectPlanView(props: { accessToken: string | null; projectId: string; projectCode: string; onBack: () => void }) {
  const { accessToken, projectId, projectCode, onBack } = props;
  const logError = useErrorLogger("programacao_normalizada");
  const today = useMemo(() => toIsoDate(new Date()), []);

  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [form, setForm] = useState(() => createInitialForm(today));
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  const [postponeTarget, setPostponeTarget] = useState<ProgrammingStage | null>(null);
  const [postponeMode, setPostponeMode] = useState<"DATE" | "HOLD">("DATE");
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReasonCode, setPostponeReasonCode] = useState("");
  const [postponeReasonNotes, setPostponeReasonNotes] = useState("");

  const [cancelTarget, setCancelTarget] = useState<ProgrammingStage | null>(null);
  const [cancelReasonCode, setCancelReasonCode] = useState("");
  const [cancelReasonNotes, setCancelReasonNotes] = useState("");

  const [detailsTarget, setDetailsTarget] = useState<ProgrammingStage | null>(null);

  const { meta } = useProgrammingMeta({ accessToken, onError: logError });
  const { stages, reloadPlan } = useProgrammingPlan({ accessToken, projectId, onError: logError });
  const historyModal = useHistoryModal({ accessToken, onError: logError });
  const actions = useProgrammingStageActions({ accessToken, setFeedback, onSuccess: reloadPlan, onError: logError });
  const { activityOptions, isLoadingActivities } = useActivityCatalogSearch({ accessToken, query: form.activitySearch, onError: logError });

  const teams = meta?.teams ?? [];
  const reasonOptions = meta?.reasonOptions ?? [];
  const sortedStages = useMemo(() => sortStagesByDate(stages), [stages]);
  const activeCompletedStage = useMemo(() => findActiveCompletedStage(stages), [stages]);

  function startEdit(stage: ProgrammingStage) {
    setEditingStageId(stage.id);
    setForm(buildFormFromStage(stage, { executionDate: stage.executionDate ?? "" }));
  }

  // "Nova etapa a partir desta": herda todo o cadastro, so a data fica em branco.
  function duplicateStage(stage: ProgrammingStage) {
    setEditingStageId(null);
    setForm(buildFormFromStage(stage, { executionDate: "" }));
    setFeedback(null);
  }

  function cancelEdit() {
    setEditingStageId(null);
    // Herda o cadastro da ultima etapa para a proxima (secao 9 do spec: base herdada + override).
    const lastStage = sortedStages[sortedStages.length - 1];
    setForm(
      lastStage
        ? {
            ...createInitialForm(today),
            teamIds: lastStage.teams.filter((team) => team.status === "ATIVA").map((team) => team.teamId),
            serviceDescription: lastStage.serviceDescription,
            period: lastStage.period ?? "INTEGRAL",
            startTime: (lastStage.startTime ?? "").slice(0, 5),
            endTime: (lastStage.endTime ?? "").slice(0, 5),
            feeder: lastStage.feeder,
            campoEletrico: lastStage.campoEletrico,
            sgdTypeId: lastStage.sgdTypeId ?? "",
            electricalEqCatalogId: lastStage.electricalEqCatalogId ?? "",
            support: lastStage.support,
            supportItemId: lastStage.supportItemId ?? "",
          }
        : createInitialForm(today),
    );
  }

  async function submitForm() {
    const baseFields = {
      projectId,
      teamIds: form.teamIds,
      serviceDescription: form.serviceDescription,
      period: form.period,
      startTime: form.startTime,
      endTime: form.endTime,
      outageStartTime: form.outageStartTime,
      outageEndTime: form.outageEndTime,
      feeder: form.feeder,
      campoEletrico: form.campoEletrico,
      affectedCustomers: form.affectedCustomers,
      sgdTypeId: form.sgdTypeId,
      electricalEqCatalogId: form.electricalEqCatalogId,
      support: form.support,
      supportItemId: form.supportItemId,
      posteQty: form.posteQty,
      estruturaQty: form.estruturaQty,
      trafoQty: form.trafoQty,
      redeQty: form.redeQty,
      note: form.note,
      isPendencia: form.isPendencia,
      activities: form.activities.map((item) => ({ catalogId: item.catalogId, quantity: item.quantity })),
      documents: form.documents,
    };

    if (editingStageId) {
      const currentStage = stages.find((item) => item.id === editingStageId);
      const result = await actions.saveStage(
        { ...baseFields, executionDate: form.executionDate, programmingId: editingStageId, expectedUpdatedAt: currentStage?.updatedAt },
        true,
      );
      if (result.ok) cancelEdit();
      return;
    }

    // Uma etapa por submissao (uma data = uma etapa). Datas adicionais entram
    // pelo botao "Nova etapa a partir desta", que reabre este editor herdando o
    // cadastro da etapa selecionada.
    const date = form.executionDate.trim();
    if (!date) return;

    const result = await actions.saveStage({ ...baseFields, executionDate: date }, false);
    if (!result.ok) return;

    cancelEdit();
  }

  function openPostponeModal(stage: ProgrammingStage) {
    setPostponeTarget(stage);
    setPostponeMode("DATE");
    setPostponeDate("");
    setPostponeReasonCode("");
    setPostponeReasonNotes("");
  }

  async function confirmPostpone() {
    if (!postponeTarget) return;
    const reasonLabel = buildReasonText(reasonOptions, postponeReasonCode, postponeReasonNotes);
    if (!reasonLabel) return;

    // Rota "em espera" envia data null (ADIADA sem data); "nova data" remarca (REPROGRAMADA).
    const newDate = postponeMode === "HOLD" ? null : postponeDate;
    if (postponeMode === "DATE" && !newDate) return;

    const result = await actions.postpone(postponeTarget.id, newDate, reasonLabel, postponeTarget.updatedAt);
    if (result.ok) setPostponeTarget(null);
  }

  function openCancelModal(stage: ProgrammingStage) {
    setCancelTarget(stage);
    setCancelReasonCode("");
    setCancelReasonNotes("");
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const reasonLabel = buildReasonText(reasonOptions, cancelReasonCode, cancelReasonNotes);
    if (!reasonLabel) return;

    const result = await actions.cancel(cancelTarget.id, reasonLabel, cancelTarget.updatedAt);
    if (result.ok) setCancelTarget(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.planHeader}>
        <button type="button" className={styles.linkButton} onClick={onBack}>
          &larr; Voltar para a lista
        </button>
      </div>

      <div className={styles.header}>
        <h2>{projectCode}</h2>
        <p className={styles.emptyHint}>Plano de etapas do projeto.</p>
      </div>

      {feedback ? (
        <div className={feedback.type === "success" ? `${styles.feedback} ${styles.feedbackSuccess}` : `${styles.feedback} ${styles.feedbackError}`}>
          {feedback.message}
        </div>
      ) : null}

      {activeCompletedStage ? (
        <div className={`${styles.feedback} ${styles.feedbackError}`}>
          Projeto concluido em {activeCompletedStage.executionDate}. Reabra a etapa concluida antes de inserir, editar, adicionar equipe, adiar ou cancelar — exceto criar uma etapa de Pendencia (marque a checkbox no formulario), que e permitida sem reabrir.
        </div>
      ) : null}

      <div className={styles.board}>
        <StageFormPanel
          form={form}
          setForm={setForm}
          isEditing={Boolean(editingStageId)}
          isSubmitting={actions.isSubmitting}
          canSubmit={
            isFormReadyToSave({
              projectId,
              executionDate: form.executionDate,
              period: form.period,
              startTime: form.startTime,
              endTime: form.endTime,
              sgdTypeId: form.sgdTypeId,
              electricalEqCatalogId: form.electricalEqCatalogId,
              campoEletrico: form.campoEletrico,
              serviceDescription: form.serviceDescription,
            }) && isTimeRangeValid(form.startTime, form.endTime)
          }
          teamOptions={teams}
          sgdTypes={meta?.sgdTypes ?? []}
          electricalEqCatalog={meta?.electricalEqCatalog ?? []}
          supportOptions={meta?.supportOptions ?? []}
          activityOptions={activityOptions}
          isLoadingActivities={isLoadingActivities}
          onSubmit={submitForm}
          onCancelEdit={editingStageId ? cancelEdit : onBack}
        />

        <div className={styles.stageList}>
          {!sortedStages.length ? <p className={styles.emptyHint}>Nenhuma etapa cadastrada para este projeto ainda.</p> : null}
          {sortedStages.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              teamOptions={teams}
              isSubmitting={actions.isSubmitting}
              onEdit={() => startEdit(stage)}
              onDuplicate={() => duplicateStage(stage)}
              onAddTeam={(teamId) => actions.addTeam(stage.id, teamId)}
              onRemoveTeam={(programmingTeamId, expectedUpdatedAt) => actions.removeTeam(programmingTeamId, expectedUpdatedAt)}
              onPostpone={() => openPostponeModal(stage)}
              onCancel={() => openCancelModal(stage)}
              onComplete={() => actions.complete(stage.id, stage.updatedAt)}
              onReopen={() => actions.reopen(stage.id, stage.updatedAt)}
              onTogglePendencia={(next) => actions.togglePendencia(stage.id, next, stage.updatedAt)}
              onDetails={() => setDetailsTarget(stage)}
              onHistory={() => historyModal.openHistory(stage)}
            />
          ))}
        </div>
      </div>

      <PostponeModal
        isOpen={Boolean(postponeTarget)}
        mode={postponeMode}
        newDate={postponeDate}
        reasonCode={postponeReasonCode}
        reasonNotes={postponeReasonNotes}
        reasonOptions={reasonOptions}
        isSubmitting={actions.isSubmitting}
        onClose={() => setPostponeTarget(null)}
        onConfirm={confirmPostpone}
        onModeChange={setPostponeMode}
        onNewDateChange={setPostponeDate}
        onReasonCodeChange={setPostponeReasonCode}
        onReasonNotesChange={setPostponeReasonNotes}
      />

      <CancelModal
        isOpen={Boolean(cancelTarget)}
        reasonCode={cancelReasonCode}
        reasonNotes={cancelReasonNotes}
        reasonOptions={reasonOptions}
        isSubmitting={actions.isSubmitting}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        onReasonCodeChange={setCancelReasonCode}
        onReasonNotesChange={setCancelReasonNotes}
      />

      <HistoryModal
        target={historyModal.historyTarget}
        items={historyModal.historyItems}
        pagedItems={historyModal.pagedHistoryItems}
        isLoading={historyModal.isLoadingHistory}
        page={historyModal.historyPage}
        totalPages={historyModal.totalHistoryPages}
        onClose={() => historyModal.setHistoryTarget(null)}
        onPreviousPage={historyModal.onPreviousHistoryPage}
        onNextPage={historyModal.onNextHistoryPage}
      />

      <DetailsModal target={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </div>
  );
}
