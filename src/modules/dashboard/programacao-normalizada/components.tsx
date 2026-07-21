import type { Dispatch, SetStateAction } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";

import { DOCUMENT_KEYS } from "./constants";
import styles from "./ProgrammingNormalizedPageView.module.css";
import { isReasonSelectionValid } from "./validators";
import {
  formatDate,
  formatDateTime,
  formatHistoryChangeValue,
  getHistoryActionLabel,
  getHistoryFieldLabel,
  getStageClassificationLabel,
  getStageStatusDisplayLabel,
  getStageStatusLabel,
  getWorkCompletionLabel,
  isActiveStageStatus,
  isPendenciaPrimary,
} from "./utils";
import type {
  ActivityCatalogItem,
  DocumentFormEntry,
  DocumentFormKey,
  ElectricalEqCatalogItem,
  FormState,
  HistoryItem,
  HistoryModalTarget,
  ProgrammingStage,
  ReasonOptionItem,
  SgdTypeItem,
  SupportOptionItem,
  TeamItem,
} from "./types";

export function StageBadge(props: { stage: ProgrammingStage }) {
  const { stage } = props;
  // Badge de classificacao (coluna Etapa, spec 3.2): segue a posicao, nunca a
  // pendencia. Uma etapa em pendencia continua Etapa N/Final aqui.
  const classification = getStageClassificationLabel(stage);
  const variant = !isActiveStageStatus(stage.status)
    ? styles.badgeCancelada
    : stage.workCompletionStatus === "CONCLUIDO"
      ? styles.badgeConcluido
      : stage.etapaFinal
        ? styles.badgeFinal
        : stage.etapaUnica
          ? styles.badgeUnica
          : "";

  return <span className={`${styles.badge} ${variant}`}>{classification}</span>;
}

export function StageCard(props: {
  stage: ProgrammingStage;
  teamOptions: TeamItem[];
  onEdit: () => void;
  onDuplicate: () => void;
  onAddTeam: (teamId: string) => void;
  onRemoveTeam: (programmingTeamId: string, expectedUpdatedAt: string) => void;
  onPostpone: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onTogglePendencia: (next: boolean) => void;
  onDetails: () => void;
  onHistory: () => void;
  isSubmitting: boolean;
}) {
  const {
    stage,
    teamOptions,
    onEdit,
    onDuplicate,
    onAddTeam,
    onRemoveTeam,
    onPostpone,
    onCancel,
    onComplete,
    onReopen,
    onTogglePendencia,
    onDetails,
    onHistory,
    isSubmitting,
  } = props;
  const isActive = isActiveStageStatus(stage.status);
  const isCompleted = stage.workCompletionStatus === "CONCLUIDO";
  const activeTeamIds = new Set(stage.teams.filter((team) => team.status === "ATIVA").map((team) => team.teamId));
  const availableTeams = teamOptions.filter((team) => !activeTeamIds.has(team.id));

  return (
    <article className={styles.stageCard}>
      <div className={styles.stageHeader}>
        <div>
          <strong>{stage.executionDate ? formatDate(stage.executionDate) : "Em espera"}</strong> — <StageBadge stage={stage} />{" "}
          <span className={`${styles.badge} ${isPendenciaPrimary(stage) ? styles.badgeDanger : ""}`}>{getStageStatusDisplayLabel(stage)}</span>{" "}
          {stage.isPendencia && !isPendenciaPrimary(stage) ? <span className={styles.badge} title="Etapa marcada como pendencia">Pend.</span> : null}{" "}
          <span className={styles.badge}>{getWorkCompletionLabel(stage.workCompletionStatus)}</span>
        </div>
        <div className={styles.rowActions}>
          <button type="button" className={`${styles.actionButton} ${styles.actionView}`} title="Detalhes" onClick={onDetails}>
            <ActionIcon name="details" />
          </button>
          <button type="button" className={`${styles.actionButton} ${styles.actionHistory}`} title="Historico" onClick={onHistory}>
            <ActionIcon name="history" />
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionCopy}`}
            title="Nova etapa a partir desta"
            onClick={onDuplicate}
            disabled={isSubmitting}
          >
            <ActionIcon name="duplicate" />
          </button>
          {isActive && !isCompleted ? (
            <>
              <button type="button" className={`${styles.actionButton} ${styles.actionEdit}`} title="Editar" onClick={onEdit} disabled={isSubmitting}>
                <ActionIcon name="edit" />
              </button>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionPostpone}`}
                title="Adiar"
                onClick={onPostpone}
                disabled={isSubmitting}
              >
                <ActionIcon name="postpone" />
              </button>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionCancel}`}
                title="Cancelar"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                <ActionIcon name="cancel" />
              </button>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionComplete}`}
                title={activeTeamIds.size === 0 ? "Aloque ao menos uma equipe antes de concluir" : "Concluir"}
                onClick={onComplete}
                disabled={isSubmitting || activeTeamIds.size === 0}
              >
                <ActionIcon name="activate" />
              </button>
            </>
          ) : null}
          {isActive && isCompleted ? (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionComplete}`}
              title="Reabrir"
              onClick={onReopen}
              disabled={isSubmitting}
            >
              <ActionIcon name="activate" />
            </button>
          ) : null}
        </div>
      </div>

      <p className={styles.emptyHint}>{stage.serviceDescription || "Sem descricao do servico."}</p>

      <div className={styles.teamChips}>
        {stage.teams.filter((team) => team.status === "ATIVA").map((team) => (
          <span key={team.id} className={styles.teamChip}>
            {team.teamName}
            {isActive && !isCompleted ? (
              <button
                type="button"
                aria-label={`Remover ${team.teamName}`}
                onClick={() => onRemoveTeam(team.id, team.updatedAt)}
                disabled={isSubmitting}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        {!stage.teams.some((team) => team.status === "ATIVA") ? <span className={styles.emptyHint}>Sem equipe alocada.</span> : null}
      </div>

      {isActive ? (
        <label className={styles.pendenciaToggle}>
          <input
            type="checkbox"
            checked={stage.isPendencia}
            onChange={(event) => onTogglePendencia(event.target.checked)}
            disabled={isSubmitting}
          />
          <span>Pendencia</span>
        </label>
      ) : null}

      {isActive && !isCompleted && availableTeams.length ? (
        <div className={styles.field}>
          <label htmlFor={`add-team-${stage.id}`}><span>Adicionar equipe</span></label>
          <select
            id={`add-team-${stage.id}`}
            value=""
            disabled={isSubmitting}
            onChange={(event) => {
              if (event.target.value) onAddTeam(event.target.value);
            }}
          >
            <option value="">Selecionar equipe...</option>
            {availableTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} — {team.foremanName || "Sem encarregado"}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </article>
  );
}

// Adiar tem duas rotas (spec 3.1/10): "Nova data" remarca a etapa (REPROGRAMADA)
// e "Deixar em espera" tira a data (ADIADA). O motivo e obrigatorio nas duas; a
// data so na rota de remarcar.
export function PostponeModal(props: {
  isOpen: boolean;
  mode: "DATE" | "HOLD";
  newDate: string;
  reasonCode: string;
  reasonNotes: string;
  reasonOptions: ReasonOptionItem[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onModeChange: (value: "DATE" | "HOLD") => void;
  onNewDateChange: (value: string) => void;
  onReasonCodeChange: (value: string) => void;
  onReasonNotesChange: (value: string) => void;
}) {
  const { isOpen, mode, newDate, reasonCode, reasonNotes, reasonOptions, isSubmitting, onClose, onConfirm, onModeChange, onNewDateChange, onReasonCodeChange, onReasonNotesChange } = props;
  if (!isOpen) return null;

  const selectedReason = reasonOptions.find((item) => item.code === reasonCode);
  const reasonValid = isReasonSelectionValid(reasonOptions, reasonCode, reasonNotes);
  const canConfirm = mode === "HOLD" ? reasonValid : Boolean(newDate) && reasonValid;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Adiar etapa</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.field}>
            <span>Como adiar</span>
            <div className={styles.radioRow}>
              <label>
                <input type="radio" name="postpone-mode" checked={mode === "DATE"} onChange={() => onModeChange("DATE")} disabled={isSubmitting} />
                <span>Nova data (remarcar)</span>
              </label>
              <label>
                <input type="radio" name="postpone-mode" checked={mode === "HOLD"} onChange={() => onModeChange("HOLD")} disabled={isSubmitting} />
                <span>Deixar em espera (sem data)</span>
              </label>
            </div>
          </div>
          {mode === "DATE" ? (
            <label className={styles.field}>
              <span>Nova data</span>
              <input type="date" value={newDate} onChange={(event) => onNewDateChange(event.target.value)} disabled={isSubmitting} />
            </label>
          ) : null}
          <label className={styles.field}>
            <span>Motivo</span>
            <select value={reasonCode} onChange={(event) => onReasonCodeChange(event.target.value)} disabled={isSubmitting}>
              <option value="">Selecionar motivo...</option>
              {reasonOptions.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>
          {selectedReason?.requiresNotes ? (
            <label className={styles.field}>
              <span>Observacao</span>
              <textarea value={reasonNotes} onChange={(event) => onReasonNotesChange(event.target.value)} disabled={isSubmitting} />
            </label>
          ) : null}
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={onConfirm}
            disabled={isSubmitting || !canConfirm}
          >
            {mode === "HOLD" ? "Deixar em espera" : "Confirmar remarcacao"}
          </button>
        </div>
      </article>
    </div>
  );
}

export function CancelModal(props: {
  isOpen: boolean;
  reasonCode: string;
  reasonNotes: string;
  reasonOptions: ReasonOptionItem[];
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onReasonCodeChange: (value: string) => void;
  onReasonNotesChange: (value: string) => void;
}) {
  const { isOpen, reasonCode, reasonNotes, reasonOptions, isSubmitting, onClose, onConfirm, onReasonCodeChange, onReasonNotesChange } = props;
  if (!isOpen) return null;

  const selectedReason = reasonOptions.find((item) => item.code === reasonCode);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Cancelar etapa</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span>Motivo</span>
            <select value={reasonCode} onChange={(event) => onReasonCodeChange(event.target.value)} disabled={isSubmitting}>
              <option value="">Selecionar motivo...</option>
              {reasonOptions.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>
          {selectedReason?.requiresNotes ? (
            <label className={styles.field}>
              <span>Observacao</span>
              <textarea value={reasonNotes} onChange={(event) => onReasonNotesChange(event.target.value)} disabled={isSubmitting} />
            </label>
          ) : null}
          <button
            type="button"
            className={styles.buttonDanger}
            onClick={onConfirm}
            disabled={isSubmitting || !isReasonSelectionValid(reasonOptions, reasonCode, reasonNotes)}
          >
            Confirmar cancelamento
          </button>
        </div>
      </article>
    </div>
  );
}

export function HistoryModal(props: {
  target: HistoryModalTarget | null;
  items: HistoryItem[];
  pagedItems: HistoryItem[];
  isLoading: boolean;
  page: number;
  totalPages: number;
  onClose: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const { target, items, pagedItems, isLoading, page, totalPages, onClose, onPreviousPage, onNextPage } = props;
  if (!target) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Historico da etapa</h4>
            <p className={styles.modalSubtitle}>Etapa de {target.executionDate ? formatDate(target.executionDate) : "Em espera"} | ID: {target.id}</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          {isLoading ? <p className={styles.emptyHint}>Carregando historico...</p> : null}
          {!isLoading && !items.length ? <p className={styles.emptyHint}>Nenhum evento registrado.</p> : null}
          {!isLoading && items.length ? (
            <div className={styles.historyList}>
              {pagedItems.map((item) => {
                const changedFields = Object.entries(item.changes ?? {}).filter(([, change]) => {
                  if (!change || typeof change !== "object") return false;
                  const typedChange = change as { from?: unknown; to?: unknown };
                  return (typedChange.from ?? "") !== (typedChange.to ?? "");
                });

                return (
                  <article key={item.id} className={styles.historyCard}>
                    <header className={styles.historyCardHeader}>
                      <strong>{getHistoryActionLabel(item.actionType)}</strong>
                      <span>{formatDateTime(item.changedAt)} | {item.changedByName}</span>
                    </header>

                    <div className={styles.historyChanges}>
                      {changedFields.length ? (
                        changedFields.map(([field, change]) => {
                          const typedChange = change as { from?: unknown; to?: unknown };
                          return (
                            <div key={field} className={styles.historyChangeItem}>
                              <strong>{getHistoryFieldLabel(field)}</strong>
                              <span>De: {formatHistoryChangeValue(typedChange.from)}</span>
                              <span>Para: {formatHistoryChangeValue(typedChange.to)}</span>
                            </div>
                          );
                        })
                      ) : (
                        <p className={styles.emptyHint}>Nenhum campo alterado nesse evento.</p>
                      )}
                    </div>

                    <p><strong>Motivo:</strong> {item.reason || "-"}</p>
                  </article>
                );
              })}
            </div>
          ) : null}
          {!isLoading && items.length ? (
            <div className={styles.historyPagination}>
              <span>Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {items.length}</span>
              <div className={styles.actions}>
                <button type="button" className={styles.buttonSecondary} onClick={onPreviousPage} disabled={page <= 1}>
                  Anterior
                </button>
                <button type="button" className={styles.buttonSecondary} onClick={onNextPage} disabled={page >= totalPages}>
                  Proxima
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

export function DetailsModal(props: { target: ProgrammingStage | null; onClose: () => void }) {
  const { target, onClose } = props;
  if (!target) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Detalhes da etapa — {formatDate(target.executionDate)}</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>Fechar</button>
        </header>
        <div className={styles.detailGrid}>
          <span><strong>Classificacao:</strong> {getStageClassificationLabel(target)}</span>
          <span><strong>Status:</strong> {getStageStatusLabel(target.status)}</span>
          <span><strong>Estado Trabalho:</strong> {getWorkCompletionLabel(target.workCompletionStatus)}</span>
          <span><strong>Periodo:</strong> {target.period ?? "-"}</span>
          <span><strong>Horario:</strong> {target.startTime ?? "-"} - {target.endTime ?? "-"}</span>
          <span><strong>Desligamento:</strong> {target.outageStartTime ?? "-"} - {target.outageEndTime ?? "-"}</span>
          <span><strong>Alimentador:</strong> {target.feeder || "-"}</span>
          <span><strong>Ponto Eletrico:</strong> {target.campoEletrico || "-"}</span>
          <span><strong>Clientes afetados:</strong> {target.affectedCustomers ?? "-"}</span>
          <span><strong>Apoio:</strong> {target.support || "-"}</span>
          <span><strong>Poste:</strong> {target.posteQty}</span>
          <span><strong>Estrutura:</strong> {target.estruturaQty}</span>
          <span><strong>Trafo:</strong> {target.trafoQty}</span>
          <span><strong>Rede:</strong> {target.redeQty}</span>
          <span className={styles.fieldFullRow}><strong>Descricao:</strong> {target.serviceDescription || "-"}</span>
          <span className={styles.fieldFullRow}><strong>Anotacao:</strong> {target.note || "-"}</span>
          {target.cancellationReason ? (
            <span className={styles.fieldFullRow}><strong>Motivo cancelamento:</strong> {target.cancellationReason}</span>
          ) : null}
        </div>
      </article>
    </div>
  );
}

export function StageFormPanel(props: {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  isEditing: boolean;
  isSubmitting: boolean;
  canSubmit: boolean;
  teamOptions: TeamItem[];
  sgdTypes: SgdTypeItem[];
  electricalEqCatalog: ElectricalEqCatalogItem[];
  supportOptions: SupportOptionItem[];
  activityOptions: ActivityCatalogItem[];
  isLoadingActivities: boolean;
  onSubmit: () => void;
  onCancelEdit: () => void;
}) {
  const {
    form,
    setForm,
    isEditing,
    isSubmitting,
    canSubmit,
    teamOptions,
    sgdTypes,
    electricalEqCatalog,
    supportOptions,
    activityOptions,
    isLoadingActivities,
    onSubmit,
    onCancelEdit,
  } = props;

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  // Espelha a tela Programacao Simples: mudar o periodo ajusta a hora termino
  // (integral = dia todo ate 17:00; parcial = meio periodo ate 12:00). Hora
  // inicio fica livre para o usuario ajustar.
  function handlePeriodChange(nextPeriod: FormState["period"]) {
    setForm((current) => ({
      ...current,
      period: nextPeriod,
      endTime: nextPeriod === "PARCIAL" ? "12:00" : "17:00",
    }));
  }

  function toggleTeam(teamId: string) {
    setForm((current) => ({
      ...current,
      teamIds: current.teamIds.includes(teamId)
        ? current.teamIds.filter((item) => item !== teamId)
        : [...current.teamIds, teamId],
    }));
  }

  const teamSearchLower = form.teamSearch.trim().toLowerCase();
  const visibleTeamOptions = teamSearchLower
    ? teamOptions.filter((team) => team.name.toLowerCase().includes(teamSearchLower))
    : teamOptions;

  function handleAddActivity() {
    const match = activityOptions.find((item) => item.code.toLowerCase() === form.activitySearch.trim().toLowerCase());
    const quantity = form.activityQuantity.trim();
    if (!match || !quantity || Number(quantity.replace(",", ".")) <= 0) return;
    if (form.activities.some((item) => item.catalogId === match.id)) return;

    setForm((current) => ({
      ...current,
      activities: [...current.activities, { catalogId: match.id, code: match.code, description: match.description, unit: match.unit, quantity }],
      activitySearch: "",
      activityQuantity: "",
    }));
  }

  function handleRemoveActivity(index: number) {
    setForm((current) => ({ ...current, activities: current.activities.filter((_, itemIndex) => itemIndex !== index) }));
  }

  function handleUpdateActivityQuantity(index: number, value: string) {
    setForm((current) => ({
      ...current,
      activities: current.activities.map((item, itemIndex) => (itemIndex === index ? { ...item, quantity: value } : item)),
    }));
  }

  function handleDocumentChange(key: DocumentFormKey, field: keyof DocumentFormEntry, value: string) {
    setForm((current) => ({
      ...current,
      documents: { ...current.documents, [key]: { ...current.documents[key], [field]: value } },
    }));
  }

  return (
    <section className={styles.formCard}>
      <h3 className={styles.cardTitle}>{isEditing ? "Editar etapa" : "Nova etapa"}</h3>

      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.fieldFullRow}`}>
          <span>Data de execucao</span>
          <input
            type="date"
            value={form.executionDate}
            onChange={(event) => setField("executionDate", event.target.value)}
            disabled={isSubmitting}
          />
        </label>

        {!isEditing ? (
          <label className={`${styles.pendenciaToggle} ${styles.fieldFullRow}`}>
            <input
              type="checkbox"
              checked={form.isPendencia}
              onChange={(event) => setField("isPendencia", event.target.checked)}
              disabled={isSubmitting}
            />
            <span>Pendencia (permite criar mesmo com o projeto concluido, sem reabrir)</span>
          </label>
        ) : null}

        <label className={styles.field}>
          <span>Periodo <span className="requiredMark">*</span></span>
          <select value={form.period} onChange={(event) => handlePeriodChange(event.target.value as FormState["period"])} disabled={isSubmitting}>
            <option value="INTEGRAL">Integral</option>
            <option value="PARCIAL">Parcial</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Hora inicio <span className="requiredMark">*</span></span>
          <input type="time" value={form.startTime} onChange={(event) => setField("startTime", event.target.value)} disabled={isSubmitting} />
        </label>
        <label className={styles.field}>
          <span>Hora termino <span className="requiredMark">*</span></span>
          <input type="time" value={form.endTime} onChange={(event) => setField("endTime", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className={styles.field}>
          <span>Desligamento inicio</span>
          <input type="time" value={form.outageStartTime} onChange={(event) => setField("outageStartTime", event.target.value)} disabled={isSubmitting} />
        </label>
        <label className={styles.field}>
          <span>Desligamento fim</span>
          <input type="time" value={form.outageEndTime} onChange={(event) => setField("outageEndTime", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className={styles.field}>
          <span>Tipo de SGD <span className="requiredMark">*</span></span>
          <select value={form.sgdTypeId} onChange={(event) => setField("sgdTypeId", event.target.value)} disabled={isSubmitting}>
            <option value="">Selecionar...</option>
            {sgdTypes.map((item) => (
              <option key={item.id} value={item.id}>{item.description}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>No EQ <span className="requiredMark">*</span></span>
          <select value={form.electricalEqCatalogId} onChange={(event) => setField("electricalEqCatalogId", event.target.value)} disabled={isSubmitting}>
            <option value="">Selecionar...</option>
            {electricalEqCatalog.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Alimentador</span>
          <input value={form.feeder} onChange={(event) => setField("feeder", event.target.value)} disabled={isSubmitting} />
        </label>
        <label className={styles.field}>
          <span>Ponto Eletrico <span className="requiredMark">*</span></span>
          <input value={form.campoEletrico} onChange={(event) => setField("campoEletrico", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className={styles.field}>
          <span>Clientes afetados</span>
          <input
            type="number"
            min={0}
            value={form.affectedCustomers}
            onChange={(event) => setField("affectedCustomers", event.target.value)}
            disabled={isSubmitting}
          />
        </label>
        <label className={styles.field}>
          <span>Apoio</span>
          <select value={form.supportItemId} onChange={(event) => setField("supportItemId", event.target.value)} disabled={isSubmitting}>
            <option value="">Nao informado</option>
            {supportOptions.map((item) => (
              <option key={item.id} value={item.id}>{item.description}</option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Poste (qtd)</span>
          <input value={form.posteQty} onChange={(event) => setField("posteQty", event.target.value)} disabled={isSubmitting} />
        </label>
        <label className={styles.field}>
          <span>Estrutura (qtd)</span>
          <input value={form.estruturaQty} onChange={(event) => setField("estruturaQty", event.target.value)} disabled={isSubmitting} />
        </label>
        <label className={styles.field}>
          <span>Trafo (qtd)</span>
          <input value={form.trafoQty} onChange={(event) => setField("trafoQty", event.target.value)} disabled={isSubmitting} />
        </label>
        <label className={styles.field}>
          <span>Rede (km/m)</span>
          <input value={form.redeQty} onChange={(event) => setField("redeQty", event.target.value)} disabled={isSubmitting} />
        </label>

        <label className={`${styles.field} ${styles.fieldFullRow}`}>
          <span>Descricao do servico <span className="requiredMark">*</span></span>
          <textarea value={form.serviceDescription} onChange={(event) => setField("serviceDescription", event.target.value)} disabled={isSubmitting} />
        </label>
        <label className={`${styles.field} ${styles.fieldFullRow}`}>
          <span>Anotacao</span>
          <textarea value={form.note} onChange={(event) => setField("note", event.target.value)} disabled={isSubmitting} />
        </label>

      </div>

      <section className={styles.formSection}>
        <div className={styles.sectionHeader}>
          <h4>Equipes</h4>
          <p>Selecione uma ou mais equipes para receber a etapa (opcional).</p>
        </div>
        <div className={styles.teamSelectionCard}>
          <div className={styles.teamSelectionHeader}>
            <input
              type="text"
              value={form.teamSearch}
              onChange={(event) => setField("teamSearch", event.target.value)}
              placeholder="Buscar equipe..."
              disabled={isSubmitting}
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() => setField("teamIds", Array.from(new Set([...form.teamIds, ...visibleTeamOptions.map((team) => team.id)])))}
                disabled={isSubmitting}
              >
                Marcar visiveis
              </button>
              <button type="button" className={styles.buttonSecondary} onClick={() => setField("teamIds", [])} disabled={isSubmitting}>
                Limpar
              </button>
            </div>
          </div>

          <div className={styles.teamList}>
            {visibleTeamOptions.length ? (
              visibleTeamOptions.map((team) => (
                <label key={team.id} className={styles.teamOption}>
                  <input
                    type="checkbox"
                    checked={form.teamIds.includes(team.id)}
                    onChange={() => toggleTeam(team.id)}
                    disabled={isSubmitting}
                  />
                  <div className={styles.teamOptionMeta}>
                    <strong>{team.name}</strong>
                    <small>{team.serviceCenterName}</small>
                    <small>Encarregado: {team.foremanName || "Sem encarregado"}</small>
                  </div>
                </label>
              ))
            ) : (
              <p className={styles.emptyHint}>Nenhuma equipe encontrada para o filtro atual.</p>
            )}
          </div>
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.sectionHeader}>
          <h4>Atividades</h4>
          <p>Inclua o codigo e a quantidade das atividades previstas para a etapa.</p>
        </div>
        <div className={styles.activityComposer}>
          <label className={styles.field}>
            <span>Codigo da atividade</span>
            <input
              list="programacao-normalizada-activity-list"
              value={form.activitySearch}
              onChange={(event) => setField("activitySearch", event.target.value)}
              placeholder={isLoadingActivities ? "Buscando atividades..." : "Digite codigo e selecione"}
              disabled={isSubmitting}
            />
            <datalist id="programacao-normalizada-activity-list">
              {activityOptions.map((item) => (
                <option key={item.id} value={item.code}>{item.description}</option>
              ))}
            </datalist>
          </label>
          <label className={styles.field}>
            <span>Quantidade</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.activityQuantity}
              onChange={(event) => setField("activityQuantity", event.target.value)}
              disabled={isSubmitting}
            />
          </label>
          <button type="button" className={styles.buttonSecondary} onClick={handleAddActivity} disabled={isSubmitting}>
            Incluir atividade
          </button>
        </div>

        <div className={styles.activitiesList}>
          {form.activities.length ? (
            form.activities.map((item, index) => (
              <div key={item.catalogId} className={styles.activityRow}>
                <div>
                  <strong>{item.code}</strong>
                  <small>{item.description}</small>
                </div>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={item.quantity}
                  onChange={(event) => handleUpdateActivityQuantity(index, event.target.value)}
                  disabled={isSubmitting}
                />
                <span>{item.unit}</span>
                <button type="button" className={styles.buttonSecondary} onClick={() => handleRemoveActivity(index)} disabled={isSubmitting}>
                  Remover
                </button>
              </div>
            ))
          ) : (
            <p className={styles.emptyHint}>Nenhuma atividade incluida.</p>
          )}
        </div>
      </section>

      <section className={styles.formSection}>
        <div className={styles.sectionHeader}>
          <h4>Documentos</h4>
          <p>Preencha os dados dos documentos quando existirem para a etapa.</p>
        </div>
        <div className={styles.documentsGrid}>
          {DOCUMENT_KEYS.map((item) => (
            <div key={item.key} className={styles.documentCard}>
              <label className={styles.field}>
                <span>{item.label}</span>
                <input
                  value={form.documents[item.key].number}
                  onChange={(event) => handleDocumentChange(item.key, "number", event.target.value)}
                  placeholder={`Numero ${item.label}`}
                  disabled={isSubmitting}
                />
              </label>
              <label className={styles.field}>
                <span>Data inclusao</span>
                <input
                  type="date"
                  value={form.documents[item.key].includedAt}
                  onChange={(event) => handleDocumentChange(item.key, "includedAt", event.target.value)}
                  disabled={isSubmitting}
                />
              </label>
              <label className={styles.field}>
                <span>Data entrega</span>
                <input
                  type="date"
                  value={form.documents[item.key].deliveredAt}
                  onChange={(event) => handleDocumentChange(item.key, "deliveredAt", event.target.value)}
                  disabled={isSubmitting}
                />
              </label>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.stageActions}>
        <button type="button" className={styles.buttonPrimary} onClick={onSubmit} disabled={isSubmitting || !canSubmit}>
          {isEditing ? "Salvar edicao" : "Criar etapa"}
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={onCancelEdit} disabled={isSubmitting}>
          {isEditing ? "Cancelar edicao" : "Cancelar"}
        </button>
      </div>
    </section>
  );
}

export function AddTeamModal(props: {
  isOpen: boolean;
  availableTeams: TeamItem[];
  selectedTeamId: string;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSelectedTeamIdChange: (value: string) => void;
}) {
  const { isOpen, availableTeams, selectedTeamId, isSubmitting, onClose, onConfirm, onSelectedTeamIdChange } = props;
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h4>Adicionar equipe</h4>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isSubmitting}>Fechar</button>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={selectedTeamId} onChange={(event) => onSelectedTeamIdChange(event.target.value)} disabled={isSubmitting}>
              <option value="">Selecionar equipe...</option>
              {availableTeams.map((team) => (
                <option key={team.id} value={team.id}>{team.name} — {team.foremanName || "Sem encarregado"}</option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.buttonPrimary} onClick={onConfirm} disabled={isSubmitting || !selectedTeamId}>
            Adicionar
          </button>
        </div>
      </article>
    </div>
  );
}
