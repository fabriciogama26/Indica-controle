"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { downloadCsvFile } from "@/lib/utils/csv";
import { formatWorksheetDateColumn } from "@/lib/utils/xlsx";

import {
  AddTeamModal,
  CancelModal,
  CancelTeamModal,
  DetailsModal,
  HistoryModal,
  LastActiveTeamModal,
  PostponeModal,
  PostponeTeamModal,
} from "./components/modals";
import { STAGE_LIST_PAGE_SIZE, createDefaultListFilters } from "./constants";
import { buildEnelCsvContent, buildEnelNovoWorkbookData, buildProgrammingCsvContent } from "./exports";
import { fetchProgrammingPlan, fetchProgrammingStageDetails, fetchProgrammingStageList } from "./api";
import {
  useAddTeamPrecheck,
  useHistoryModal,
  useProgrammingGranularPermissions,
  useProgrammingMeta,
  useProgrammingStageActions,
  useProgrammingStageList,
} from "./hooks";
import { ListFiltersBar, SobEntryBar, StageListTable } from "./listComponents";
import styles from "./ProgrammingNormalizedPageView.module.css";
import { ProgrammingWeeklyCalendarPanel } from "./components/ProgrammingWeeklyCalendarPanel";
import { ProjectPlanView } from "./ProjectPlanView";
import { buildReasonText } from "./validators";
import { addDaysIso, isOnHoldStage, startOfWeekMondayIso, toIsoDate } from "./utils";
import type { FeedbackState, ProgrammingStage, StageListItem, StageTeam } from "./types";

// `consulta` e o modo de `/programacao-visualizacao` (C4 do corte): esconde toda
// a escrita e acrescenta o Calendario Semanal, que era o motivo daquela tela
// existir. Leitura, filtros, detalhe, historico e exportacoes continuam iguais.
export type ProgrammingNormalizedPageViewMode = "cadastro" | "consulta";

export function ProgrammingNormalizedPageView({ mode = "cadastro" }: { mode?: ProgrammingNormalizedPageViewMode } = {}) {
  const { session } = useAuth();
  const logError = useErrorLogger("programacao_normalizada");
  const accessToken = session?.accessToken ?? null;
  const today = useMemo(() => toIsoDate(new Date()), []);
  const isConsultaMode = mode === "consulta";
  const [weekStartDate, setWeekStartDate] = useState(() => startOfWeekMondayIso(toIsoDate(new Date())));

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

  const [cancelTeamTarget, setCancelTeamTarget] = useState<{ team: StageTeam; stage: StageListItem } | null>(null);
  const [cancelTeamReasonCode, setCancelTeamReasonCode] = useState("");
  const [cancelTeamReasonNotes, setCancelTeamReasonNotes] = useState("");

  const [postponeTeamTarget, setPostponeTeamTarget] = useState<{ team: StageTeam; stage: StageListItem } | null>(null);
  const [postponeTeamDate, setPostponeTeamDate] = useState("");
  const [postponeTeamReasonCode, setPostponeTeamReasonCode] = useState("");
  const [postponeTeamReasonNotes, setPostponeTeamReasonNotes] = useState("");

  // Cancelar/adiar a ULTIMA equipe ativa de uma etapa abre este prompt em vez
  // de gravar direto (reason LAST_ACTIVE_TEAM das RPCs 349).
  const [lastActiveTeamPrompt, setLastActiveTeamPrompt] = useState<{
    kind: "cancel" | "postpone";
    team: StageTeam;
    stage: StageListItem;
    reason: string;
    newDate?: string;
  } | null>(null);

  const [addTeamTarget, setAddTeamTarget] = useState<StageListItem | null>(null);
  const [addTeamSelectedId, setAddTeamSelectedId] = useState("");

  const [detailsTarget, setDetailsTarget] = useState<ProgrammingStage | null>(null);

  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingEnel, setIsExportingEnel] = useState(false);
  const [isExportingEnelNovo, setIsExportingEnelNovo] = useState(false);
  const commonExportCooldown = useExportCooldown();
  const enelExportCooldown = useExportCooldown();

  const { canComplete } = useProgrammingGranularPermissions();
  const { meta } = useProgrammingMeta({ accessToken, onError: logError });
  const { items, total, page, setPage, isLoadingList, listToday, listError, reloadList } = useProgrammingStageList({ accessToken, filters, onError: logError });
  const historyModal = useHistoryModal({ accessToken, onError: logError });
  const actions = useProgrammingStageActions({ accessToken, setFeedback, onSuccess: reloadList, onError: logError });
  const addTeamCheck = useAddTeamPrecheck({ accessToken, programmingId: addTeamTarget?.id ?? null, teamId: addTeamSelectedId });

  const projects = meta?.projects ?? [];
  const teams = meta?.teams ?? [];
  const reasonOptions = meta?.reasonOptions ?? [];
  const sgdTypes = meta?.sgdTypes ?? [];
  const electricalEqCatalog = meta?.electricalEqCatalog ?? [];
  const workCompletionCatalog = meta?.workCompletionCatalog ?? [];
  const supportOptions = meta?.supportOptions ?? [];
  const totalPages = Math.max(1, Math.ceil(total / STAGE_LIST_PAGE_SIZE));

  // FAN-OUT etapa -> equipe para o Calendario Semanal (modo consulta).
  // O calendario e uma grade (equipe x dia), e a etapa normalizada tem N equipes.
  // Uma etapa com 2 equipes ATIVAS ocupa 2 celulas — que e exatamente o que a
  // tela antiga mostrava, onde cada linha ja era uma equipe. Mesmo criterio de
  // equipe ATIVA usado no endpoint de fontes da Medicao (C0).
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysIso(weekStartDate, index)),
    [weekStartDate],
  );
  // O calendario NAO pode ser alimentado por `items`: a lista e paginada
  // (STAGE_LIST_PAGE_SIZE = 50) sobre uma janela padrao de 90 dias, entao uma
  // semana apareceria vazia so porque suas etapas caem na pagina 3 — truncagem
  // silenciosa, a mesma classe de bug que o P0 do dash-estoque corrigiu.
  // Por isso a semana e carregada a parte, com os MESMOS filtros do usuario
  // (equipe, status, busca, municipio) porem com a janela de data trocada pela
  // semana exibida.
  const [weekStages, setWeekStages] = useState<StageListItem[]>([]);
  const [isLoadingWeek, setIsLoadingWeek] = useState(false);

  useEffect(() => {
    if (!isConsultaMode || !accessToken) {
      setWeekStages([]);
      return;
    }

    let ignore = false;
    setIsLoadingWeek(true);

    fetchProgrammingStageList({
      accessToken,
      filters: { ...filters, dateFrom: weekStartDate, dateTo: addDaysIso(weekStartDate, 6) },
      page: 1,
      pageSize: 1,
      forExport: true,
    })
      .then((data) => {
        if (ignore) return;
        setWeekStages(data.list ?? []);
      })
      .catch((error) => {
        if (ignore) return;
        setWeekStages([]);
        logError(error, { scope: "programacao_normalizada_calendario_semanal" });
      })
      .finally(() => {
        if (!ignore) setIsLoadingWeek(false);
      });

    return () => {
      ignore = true;
    };
  }, [accessToken, filters, isConsultaMode, logError, weekStartDate]);

  const weeklyStageMap = useMemo(() => {
    const map = new Map<string, StageListItem[]>();
    if (!isConsultaMode) return map;

    const weekDateSet = new Set(weekDates);
    for (const stage of weekStages) {
      if (!stage.executionDate || !weekDateSet.has(stage.executionDate)) continue;

      for (const team of stage.teams) {
        if (team.status !== "ATIVA") continue;
        const key = `${team.teamId}__${stage.executionDate}`;
        const list = map.get(key) ?? [];
        list.push(stage);
        map.set(key, list);
      }
    }

    return map;
  }, [isConsultaMode, weekStages, weekDates]);
  const calendarTeams = useMemo(
    () => [...teams].sort((left, right) => left.name.localeCompare(right.name)),
    [teams],
  );

  async function fetchAllFilteredStages() {
    if (!accessToken) return { stages: [] as StageListItem[], truncated: false, total: 0 };
    const data = await fetchProgrammingStageList({ accessToken, filters, page: 1, pageSize: 1, forExport: true });
    return { stages: data.list ?? [], truncated: data.truncated === true, total: data.total ?? 0 };
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
      const { stages, truncated, total } = await fetchAllFilteredStages();
      if (!stages.length) {
        setFeedback({ type: "error", message: "Nenhuma etapa encontrada para exportar com os filtros atuais." });
        return;
      }

      const csv = buildProgrammingCsvContent(buildExportContext(stages));
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_normalizada_${exportDate}.csv`);
      if (truncated) {
        setFeedback({ type: "error", message: `Exportados ${stages.length} de ${total} registros. Restrinja o periodo ou os filtros para exportar o restante.` });
      }
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
      const { stages, truncated, total } = await fetchAllFilteredStages();
      if (!stages.length) {
        setFeedback({ type: "error", message: "Nenhuma etapa encontrada para exportar no layout ENEL." });
        return;
      }

      const csv = buildEnelCsvContent(buildExportContext(stages));
      const exportDate = new Date().toISOString().slice(0, 10);
      downloadCsvFile(csv, `programacao_normalizada_enel_${exportDate}.csv`);
      if (truncated) {
        setFeedback({ type: "error", message: `Exportados ${stages.length} de ${total} registros. Restrinja o periodo ou os filtros para exportar o restante.` });
      }
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
      const { stages, truncated, total } = await fetchAllFilteredStages();
      const workbookData = buildEnelNovoWorkbookData(buildExportContext(stages));

      if (!workbookData.eligibleCount) {
        setFeedback({ type: "error", message: "Nenhuma etapa elegivel para EXTRACAO ENEL NOVO (Tipo de Serviço EMERGENCIAL nao entra)." });
        return;
      }

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.aoa_to_sheet([workbookData.header, ...workbookData.rows]);
      formatWorksheetDateColumn(worksheet, { columnLetter: "D", dataRowCount: workbookData.rows.length });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "EXTRACAO_ENEL");
      const workbookArray = XLSX.write(workbook, { bookType: "xlsb", type: "array" }) as ArrayBuffer;
      const blob = new Blob([workbookArray], { type: "application/vnd.ms-excel.sheet.binary.macroEnabled.12" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "PROGRAMAÇÃO_ANGRA_INDICA.xlsb";
      link.click();
      URL.revokeObjectURL(url);
      if (truncated) {
        setFeedback({ type: "error", message: `Exportados ${stages.length} de ${total} registros. Restrinja o periodo ou os filtros para exportar o restante.` });
      }
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

  function openCancelTeam(team: StageTeam, stage: StageListItem) {
    setCancelTeamTarget({ team, stage });
    setCancelTeamReasonCode("");
    setCancelTeamReasonNotes("");
  }

  function openPostponeTeam(team: StageTeam, stage: StageListItem) {
    setPostponeTeamTarget({ team, stage });
    setPostponeTeamDate("");
    setPostponeTeamReasonCode("");
    setPostponeTeamReasonNotes("");
  }

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
    setCancelTarget(lastActiveTeamPrompt.stage);
    setCancelReasonCode("");
    setCancelReasonNotes("");
    setLastActiveTeamPrompt(null);
  }

  // Abrir/fechar SEMPRE zeram a equipe selecionada: um id remanescente de outra
  // etapa dispararia a pre-checagem contra a etapa errada e ainda poderia apontar
  // para uma equipe que nem aparece no select desta etapa.
  function openAddTeamModal(stage: StageListItem) {
    setAddTeamTarget(stage);
    setAddTeamSelectedId("");
  }

  function closeAddTeamModal() {
    setAddTeamTarget(null);
    setAddTeamSelectedId("");
  }

  async function confirmAddTeam() {
    if (!addTeamTarget || !addTeamSelectedId) return;
    const selectedTeam = teams.find((team) => team.id === addTeamSelectedId);
    const result = await actions.addTeam(addTeamTarget.id, addTeamSelectedId, selectedTeam?.foremanId ?? null);
    if (result.ok) closeAddTeamModal();
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

  // So alocacao ATIVA ocupa a vaga: a unique index do banco
  // (uq_programming_team_active_per_stage) permite readicionar uma equipe que foi
  // REMOVIDA/TRANSFERIDA, entao ela precisa voltar a aparecer no select.
  const addTeamAvailableTeams = addTeamTarget
    ? teams.filter((team) => !addTeamTarget.teams.some((active) => active.teamId === team.id && active.status === "ATIVA"))
    : [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2>{isConsultaMode ? "Visualizacao da Programacao" : "Programacao"}</h2>
        <p className={styles.emptyHint}>
          {isConsultaMode
            ? "Consulta da programacao: lista de etapas, calendario semanal, detalhe, historico e extracoes."
            : "Busque um SOB para abrir o plano de etapas, ou crie um novo."}
        </p>
      </div>

      {feedback ? (
        <div className={feedback.type === "success" ? `${styles.feedback} ${styles.feedbackSuccess}` : `${styles.feedback} ${styles.feedbackError}`}>
          {feedback.message}
        </div>
      ) : null}

      {/* Entrada por SOB abre o plano de etapas, que e a superficie de escrita —
          fora do modo consulta. */}
      {isConsultaMode ? null : (
        <SobEntryBar sob={sob} setSob={setSob} onSubmit={openOrCreateBySob} isSubmitting={false} projects={projects} />
      )}

      <ListFiltersBar
        filters={filters}
        setFilters={setFilters}
        todayIso={today}
        teams={teams}
        workCompletionCatalog={workCompletionCatalog}
        total={total}
        onClear={clearFilters}
      />

      {isConsultaMode ? (
        <ProgrammingWeeklyCalendarPanel
          weekStartDate={weekStartDate}
          weekDates={weekDates}
          calendarTeams={calendarTeams}
          weeklyStageMap={weeklyStageMap}
          sgdTypes={sgdTypes}
          isLoading={isLoadingWeek}
          onPreviousWeek={() => setWeekStartDate((current) => addDaysIso(current, -7))}
          onCurrentWeek={() => setWeekStartDate(startOfWeekMondayIso(today))}
          onNextWeek={() => setWeekStartDate((current) => addDaysIso(current, 7))}
          onRefresh={() => {
            // Recarrega a lista e a semana: sao duas cargas independentes de
            // proposito (ver o comentario de `weekStages`).
            reloadList();
            setWeekStartDate((current) => current);
            setFilters((current) => ({ ...current }));
          }}
          onOpenDetails={(stage) => void openDetails(stage)}
          onOpenHistory={(stage) => historyModal.setHistoryTarget({ id: stage.id, executionDate: stage.executionDate })}
        />
      ) : null}

      <StageListTable
        isReadOnly={isConsultaMode}
        items={items}
        isLoading={isLoadingList}
        loadError={listError}
        isSubmitting={actions.isSubmitting}
        todayIso={listToday}
        onOpenProject={openProject}
        fetchProjectStages={fetchProjectStages}
        onAddTeam={openAddTeamModal}
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
        onCancelTeam={openCancelTeam}
        onPostponeTeam={openPostponeTeam}
        onChangeWorkCompletionStatus={(stage, value) => void actions.changeWorkCompletionStatus(stage, value)}
        canComplete={canComplete}
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

      <AddTeamModal
        isOpen={Boolean(addTeamTarget)}
        availableTeams={addTeamAvailableTeams}
        selectedTeamId={addTeamSelectedId}
        isSubmitting={actions.isSubmitting}
        executionDate={addTeamTarget?.executionDate ?? null}
        startTime={addTeamTarget?.startTime ?? null}
        endTime={addTeamTarget?.endTime ?? null}
        check={addTeamCheck}
        onClose={closeAddTeamModal}
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
