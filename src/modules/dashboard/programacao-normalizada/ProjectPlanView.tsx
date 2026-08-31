"use client";

import { useMemo, useState } from "react";

import { useErrorLogger } from "@/hooks/useErrorLogger";

import { StageCard, StageFormPanel } from "./components";
import {
  AddTeamModal,
  CancelModal,
  CancelTeamModal,
  CorrectDateModal,
  DetailsModal,
  HistoryModal,
  LastActiveTeamModal,
  PendenciaModal,
  PostponeModal,
  PostponeTeamModal,
} from "./components/modals";
import { createInitialForm } from "./constants";
import {
  useActivityCatalogSearch,
  useAddTeamPrecheck,
  useHistoryModal,
  useProgrammingGranularPermissions,
  useProgrammingMeta,
  useProgrammingPlan,
  useProgrammingStageActions,
} from "./hooks";
import styles from "./ProgrammingNormalizedPageView.module.css";
import { buildReasonText, isFormReadyToSave, isTimeRangeValid } from "./validators";
import { findActiveCompletedStage, isOnHoldStage, sortStagesByDate, toIsoDate } from "./utils";
import type { FeedbackState, ProgrammingStage, StageDocument, StageTeam } from "./types";

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
  const activeTeams = stage.teams.filter((team) => team.status === "ATIVA");

  return {
    projectId: stage.projectId,
    projectSearch: "",
    executionDate: params.executionDate,
    isPendencia: false,
    teamIds: activeTeams.map((team) => team.teamId),
    teamForemanIds: Object.fromEntries(activeTeams.map((team) => [team.teamId, team.programmedForemanPersonId ?? ""])),
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
    historyReason: "",
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

  // Participacao por equipe (349) — mesmos fluxos da listagem, portados para o
  // plano do projeto: e aqui que a etapa em espera e gerenciada, entao e aqui que
  // o usuario precisa poder tirar a equipe que travaria a retomada.
  const [cancelTeamTarget, setCancelTeamTarget] = useState<{ team: StageTeam; stage: ProgrammingStage } | null>(null);
  const [cancelTeamReasonCode, setCancelTeamReasonCode] = useState("");
  const [cancelTeamReasonNotes, setCancelTeamReasonNotes] = useState("");

  const [postponeTeamTarget, setPostponeTeamTarget] = useState<{ team: StageTeam; stage: ProgrammingStage } | null>(null);
  const [postponeTeamDate, setPostponeTeamDate] = useState("");
  const [postponeTeamReasonCode, setPostponeTeamReasonCode] = useState("");
  const [postponeTeamReasonNotes, setPostponeTeamReasonNotes] = useState("");

  const [lastActiveTeamPrompt, setLastActiveTeamPrompt] = useState<
    { kind: "cancel" | "postpone"; team: StageTeam; stage: ProgrammingStage; reason: string; newDate?: string } | null
  >(null);

  const [pendenciaTarget, setPendenciaTarget] = useState<ProgrammingStage | null>(null);
  const [pendenciaNext, setPendenciaNext] = useState(false);
  const [pendenciaReason, setPendenciaReason] = useState("");
  const [pendenciaDescription, setPendenciaDescription] = useState("");
  const [pendenciaOriginId, setPendenciaOriginId] = useState("");

  const [correctDateTarget, setCorrectDateTarget] = useState<ProgrammingStage | null>(null);
  const [correctDateValue, setCorrectDateValue] = useState("");
  const [correctDateReason, setCorrectDateReason] = useState("");

  const [detailsTarget, setDetailsTarget] = useState<ProgrammingStage | null>(null);

  const [addTeamTarget, setAddTeamTarget] = useState<ProgrammingStage | null>(null);
  const [addTeamSelectedId, setAddTeamSelectedId] = useState("");
  const [addTeamSelectedForemanId, setAddTeamSelectedForemanId] = useState("");

  const { canComplete, canPendencia, canCorrectDate } = useProgrammingGranularPermissions();
  const { meta } = useProgrammingMeta({ accessToken, onError: logError });
  const { stages, reloadPlan } = useProgrammingPlan({ accessToken, projectId, onError: logError });
  const historyModal = useHistoryModal({ accessToken, onError: logError });
  const actions = useProgrammingStageActions({ accessToken, setFeedback, onSuccess: reloadPlan, onError: logError });
  const { activityOptions, isLoadingActivities } = useActivityCatalogSearch({ accessToken, query: form.activitySearch, onError: logError });
  const addTeamCheck = useAddTeamPrecheck({ accessToken, programmingId: addTeamTarget?.id ?? null, teamId: addTeamSelectedId });

  const teams = meta?.teams ?? [];
  const reasonOptions = meta?.reasonOptions ?? [];
  const sortedStages = useMemo(() => sortStagesByDate(stages), [stages]);
  const editingStage = useMemo(() => stages.find((item) => item.id === editingStageId) ?? null, [editingStageId, stages]);
  const activeCompletedStage = useMemo(() => findActiveCompletedStage(stages), [stages]);
  const allowBlankForemanTeamIds = useMemo(
    () =>
      editingStage
        ? editingStage.teams
            .filter((team) => team.status === "ATIVA" && !team.programmedForemanPersonId)
            .map((team) => team.teamId)
        : [],
    [editingStage],
  );
  const canSubmitTeamForemen = useMemo(() => {
    const blankAllowed = new Set(allowBlankForemanTeamIds);
    return form.teamIds.every((teamId) => Boolean(form.teamForemanIds[teamId]) || blankAllowed.has(teamId));
  }, [allowBlankForemanTeamIds, form.teamForemanIds, form.teamIds]);
  const addTeamAvailableTeams = addTeamTarget
    ? teams.filter((team) => !addTeamTarget.teams.some((active) => active.teamId === team.id && active.status === "ATIVA"))
    : [];

  // Abrir/fechar zeram a equipe selecionada: um id remanescente de outra etapa
  // dispararia a pre-checagem contra a etapa errada.
  function openAddTeamModal(stage: ProgrammingStage) {
    setAddTeamTarget(stage);
    setAddTeamSelectedId("");
    setAddTeamSelectedForemanId("");
  }

  function closeAddTeamModal() {
    setAddTeamTarget(null);
    setAddTeamSelectedId("");
    setAddTeamSelectedForemanId("");
  }

  function selectTeamToAdd(teamId: string) {
    const selectedTeam = teams.find((team) => team.id === teamId);
    setAddTeamSelectedId(teamId);
    setAddTeamSelectedForemanId(selectedTeam?.foremanId ?? "");
  }

  async function confirmAddTeam() {
    if (!addTeamTarget || !addTeamSelectedId || !addTeamSelectedForemanId) return;
    const result = await actions.addTeam(addTeamTarget.id, addTeamSelectedId, addTeamSelectedForemanId);
    if (result.ok) closeAddTeamModal();
  }

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
            teamForemanIds: Object.fromEntries(
              lastStage.teams
                .filter((team) => team.status === "ATIVA")
                .map((team) => [team.teamId, team.programmedForemanPersonId ?? ""]),
            ),
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
      historyReason: form.historyReason,
      teamForemanIds: form.teamForemanIds,
      // Sem a permissao a checkbox nem e renderizada; forcar false aqui garante
      // que nenhum caminho de reset/heranca de formulario mande a flag invisivel
      // para o backend (padrao de permissao granular do CLAUDE.md, item 2).
      isPendencia: canPendencia && form.isPendencia,
      activities: form.activities.map((item) => ({ catalogId: item.catalogId, quantity: item.quantity })),
      documents: form.documents,
    };

    if (editingStageId) {
      const result = await actions.saveStage(
        { ...baseFields, executionDate: form.executionDate, programmingId: editingStageId, expectedUpdatedAt: editingStage?.updatedAt },
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

  function openCancelTeam(team: StageTeam, stage: ProgrammingStage) {
    setCancelTeamTarget({ team, stage });
    setCancelTeamReasonCode("");
    setCancelTeamReasonNotes("");
  }

  function openPostponeTeam(team: StageTeam, stage: ProgrammingStage) {
    setPostponeTeamTarget({ team, stage });
    setPostponeTeamDate("");
    setPostponeTeamReasonCode("");
    setPostponeTeamReasonNotes("");
  }

  // LAST_ACTIVE_TEAM nao e erro: a RPC recusa e devolve a decisao para o usuario
  // (cancelar a etapa inteira / manter sem equipe / voltar) — ver 349.
  async function confirmCancelTeam() {
    if (!cancelTeamTarget) return;
    const reasonLabel = buildReasonText(reasonOptions, cancelTeamReasonCode, cancelTeamReasonNotes);
    if (!reasonLabel) return;

    const { team, stage } = cancelTeamTarget;
    const result = await actions.cancelTeam(team.id, reasonLabel, team.updatedAt, false);
    if (result.ok) {
      setCancelTeamTarget(null);
      return;
    }
    if (result.data?.reason === "LAST_ACTIVE_TEAM") {
      setLastActiveTeamPrompt({ kind: "cancel", team, stage, reason: reasonLabel });
      setCancelTeamTarget(null);
    }
  }

  async function confirmPostponeTeam() {
    if (!postponeTeamTarget || !postponeTeamDate) return;
    const reasonLabel = buildReasonText(reasonOptions, postponeTeamReasonCode, postponeTeamReasonNotes);
    if (!reasonLabel) return;

    const { team, stage } = postponeTeamTarget;
    const result = await actions.postponeTeam(team.id, team.teamId, postponeTeamDate, reasonLabel, team.updatedAt, false);
    if (result.ok) {
      setPostponeTeamTarget(null);
      return;
    }
    if (result.data?.reason === "LAST_ACTIVE_TEAM") {
      setLastActiveTeamPrompt({ kind: "postpone", team, stage, reason: reasonLabel, newDate: postponeTeamDate });
      setPostponeTeamTarget(null);
    }
  }

  async function confirmKeepStageWithoutTeam() {
    if (!lastActiveTeamPrompt) return;
    const { kind, team, reason, newDate } = lastActiveTeamPrompt;
    const result =
      kind === "cancel"
        ? await actions.cancelTeam(team.id, reason, team.updatedAt, true)
        : await actions.postponeTeam(team.id, team.teamId, newDate ?? "", reason, team.updatedAt, true);
    if (result.ok) setLastActiveTeamPrompt(null);
  }

  function cancelWholeStageFromLastTeamPrompt() {
    if (!lastActiveTeamPrompt) return;
    openCancelModal(lastActiveTeamPrompt.stage);
    setLastActiveTeamPrompt(null);
  }

  function openPendenciaModal(stage: ProgrammingStage, next: boolean) {
    setPendenciaTarget(stage);
    setPendenciaNext(next);
    setPendenciaReason("");
    setPendenciaDescription("");
    setPendenciaOriginId("");
  }

  async function confirmPendencia() {
    if (!pendenciaTarget) return;
    const reason = pendenciaReason.trim();
    if (!reason) return;

    const result = await actions.togglePendencia(
      pendenciaTarget.id,
      pendenciaNext,
      reason,
      pendenciaTarget.updatedAt,
      pendenciaNext ? pendenciaDescription.trim() : null,
      pendenciaNext ? pendenciaOriginId || null : null,
    );
    if (result.ok) setPendenciaTarget(null);
  }

  function openCorrectDateModal(stage: ProgrammingStage) {
    setCorrectDateTarget(stage);
    setCorrectDateValue(stage.executionDate ?? "");
    setCorrectDateReason("");
  }

  async function confirmCorrectDate() {
    if (!correctDateTarget) return;
    const reason = correctDateReason.trim();
    if (!correctDateValue || !reason) return;

    const result = await actions.correctDate(correctDateTarget.id, correctDateValue, reason, correctDateTarget.updatedAt);
    if (result.ok) setCorrectDateTarget(null);
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
          Projeto concluido em {activeCompletedStage.executionDate}. Reabra a etapa concluida antes de inserir, editar, adicionar equipe, adiar ou cancelar
          {canPendencia ? " — exceto criar uma etapa de Pendencia (marque a checkbox no formulario), que e permitida sem reabrir." : "."}
          {!canComplete ? " Voce nao tem permissao para reabrir etapa concluida: peca a um administrador." : ""}
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
              && canSubmitTeamForemen
          }
          teamOptions={teams}
          foremanOptions={meta?.foremen ?? []}
          allowBlankForemanTeamIds={allowBlankForemanTeamIds}
          sgdTypes={meta?.sgdTypes ?? []}
          electricalEqCatalog={meta?.electricalEqCatalog ?? []}
          supportOptions={meta?.supportOptions ?? []}
          activityOptions={activityOptions}
          isLoadingActivities={isLoadingActivities}
          onSubmit={submitForm}
          onCancelEdit={editingStageId ? cancelEdit : onBack}
          canPendencia={canPendencia}
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
              onAddTeam={() => openAddTeamModal(stage)}
              onRemoveTeam={(programmingTeamId, expectedUpdatedAt) => actions.removeTeam(programmingTeamId, expectedUpdatedAt)}
              onCancelTeamParticipation={(team) => openCancelTeam(team, stage)}
              onPostponeTeam={(team) => openPostponeTeam(team, stage)}
              onPostpone={() => openPostponeModal(stage)}
              onCancel={() => openCancelModal(stage)}
              onComplete={() => actions.complete(stage.id, stage.updatedAt)}
              onReopen={() => actions.reopen(stage.id, stage.updatedAt)}
              onTogglePendencia={(next) => openPendenciaModal(stage, next)}
              onCorrectDate={() => openCorrectDateModal(stage)}
              onDetails={() => setDetailsTarget(stage)}
              onHistory={() => historyModal.openHistory(stage)}
              canComplete={canComplete}
              canPendencia={canPendencia}
              canCorrectDate={canCorrectDate}
            />
          ))}
        </div>
      </div>

      <PostponeModal
        isOpen={Boolean(postponeTarget)}
        mode={postponeMode}
        isResumeFromHold={Boolean(postponeTarget && isOnHoldStage(postponeTarget))}
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

      <CancelTeamModal
        isOpen={Boolean(cancelTeamTarget)}
        teamName={cancelTeamTarget?.team.teamName ?? ""}
        reasonCode={cancelTeamReasonCode}
        reasonNotes={cancelTeamReasonNotes}
        reasonOptions={reasonOptions}
        isSubmitting={actions.isSubmitting}
        onClose={() => setCancelTeamTarget(null)}
        onConfirm={confirmCancelTeam}
        onReasonCodeChange={setCancelTeamReasonCode}
        onReasonNotesChange={setCancelTeamReasonNotes}
      />

      <PostponeTeamModal
        isOpen={Boolean(postponeTeamTarget)}
        teamName={postponeTeamTarget?.team.teamName ?? ""}
        newDate={postponeTeamDate}
        reasonCode={postponeTeamReasonCode}
        reasonNotes={postponeTeamReasonNotes}
        reasonOptions={reasonOptions}
        isSubmitting={actions.isSubmitting}
        onClose={() => setPostponeTeamTarget(null)}
        onConfirm={confirmPostponeTeam}
        onNewDateChange={setPostponeTeamDate}
        onReasonCodeChange={setPostponeTeamReasonCode}
        onReasonNotesChange={setPostponeTeamReasonNotes}
      />

      <LastActiveTeamModal
        isOpen={Boolean(lastActiveTeamPrompt)}
        teamName={lastActiveTeamPrompt?.team.teamName ?? ""}
        isSubmitting={actions.isSubmitting}
        onClose={() => setLastActiveTeamPrompt(null)}
        onCancelWholeStage={cancelWholeStageFromLastTeamPrompt}
        onKeepWithoutTeam={() => void confirmKeepStageWithoutTeam()}
      />

      <PendenciaModal
        target={pendenciaTarget}
        nextValue={pendenciaNext}
        reason={pendenciaReason}
        description={pendenciaDescription}
        originId={pendenciaOriginId}
        originOptions={sortedStages.filter((item) => item.id !== pendenciaTarget?.id && Boolean(item.workCompletionStatus))}
        isSubmitting={actions.isSubmitting}
        onClose={() => setPendenciaTarget(null)}
        onConfirm={confirmPendencia}
        onReasonChange={setPendenciaReason}
        onDescriptionChange={setPendenciaDescription}
        onOriginChange={setPendenciaOriginId}
      />

      <CorrectDateModal
        target={correctDateTarget}
        newDate={correctDateValue}
        reason={correctDateReason}
        isSubmitting={actions.isSubmitting}
        onClose={() => setCorrectDateTarget(null)}
        onConfirm={confirmCorrectDate}
        onNewDateChange={setCorrectDateValue}
        onReasonChange={setCorrectDateReason}
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

      <AddTeamModal
        isOpen={Boolean(addTeamTarget)}
        availableTeams={addTeamAvailableTeams}
        foremanOptions={meta?.foremen ?? []}
        selectedTeamId={addTeamSelectedId}
        selectedForemanId={addTeamSelectedForemanId}
        isSubmitting={actions.isSubmitting}
        executionDate={addTeamTarget?.executionDate ?? null}
        startTime={addTeamTarget?.startTime ?? null}
        endTime={addTeamTarget?.endTime ?? null}
        check={addTeamCheck}
        onClose={closeAddTeamModal}
        onConfirm={confirmAddTeam}
        onSelectedTeamIdChange={selectTeamToAdd}
        onSelectedForemanIdChange={setAddTeamSelectedForemanId}
      />

      <DetailsModal target={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </div>
  );
}
