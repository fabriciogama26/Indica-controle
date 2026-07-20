import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";

import { DATE_RANGE_SHORTCUTS, LIST_SEARCH_DEBOUNCE_MS, STATUS_CHIP_OPTIONS, WORK_COMPLETION_SELECT_OPTIONS } from "./constants";
import styles from "./ProgrammingNormalizedPageView.module.css";
import { formatDate, getStageClassificationLabel, getStageStatusLabel, getWorkCompletionLabel, isActiveStageStatus } from "./utils";
import type { StageListFilters, StageListItem, TeamItem } from "./types";

type ProjectListGroup = {
  projectId: string;
  projectCode: string;
  stages: StageListItem[];
  activeTeamCount: number;
};

function SearchIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={props.className}>
      <circle cx="11" cy="11" r="6.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="m19.5 19.5-4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function ClassificationBadge(props: { stage: Pick<StageListItem, "etapaUnica" | "etapaFinal" | "etapaNumber" | "workCompletionStatus" | "status"> }) {
  const { stage } = props;
  const label = getStageClassificationLabel(stage);
  const variant = stage.workCompletionStatus === "PENDENCIA"
    ? styles.badgePendencia
    : !isActiveStageStatus(stage.status)
      ? styles.badgeMuted
      : stage.etapaFinal
        ? styles.badgeWarning
        : styles.badgeAccent;

  return <span className={`${styles.badge} ${variant}`}>{label}</span>;
}

// Status da agenda: sempre somente leitura, refletido automaticamente pelo
// sistema (nunca editado direto pelo usuario â€” Programada/Reprogramada vem do
// cadastro/edicao de data, Adiada/Cancelada dos botoes, Antecipada da cascata
// de Concluir).
export function StatusBadge(props: { status: string }) {
  const { status } = props;
  const label = getStageStatusLabel(status);
  const variant = status === "PROGRAMADA"
    ? styles.badgeSuccess
    : status === "REPROGRAMADA"
      ? styles.badgeAccent
      : styles.badgeMuted; // ADIADA, CANCELADA, ANTECIPADA (apagado/neutro)

  return <span className={`${styles.badge} ${variant}`}>{label}</span>;
}

function getWorkCompletionBadgeVariant(workCompletionStatus: string | null) {
  if (workCompletionStatus === "PARCIAL_PLANEJADO" || workCompletionStatus === "PARCIAL_NAO_PLANEJADO") return styles.badgeWarning;
  if (workCompletionStatus === "BENEFICIO_ATINGIDO") return styles.badgeAccent;
  if (workCompletionStatus === "CONCLUIDO") return styles.badgeSuccess;
  if (workCompletionStatus === "PENDENCIA") return styles.badgeDanger;
  return styles.badgeMuted; // em branco, ANTECIPADO (apagado)
}

// Estado do trabalho: unico eixo editavel pelo usuario, via select â€” mas so
// enquanto a etapa estiver ativa e nao tiver sido antecipada automaticamente
// (nesses casos vira so um badge de leitura, mesma paleta do select).
export function WorkCompletionCell(props: {
  stage: StageListItem;
  isSubmitting: boolean;
  onChange: (stage: StageListItem, value: string | null) => void;
}) {
  const { stage, isSubmitting, onChange } = props;
  const isEditable = isActiveStageStatus(stage.status) && stage.workCompletionStatus !== "ANTECIPADO";

  if (!isEditable) {
    return <span className={`${styles.badge} ${getWorkCompletionBadgeVariant(stage.workCompletionStatus)}`}>{getWorkCompletionLabel(stage.workCompletionStatus)}</span>;
  }

  return (
    <select
      className={`${styles.workCompletionSelect} ${getWorkCompletionBadgeVariant(stage.workCompletionStatus)}`}
      value={stage.workCompletionStatus ?? ""}
      onChange={(event) => onChange(stage, event.target.value || null)}
      disabled={isSubmitting}
      aria-label={`Estado do trabalho da etapa ${stage.projectCode}`}
    >
      {WORK_COMPLETION_SELECT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export function StatusChips(props: { value: StageListFilters["statusChip"]; onChange: (value: StageListFilters["statusChip"]) => void }) {
  return (
    <div className={styles.chipRow}>
      {STATUS_CHIP_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === props.value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DateRangeFilter(props: {
  dateFrom: string;
  dateTo: string;
  todayIso: string;
  onChange: (range: { dateFrom: string; dateTo: string }) => void;
}) {
  const { dateFrom, dateTo, todayIso, onChange } = props;

  return (
    <div className={styles.dateRangeRow}>
      <label className={styles.field}>
        <span>De</span>
        <input type="date" value={dateFrom} onChange={(event) => onChange({ dateFrom: event.target.value, dateTo })} />
      </label>
      <label className={styles.field}>
        <span>Ate</span>
        <input type="date" value={dateTo} onChange={(event) => onChange({ dateFrom, dateTo: event.target.value })} />
      </label>
      <div className={styles.shortcutRow}>
        {DATE_RANGE_SHORTCUTS.map((shortcut) => (
          <button key={shortcut.label} type="button" className={styles.shortcutButton} onClick={() => onChange(shortcut.range(todayIso))}>
            {shortcut.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TeamMultiSelectFilter(props: { teams: TeamItem[]; selectedTeamIds: string[]; onChange: (teamIds: string[]) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const { teams, selectedTeamIds, onChange } = props;

  function toggle(teamId: string) {
    onChange(selectedTeamIds.includes(teamId) ? selectedTeamIds.filter((id) => id !== teamId) : [...selectedTeamIds, teamId]);
  }

  return (
    <label className={styles.field}>
      <span>Equipe</span>
      <div className={styles.multiSelect}>
        <button type="button" className={styles.multiSelectTrigger} onClick={() => setIsOpen((current) => !current)}>
          {selectedTeamIds.length ? `${selectedTeamIds.length} selecionada(s)` : "Todas"}
        </button>
        {isOpen ? (
          <div className={styles.multiSelectPanel}>
            {teams.map((team) => (
              <label key={team.id} className={styles.multiSelectOption}>
                <input type="checkbox" checked={selectedTeamIds.includes(team.id)} onChange={() => toggle(team.id)} />
                <span className={styles.multiSelectOptionText}>
                  <span className={styles.multiSelectOptionTeam}>{team.name}</span>
                  {team.foremanName ? <span className={styles.multiSelectOptionForeman}>{team.foremanName}</span> : null}
                </span>
              </label>
            ))}
            {!teams.length ? <span className={styles.emptyHint}>Nenhuma equipe ativa.</span> : null}
          </div>
        ) : null}
      </div>
    </label>
  );
}

export function ListFiltersBar(props: {
  filters: StageListFilters;
  setFilters: Dispatch<SetStateAction<StageListFilters>>;
  todayIso: string;
  teams: TeamItem[];
  total: number;
  onClear: () => void;
}) {
  const { filters, setFilters, todayIso, teams, total, onClear } = props;
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const searchDebounceRef = useRef<number | undefined>(undefined);

  function handleSearchChange(value: string) {
    setSearchDraft(value);
    window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      setFilters((current) => ({ ...current, search: value }));
    }, LIST_SEARCH_DEBOUNCE_MS);
  }

  return (
    <article className={styles.card}>
      <h3 className={styles.cardTitle}>Filtros</h3>

      <StatusChips value={filters.statusChip} onChange={(statusChip) => setFilters((current) => ({ ...current, statusChip }))} />

      <DateRangeFilter
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        todayIso={todayIso}
        onChange={(range) => setFilters((current) => ({ ...current, ...range }))}
      />

      <div className={styles.filterGrid}>
        <TeamMultiSelectFilter teams={teams} selectedTeamIds={filters.teamIds} onChange={(teamIds) => setFilters((current) => ({ ...current, teamIds }))} />
        <label className={styles.field}>
          <span>Municipio</span>
          <input
            value={filters.municipality}
            onChange={(event) => setFilters((current) => ({ ...current, municipality: event.target.value }))}
            placeholder="Todos"
          />
        </label>
        <label className={styles.field}>
          <span>Buscar (SOB)</span>
          <input value={searchDraft} onChange={(event) => handleSearchChange(event.target.value)} placeholder="Filtrar na lista..." />
        </label>
      </div>

      <div className={styles.filtersSummary}>
        <span className={styles.emptyHint}>
          {total} etapa{total === 1 ? "" : "s"} - {formatDate(filters.dateFrom)} a {formatDate(filters.dateTo)}
        </span>
        <div className={styles.actions}>
          <button type="button" className={styles.buttonSecondary} onClick={onClear}>
            Limpar filtros
          </button>
        </div>
      </div>
    </article>
  );
}

export function SobEntryBar(props: {
  sob: string;
  setSob: Dispatch<SetStateAction<string>>;
  onSubmit: () => void;
  isSubmitting: boolean;
  projects: Array<{ id: string; code: string; city: string }>;
}) {
  const { sob, setSob, onSubmit, isSubmitting, projects } = props;

  return (
    <article className={styles.card}>
      <label className={styles.field}>
        <span>SOB</span>
        <div className={styles.entryInputRow}>
          <span className={styles.entryInputIcon} aria-hidden="true">
            <SearchIcon className={styles.iconSmall} />
          </span>
          <input
            list="programacao-normalizada-sob-list"
            value={sob}
            onChange={(event) => setSob(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit();
            }}
            placeholder="Ex.: A044811036"
          />
          <datalist id="programacao-normalizada-sob-list">
            {projects.map((project) => (
              <option key={project.id} value={project.code}>
                {project.city}
              </option>
            ))}
          </datalist>
          <button type="button" className={styles.buttonPrimary} onClick={onSubmit} disabled={isSubmitting || !sob.trim()}>
            Abrir ou criar programacao
          </button>
        </div>
      </label>
      <p className={styles.emptyHint}>Se o SOB ja tiver programacao, abre o plano com as etapas. Se nao, comeca um novo.</p>
    </article>
  );
}

function buildProjectGroups(items: StageListItem[]) {
  const groupMap = new Map<string, ProjectListGroup>();

  for (const stage of items) {
    const current = groupMap.get(stage.projectId);
    if (current) {
      current.stages.push(stage);
      continue;
    }

    groupMap.set(stage.projectId, {
      projectId: stage.projectId,
      projectCode: stage.projectCode,
      stages: [stage],
      activeTeamCount: 0,
    });
  }

  const groups = Array.from(groupMap.values());
  for (const group of groups) {
    group.stages.sort((first, second) => first.executionDate.localeCompare(second.executionDate));
    const activeTeamIds = new Set<string>();

    for (const stage of group.stages) {
      if (!isActiveStageStatus(stage.status)) continue;
      for (const team of stage.teams) {
        if (team.status === "ATIVA") activeTeamIds.add(team.teamId);
      }
    }

    group.activeTeamCount = activeTeamIds.size;
  }

  return groups;
}

export function StageListTable(props: {
  items: StageListItem[];
  isLoading: boolean;
  isSubmitting: boolean;
  onOpenProject: (projectId: string) => void;
  fetchProjectStages: (projectId: string) => Promise<StageListItem[]>;
  onAddTeam: (stage: StageListItem) => void;
  onPostpone: (stage: StageListItem) => void;
  onCancel: (stage: StageListItem) => void;
  onHistory: (stage: StageListItem) => void;
  onDetails: (stage: StageListItem) => void;
  onReopen: (stage: StageListItem) => void;
  onRemoveTeam: (programmingTeamId: string) => void;
  onChangeWorkCompletionStatus: (stage: StageListItem, value: string | null) => void;
  isExportingCsv: boolean;
  isExportingEnel: boolean;
  isExportingEnelNovo: boolean;
  isExportCoolingDown: boolean;
  isEnelExportCoolingDown: boolean;
  onExportCsv: () => void;
  onExportEnel: () => void;
  onExportEnelNovo: () => void;
}) {
  const {
    items,
    isLoading,
    isSubmitting,
    onOpenProject,
    fetchProjectStages,
    onAddTeam,
    onPostpone,
    onCancel,
    onHistory,
    onDetails,
    onReopen,
    onRemoveTeam,
    onChangeWorkCompletionStatus,
    isExportingCsv,
    isExportingEnel,
    isExportingEnelNovo,
    isExportCoolingDown,
    isEnelExportCoolingDown,
    onExportCsv,
    onExportEnel,
    onExportEnelNovo,
  } = props;
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [expandedStages, setExpandedStages] = useState<StageListItem[] | null>(null);
  const [isLoadingExpanded, setIsLoadingExpanded] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const projectGroups = useMemo(() => buildProjectGroups(items), [items]);

  function toggleProjectExpanded(projectId: string) {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
      setExpandedStages(null);
      setExpandError(null);
      return;
    }
    setExpandedProjectId(projectId);
  }

  const loadExpandedStages = useCallback(
    async (projectId: string, isStillCurrent: () => boolean) => {
      setIsLoadingExpanded(true);
      setExpandError(null);
      try {
        const stages = await fetchProjectStages(projectId);
        if (!isStillCurrent()) return;
        setExpandedStages([...stages].sort((first, second) => first.executionDate.localeCompare(second.executionDate)));
      } catch {
        if (!isStillCurrent()) return;
        setExpandError("Falha ao carregar o plano completo do projeto. Mostrando so as etapas do filtro atual.");
      } finally {
        if (isStillCurrent()) setIsLoadingExpanded(false);
      }
    },
    [fetchProjectStages]
  );

  useEffect(() => {
    if (!expandedProjectId) return;

    let cancelled = false;
    void loadExpandedStages(expandedProjectId, () => !cancelled);

    return () => {
      cancelled = true;
    };
  }, [expandedProjectId, loadExpandedStages]);

  const isAnyExporting = isExportingCsv || isExportingEnel || isExportingEnelNovo;
  const exportButtons = (
    <div className={styles.tableActions}>
      <CsvExportButton
        onClick={onExportCsv}
        disabled={isAnyExporting || isLoading || !items.length || isExportCoolingDown}
        isLoading={isExportingCsv}
        className={styles.buttonSecondary}
      />
      <CsvExportButton
        onClick={onExportEnel}
        disabled={isAnyExporting || isLoading || !items.length || isEnelExportCoolingDown}
        isLoading={isExportingEnel}
        className={styles.buttonSecondary}
        idleLabel="Extracao ENEL"
        loadingLabel="Gerando..."
      />
      <CsvExportButton
        onClick={onExportEnelNovo}
        disabled={isAnyExporting || isLoading || !items.length || isEnelExportCoolingDown}
        isLoading={isExportingEnelNovo}
        className={styles.buttonSecondary}
        idleLabel="Extracao ENEL NOVO"
        loadingLabel="Gerando..."
      />
    </div>
  );

  if (isLoading) {
    return (
      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Programacoes</h3>
          {exportButtons}
        </div>
        <p className={styles.emptyHint}>Carregando lista...</p>
      </article>
    );
  }

  if (!items.length) {
    return (
      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Programacoes</h3>
          {exportButtons}
        </div>
        <p className={styles.emptyHint}>Nenhuma etapa encontrada para os filtros atuais.</p>
      </article>
    );
  }

  return (
    <article className={styles.card}>
      <div className={styles.tableHeader}>
        <h3 className={styles.cardTitle}>Programacoes</h3>
        {exportButtons}
      </div>
      <div className={styles.listTable} role="table">
      <div className={`${styles.projectRow} ${styles.listHeaderRow}`} role="row">
        <span />
        <span>Id</span>
        <span>Projeto</span>
        <span>Etapas</span>
        <span>Equipes</span>
        <span className={styles.listActionsHeader}>Acoes</span>
      </div>

      {projectGroups.map((group) => {
        const isProjectExpanded = expandedProjectId === group.projectId;

        return (
          <div key={group.projectId} className={styles.listGroup}>
            <div className={styles.projectRow} role="row">
              <button
                type="button"
                className={styles.expandButton}
                onClick={() => toggleProjectExpanded(group.projectId)}
                aria-label={isProjectExpanded ? `Recolher etapas do projeto ${group.projectCode}` : `Expandir etapas do projeto ${group.projectCode}`}
              >
                {isProjectExpanded ? "v" : ">"}
              </button>
              <span className={styles.projectIdText} title={group.projectId}>{group.projectId}</span>
              <span className={styles.projectCodeText}>{group.projectCode}</span>
              <span className={styles.emptyHint}>{group.stages.length} etapa{group.stages.length === 1 ? "" : "s"}</span>
              <span className={styles.emptyHint}>{group.activeTeamCount} equipe{group.activeTeamCount === 1 ? "" : "s"}</span>
              <span className={styles.rowActions}>
                <button type="button" className={styles.openPlanButton} onClick={() => onOpenProject(group.projectId)}>
                  Abrir plano
                </button>
              </span>
            </div>

            {isProjectExpanded ? (
              <div className={styles.stageRows}>
                <div className={`${styles.stageRow} ${styles.stageHeaderRow}`} role="row">
                  <span>Data</span>
                  <span>Etapa</span>
                  <span>Equipes</span>
                  <span>Status</span>
                  <span>Estado do trabalho</span>
                  <span className={styles.listActionsHeader}>Acoes</span>
                </div>

                {isLoadingExpanded ? <p className={styles.emptyHint}>Carregando plano completo do projeto...</p> : null}
                {expandError ? <p className={styles.emptyHint}>{expandError}</p> : null}

                {(expandedStages ?? group.stages).map((stage) => {
                  const isActive = isActiveStageStatus(stage.status);
                  const isCompleted = stage.workCompletionStatus === "CONCLUIDO";
                  const activeTeams = stage.teams.filter((team) => team.status === "ATIVA");

                  return (
                    <div key={stage.id} className={styles.stageRow} role="row">
                      <span>{formatDate(stage.executionDate)}</span>
                      <span>
                        <ClassificationBadge stage={stage} />
                      </span>
                      <span className={styles.stageTeamsCell}>
                        {activeTeams.length ? (
                          activeTeams.map((team) => (
                            <span key={team.id} className={styles.teamChip}>
                              {team.teamName}
                              {stage.startTime || stage.endTime ? (
                                <small>{stage.startTime?.slice(0, 5) ?? "--:--"}-{stage.endTime?.slice(0, 5) ?? "--:--"}</small>
                              ) : null}
                              {isActive && !isCompleted ? (
                                <button type="button" aria-label={`Remover ${team.teamName}`} onClick={() => onRemoveTeam(team.id)}>
                                  &times;
                                </button>
                              ) : null}
                            </span>
                          ))
                        ) : (
                          <span className={styles.emptyHint}>Sem equipe ativa</span>
                        )}
                      </span>
                      <span>
                        <StatusBadge status={stage.status} />
                      </span>
                      <span>
                        <WorkCompletionCell stage={stage} isSubmitting={isSubmitting} onChange={onChangeWorkCompletionStatus} />
                      </span>
                      <span className={styles.rowActions}>
                        {isActive && !isCompleted ? (
                          <>
                            <button
                              type="button"
                              className={`${styles.actionButton} ${styles.actionCopy}`}
                              title="Adicionar equipe"
                              onClick={() => onAddTeam(stage)}
                            >
                              <ActionIcon name="addTeam" />
                            </button>
                            <button
                              type="button"
                              className={`${styles.actionButton} ${styles.actionPostpone}`}
                              title="Adiar"
                              onClick={() => onPostpone(stage)}
                            >
                              <ActionIcon name="postpone" />
                            </button>
                            <button
                              type="button"
                              className={`${styles.actionButton} ${styles.actionCancel}`}
                              title="Cancelar"
                              onClick={() => onCancel(stage)}
                            >
                              <ActionIcon name="cancel" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`${styles.actionButton} ${styles.actionHistory}`}
                              title="Historico"
                              onClick={() => onHistory(stage)}
                            >
                              <ActionIcon name="history" />
                            </button>
                            <button
                              type="button"
                              className={`${styles.actionButton} ${styles.actionView}`}
                              title="Detalhes"
                              onClick={() => onDetails(stage)}
                            >
                              <ActionIcon name="details" />
                            </button>
                            {isCompleted ? (
                              <button
                                type="button"
                                className={`${styles.actionButton} ${styles.actionComplete}`}
                                title="Reabrir"
                                onClick={() => onReopen(stage)}
                              >
                                <ActionIcon name="activate" />
                              </button>
                            ) : null}
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      </div>
    </article>
  );
}
