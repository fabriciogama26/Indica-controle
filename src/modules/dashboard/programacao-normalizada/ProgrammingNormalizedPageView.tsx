"use client";

import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { downloadCsvFile } from "@/lib/utils/csv";

import { AddTeamModal, CancelModal, DetailsModal, HistoryModal, PostponeModal } from "./components";
import { STAGE_LIST_PAGE_SIZE, createDefaultListFilters } from "./constants";
import { buildEnelCsvContent, buildEnelNovoWorkbookData, buildProgrammingCsvContent } from "./exports";
import { fetchProgrammingPlan, fetchProgrammingStageDetails, fetchProgrammingStageList } from "./api";
import { useHistoryModal, useProgrammingMeta, useProgrammingStageActions, useProgrammingStageList } from "./hooks";
import { ListFiltersBar, SobEntryBar, StageListTable } from "./listComponents";
import styles from "./ProgrammingNormalizedPageView.module.css";
import { ProjectPlanView } from "./ProjectPlanView";
import { buildReasonText } from "./validators";
import { toIsoDate } from "./utils";
import type { FeedbackState, ProgrammingStage, StageListItem } from "./types";

export function ProgrammingNormalizedPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("programacao_normalizada");
  const accessToken = session?.accessToken ?? null;
  const today = useMemo(() => toIsoDate(new Date()), []);

  const [activeProject, setActiveProject] = useState<{ id: string; code: string } | null>(null);
  const [sob, setSob] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [filters, setFilters] = useState(() => createDefaultListFilters(today));

  const [postponeTarget, setPostponeTarget] = useState<StageListItem | null>(null);
  const [postponeMode, setPostponeMode] = useState<"DATE" | "HOLD">("DATE");
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReasonCode, setPostponeReasonCode] = useState("");
  const [postponeReasonNotes, setPostponeReasonNotes] = useState("");

  const [cancelTarget, setCancelTarget] = useState<StageListItem | null>(null);
  const [cancelReasonCode, setCancelReasonCode] = useState("");
  const [cancelReasonNotes, setCancelReasonNotes] = useState("");

  const [addTeamTarget, setAddTeamTarget] = useState<StageListItem | null>(null);
  const [addTeamSelectedId, setAddTeamSelectedId] = useState("");

  const [detailsTarget, setDetailsTarget] = useState<ProgrammingStage | null>(null);

  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingEnel, setIsExportingEnel] = useState(false);
  const [isExportingEnelNovo, setIsExportingEnelNovo] = useState(false);
  const commonExportCooldown = useExportCooldown();
  const enelExportCooldown = useExportCooldown();

  const { meta } = useProgrammingMeta({ accessToken, onError: logError });
  const { items, total, page, setPage, isLoadingList, reloadList } = useProgrammingStageList({ accessToken, filters, onError: logError });
  const historyModal = useHistoryModal({ accessToken, onError: logError });
  const actions = useProgrammingStageActions({ accessToken, setFeedback, onSuccess: reloadList, onError: logError });

  const projects = meta?.projects ?? [];
  const teams = meta?.teams ?? [];
  const reasonOptions = meta?.reasonOptions ?? [];
  const sgdTypes = meta?.sgdTypes ?? [];
  const electricalEqCatalog = meta?.electricalEqCatalog ?? [];
  const supportOptions = meta?.supportOptions ?? [];
  const totalPages = Math.max(1, Math.ceil(total / STAGE_LIST_PAGE_SIZE));

  async function fetchAllFilteredStages() {
    if (!accessToken) return [] as StageListItem[];
    const data = await fetchProgrammingStageList({ accessToken, filters, page: 1, pageSize: 1, forExport: true });
    return data.list ?? [];
  }

  const fetchProjectStages = useCallback(
    async (projectId: string): Promise<StageListItem[]> => {
      if (!accessToken) return [];
      const plan = await fetchProgrammingPlan({ accessToken, projectId });
      const sample = items.find((item) => item.projectId === projectId);
      return plan.map((stage) => ({ ...stage, projectCode: sample?.projectCode ?? "", city: sample?.city ?? "" }));
    },
    [accessToken, items]
  );

  function buildExportContext(stages: StageListItem[]) {
    return {
      stages,
      projectMap: new Map(projects.map((project) => [project.id, project])),
      teamMap: new Map(teams.map((team) => [team.id, team])),
      sgdTypeMap: new Map(sgdTypes.map((item) => [item.id, item])),
      eqCatalogMap: new Map(electricalEqCatalog.map((item) => [item.id, item])),
      supportOptionMap: new Map(supportOptions.map((item) => [item.id, item])),
    };
  }

  async function handleExportCsv() {
    if (!commonExportCooldown.tryStart()) {
      setFeedback({ type: "error", message: `Aguarde ${commonExportCooldown.getRemainingSeconds()}s antes de exportar novamente.` });
      return;
    }

    setIsExportingCsv(true);
    try {
      const stages = await fetchAllFilteredStages();
      if (!stages.length) {
        setFeedback({ type: "error", message: "Nenhuma etapa encontrada para exportar com os filtros atuais." });
        return;
      }

      const csv = buildProgrammingCsvContent(buildExportContext(stages));
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_normalizada_${exportDate}.csv`);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar programacao em CSV." });
      await logError("Falha ao exportar programacao normalizada em CSV.", error, { operation: "export_programming_csv" });
    } finally {
      setIsExportingCsv(false);
    }
  }

  async function handleExportEnel() {
    if (!enelExportCooldown.tryStart()) {
      setFeedback({ type: "error", message: `Aguarde ${enelExportCooldown.getRemainingSeconds()}s antes de exportar novamente.` });
      return;
    }

    setIsExportingEnel(true);
    try {
      const stages = await fetchAllFilteredStages();
      if (!stages.length) {
        setFeedback({ type: "error", message: "Nenhuma etapa encontrada para exportar no layout ENEL." });
        return;
      }

      const csv = buildEnelCsvContent(buildExportContext(stages));
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_normalizada_enel_${exportDate}.csv`);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao gerar extracao ENEL." });
      await logError("Falha ao gerar extracao ENEL (programacao normalizada).", error, { operation: "export_enel_csv" });
    } finally {
      setIsExportingEnel(false);
    }
  }

  async function handleExportEnelNovo() {
    if (!enelExportCooldown.tryStart()) {
      setFeedback({ type: "error", message: `Aguarde ${enelExportCooldown.getRemainingSeconds()}s antes de exportar novamente.` });
      return;
    }

    setIsExportingEnelNovo(true);
    try {
      const stages = await fetchAllFilteredStages();
      const workbookData = buildEnelNovoWorkbookData(buildExportContext(stages));

      if (!workbookData.eligibleCount) {
        setFeedback({ type: "error", message: "Nenhuma etapa elegivel para EXTRACAO ENEL NOVO (Tipo de Serviço EMERGENCIAL nao entra)." });
        return;
      }

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.aoa_to_sheet([workbookData.header, ...workbookData.rows]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "EXTRACAO_ENEL");
      const workbookArray = XLSX.write(workbook, { bookType: "xlsb", type: "array" }) as ArrayBuffer;
      const blob = new Blob([workbookArray], { type: "application/vnd.ms-excel.sheet.binary.macroEnabled.12" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "PROGRAMACAO_NORMALIZADA.xlsb";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao gerar EXTRACAO ENEL NOVO." });
      await logError("Falha ao gerar EXTRACAO ENEL NOVO (programacao normalizada).", error, { operation: "export_enel_novo_xlsb" });
    } finally {
      setIsExportingEnelNovo(false);
    }
  }

  function openProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    setActiveProject({ id: projectId, code: project?.code ?? projectId });
  }

  function openOrCreateBySob() {
    const normalizedSob = sob.trim().toLowerCase();
    if (!normalizedSob) return;

    const matches = projects.filter((project) => project.code.toLowerCase() === normalizedSob);
    const project = matches[0] ?? projects.find((item) => item.code.toLowerCase().includes(normalizedSob));

    if (!project) {
      setFeedback({ type: "error", message: `Nenhum projeto encontrado com o SOB "${sob.trim()}". Cadastre o projeto em Projetos antes de programar.` });
      return;
    }

    setFeedback(null);
    setActiveProject({ id: project.id, code: project.code });
  }

  function clearFilters() {
    setFilters(createDefaultListFilters(today));
  }

  async function confirmPostpone() {
    if (!postponeTarget) return;
    const reasonLabel = buildReasonText(reasonOptions, postponeReasonCode, postponeReasonNotes);
    if (!reasonLabel) return;

    const newDate = postponeMode === "HOLD" ? null : postponeDate;
    if (postponeMode === "DATE" && !newDate) return;

    const result = await actions.postpone(postponeTarget.id, newDate, reasonLabel, postponeTarget.updatedAt);
    if (result.ok) setPostponeTarget(null);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const reasonLabel = buildReasonText(reasonOptions, cancelReasonCode, cancelReasonNotes);
    if (!reasonLabel) return;

    const result = await actions.cancel(cancelTarget.id, reasonLabel, cancelTarget.updatedAt);
    if (result.ok) setCancelTarget(null);
  }

  async function confirmAddTeam() {
    if (!addTeamTarget || !addTeamSelectedId) return;
    const result = await actions.addTeam(addTeamTarget.id, addTeamSelectedId);
    if (result.ok) {
      setAddTeamTarget(null);
      setAddTeamSelectedId("");
    }
  }

  async function openDetails(stage: StageListItem) {
    if (!accessToken) return;
    try {
      const fullStage = await fetchProgrammingStageDetails({ accessToken, programmingId: stage.id });
      setDetailsTarget(fullStage);
    } catch (error) {
      await logError("Falha ao carregar detalhes da etapa.", error, { operation: "load_stage_details", programmingId: stage.id });
    }
  }

  async function handleReopen(stage: StageListItem) {
    await actions.reopen(stage.id, stage.updatedAt);
  }

  async function handleRemoveTeam(programmingTeamId: string) {
    const target = items.flatMap((item) => item.teams).find((team) => team.id === programmingTeamId);
    await actions.removeTeam(programmingTeamId, target?.updatedAt ?? "");
  }

  if (activeProject) {
    return (
      <ProjectPlanView
        accessToken={accessToken}
        projectId={activeProject.id}
        projectCode={activeProject.code}
        onBack={() => {
          setActiveProject(null);
          void reloadList();
        }}
      />
    );
  }

  const addTeamAvailableTeams = addTeamTarget
    ? teams.filter((team) => !addTeamTarget.teams.some((active) => active.teamId === team.id))
    : [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2>Programacao</h2>
        <p className={styles.emptyHint}>Busque um SOB para abrir o plano de etapas, ou crie um novo.</p>
      </div>

      {feedback ? (
        <div className={feedback.type === "success" ? `${styles.feedback} ${styles.feedbackSuccess}` : `${styles.feedback} ${styles.feedbackError}`}>
          {feedback.message}
        </div>
      ) : null}

      <SobEntryBar sob={sob} setSob={setSob} onSubmit={openOrCreateBySob} isSubmitting={false} projects={projects} />

      <ListFiltersBar filters={filters} setFilters={setFilters} todayIso={today} teams={teams} total={total} onClear={clearFilters} />

      <StageListTable
        items={items}
        isLoading={isLoadingList}
        isSubmitting={actions.isSubmitting}
        onOpenProject={openProject}
        fetchProjectStages={fetchProjectStages}
        onAddTeam={(stage) => setAddTeamTarget(stage)}
        onPostpone={(stage) => {
          setPostponeTarget(stage);
          setPostponeMode("DATE");
          setPostponeDate("");
          setPostponeReasonCode("");
          setPostponeReasonNotes("");
        }}
        onCancel={(stage) => {
          setCancelTarget(stage);
          setCancelReasonCode("");
          setCancelReasonNotes("");
        }}
        onHistory={(stage) => historyModal.openHistory(stage)}
        onDetails={openDetails}
        onReopen={handleReopen}
        onRemoveTeam={handleRemoveTeam}
        onChangeWorkCompletionStatus={(stage, value) => void actions.changeWorkCompletionStatus(stage, value)}
        isExportingCsv={isExportingCsv}
        isExportingEnel={isExportingEnel}
        isExportingEnelNovo={isExportingEnelNovo}
        isExportCoolingDown={commonExportCooldown.isCoolingDown}
        isEnelExportCoolingDown={enelExportCooldown.isCoolingDown}
        onExportCsv={() => void handleExportCsv()}
        onExportEnel={() => void handleExportEnel()}
        onExportEnelNovo={() => void handleExportEnelNovo()}
      />

      {totalPages > 1 ? (
        <div className={styles.filtersSummary}>
          <button type="button" className={styles.buttonSecondary} onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
            Anterior
          </button>
          <span className={styles.emptyHint}>Pagina {page} de {totalPages}</span>
          <button type="button" className={styles.buttonSecondary} onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
            Proxima
          </button>
        </div>
      ) : null}

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

      <AddTeamModal
        isOpen={Boolean(addTeamTarget)}
        availableTeams={addTeamAvailableTeams}
        selectedTeamId={addTeamSelectedId}
        isSubmitting={actions.isSubmitting}
        onClose={() => setAddTeamTarget(null)}
        onConfirm={confirmAddTeam}
        onSelectedTeamIdChange={setAddTeamSelectedId}
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
