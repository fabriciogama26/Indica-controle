import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";

import { ActionIcon } from "@/components/ui/ActionIcon";

import { DOCUMENT_KEYS } from "./constants";
import styles from "./ProgrammingNormalizedPageView.module.css";
import {
  formatDate,
  getStageDisplayClassification,
  getStageStatusDisplayLabel,
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
  ProgrammingStage,
  SgdTypeItem,
  SupportOptionItem,
  TeamItem,
} from "./types";

export function StageBadge(props: { stage: ProgrammingStage }) {
  const { stage } = props;
  // Badge de classificacao (coluna Etapa, spec 3.2): segue a posicao, nunca a
  // pendencia. Uma etapa em pendencia continua Etapa N/Final aqui.
  //
  // Etapa encerrada exibe a classificacao HISTORICA ("Era Etapa 2", migration
  // 337): ela some da numeracao ativa, mas continua no plano do projeto e nao
  // pode perder o registro de qual etapa era.
  const display = getStageDisplayClassification(stage);
  const variant = !isActiveStageStatus(stage.status)
    ? styles.badgeCancelada
    : stage.workCompletionStatus === "CONCLUIDO"
      ? styles.badgeConcluido
      : stage.etapaFinal
        ? styles.badgeFinal
        : stage.etapaUnica
          ? styles.badgeUnica
          : "";

  const title = display.isHistorical && display.originalExecutionDate
    ? `Classificacao ao sair do plano: ${display.label.replace("Era ", "")} em ${formatDate(display.originalExecutionDate)}`
    : undefined;

  return (
    <span className={`${styles.badge} ${variant}`} title={title}>
      {display.label}
    </span>
  );
}

export function StageCard(props: {
  stage: ProgrammingStage;
  teamOptions: TeamItem[];
  onEdit: () => void;
  onDuplicate: () => void;
  // Abre o modal de adicionar equipe (com pre-checagem de agenda). O card nao
  // adiciona mais direto pelo select: era o unico caminho que gravava sem aviso
  // previo, divergindo da listagem.
  onAddTeam: () => void;
  onRemoveTeam: (programmingTeamId: string, expectedUpdatedAt: string) => void;
  onPostpone: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onTogglePendencia: (next: boolean) => void;
  onCorrectDate: () => void;
  onDetails: () => void;
  onHistory: () => void;
  isSubmitting: boolean;
  // Permissoes granulares da migration 328 (uso visual; o backend revalida).
  canComplete: boolean;
  canPendencia: boolean;
  canCorrectDate: boolean;
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
    onCorrectDate,
    onDetails,
    onHistory,
    isSubmitting,
    canComplete,
    canPendencia,
    canCorrectDate,
  } = props;
  const isActive = isActiveStageStatus(stage.status);
  const isCompleted = stage.workCompletionStatus === "CONCLUIDO";
  const activeTeams = stage.teams.filter((team) => team.status === "ATIVA");
  const activeTeamIds = new Set(activeTeams.map((team) => team.teamId));
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
              {availableTeams.length ? (
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.actionCopy}`}
                  title="Adicionar equipe"
                  onClick={onAddTeam}
                  disabled={isSubmitting}
                >
                  <ActionIcon name="addTeam" />
                </button>
              ) : null}
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
              {canCorrectDate ? (
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.actionEdit}`}
                  title="Corrigir data (mantem a etapa; para remarcar use Adiar)"
                  onClick={onCorrectDate}
                  disabled={isSubmitting}
                >
                  <ActionIcon name="transfer" />
                </button>
              ) : null}
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionCancel}`}
                title="Cancelar"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                <ActionIcon name="cancel" />
              </button>
              {canComplete ? (
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.actionComplete}`}
                  title={activeTeamIds.size === 0 ? "Aloque ao menos uma equipe antes de concluir" : "Concluir"}
                  onClick={onComplete}
                  disabled={isSubmitting || activeTeamIds.size === 0}
                >
                  <ActionIcon name="activate" />
                </button>
              ) : null}
            </>
          ) : null}
          {isActive && isCompleted && canComplete ? (
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

      <div className={styles.stageTeamsBlock}>
        <div className={styles.stageTeamsTitle}>
          <span>Equipes alocadas</span>
          <span className={`${styles.badge} ${activeTeams.length ? styles.badgeAccent : styles.badgeMuted}`}>
            {activeTeams.length || "0"} equipe{activeTeams.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className={styles.teamChips}>
          {activeTeams.map((team) => (
            <span key={team.id} className={`${styles.teamChip} ${styles.teamChipLarge} ${isActive && !isCompleted ? styles.teamChipRemovable : ""}`}>
              <span className={styles.teamChipMain}>{team.teamName}</span>
              {stage.startTime || stage.endTime ? (
                <small className={styles.teamChipTime}>{stage.startTime?.slice(0, 5) ?? "--:--"}-{stage.endTime?.slice(0, 5) ?? "--:--"}</small>
              ) : null}
              {isActive && !isCompleted ? (
                <button
                  type="button"
                  title="Remover equipe"
                  aria-label={`Remover ${team.teamName}`}
                  onClick={() => onRemoveTeam(team.id, team.updatedAt)}
                  disabled={isSubmitting}
                >
                ×
                </button>
              ) : null}
            </span>
          ))}
          {!activeTeams.length ? <span className={styles.emptyHint}>Sem equipe alocada.</span> : null}
        </div>
      </div>

      {isActive && canPendencia ? (
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

    </article>
  );
}

// Menu por chip de equipe: substitui o "x" solto por 3 acoes. Remover continua
// sem motivo (correcao de cadastro); Cancelar participacao/Adiar equipe abrem
// modal proprio (pedem motivo, e podem esbarrar na guarda de ultima equipe
// ativa — ver LastActiveTeamModal). Estado do menu (aberto/fechado) e local,
// autocontido — nao precisa subir pro estado do pai.
export function TeamChipMenu(props: {
  teamName: string;
  disabled: boolean;
  onRemove: () => void;
  onCancelParticipation: () => void;
  onPostpone: () => void;
}) {
  const { teamName, disabled, onRemove, onCancelParticipation, onPostpone } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const panelWidth = panelRef.current?.offsetWidth ?? 190;
    const panelHeight = panelRef.current?.offsetHeight ?? 116;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const belowTop = rect.bottom + gap;
    const aboveTop = rect.top - panelHeight - gap;
    const fitsBelow = belowTop + panelHeight <= viewportHeight - margin;
    const top = fitsBelow ? belowTop : Math.max(margin, aboveTop);
    const maxLeft = Math.max(margin, viewportWidth - panelWidth - margin);
    const left = Math.min(Math.max(margin, rect.right - panelWidth), maxLeft);

    setMenuPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (disabled) return null;

  const menuPanel = isOpen && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={panelRef}
          className={styles.teamChipMenuPanel}
          style={{ top: menuPosition.top, left: menuPosition.left }}
          onMouseLeave={() => setIsOpen(false)}
        >
          <button type="button" onClick={() => { setIsOpen(false); onRemove(); }}>
            Remover
          </button>
          <button type="button" onClick={() => { setIsOpen(false); onCancelParticipation(); }}>
            Cancelar participacao...
          </button>
          <button type="button" onClick={() => { setIsOpen(false); onPostpone(); }}>
            Adiar equipe...
          </button>
        </div>,
        document.body
      )
    : null;

  return (
    <span className={styles.teamChipMenu}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.teamChipMenuTrigger}
        aria-label={`Acoes de ${teamName}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        &#8942;
      </button>
      {menuPanel}
    </span>
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
  // Permissao granular programacao-pendencia (migration 328): criar etapa com a
  // flag fura a trava de projeto concluido, entao o backend recusa o INSERT sem
  // a permissao — a checkbox nao pode aparecer para quem nao a tem.
  canPendencia: boolean;
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
    canPendencia,
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

        {!isEditing && canPendencia ? (
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
                <label key={team.id} className={form.teamIds.includes(team.id) ? `${styles.teamOption} ${styles.teamOptionSelected}` : styles.teamOption}>
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
