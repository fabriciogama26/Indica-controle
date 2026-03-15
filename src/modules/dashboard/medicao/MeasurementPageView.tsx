"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";

import styles from "./MeasurementPageView.module.css";

type SourceMode = "programming" | "project";

type FactorRule = {
  id: string;
  label: string;
  multiplier: number;
  description: string;
};

type ProjectItem = {
  id: string;
  code: string;
  serviceName: string;
  city: string;
  base: string;
  note: string;
};

type ScheduleActivityItem = {
  catalogId: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
};

type ScheduleItem = {
  id: string;
  projectId: string;
  teamId: string;
  date: string;
  startTime: string;
  endTime: string;
  updatedAt: string;
  activities: ScheduleActivityItem[];
  feeder: string;
  note: string;
};

type TeamItem = {
  id: string;
  name: string;
  serviceCenterName: string;
  foremanName: string;
};

type ProgrammingResponse = {
  projects?: Array<{
    id: string;
    code: string;
    serviceName: string;
    city: string;
    base: string;
    note: string;
  }>;
  teams?: Array<{
    id: string;
    name: string;
    serviceCenterName: string;
    foremanName: string;
  }>;
  schedules?: Array<{
    id: string;
    projectId: string;
    teamId: string;
    date: string;
    startTime: string;
    endTime: string;
    updatedAt: string;
    feeder: string;
    note: string;
    activities?: ScheduleActivityItem[];
  }>;
  message?: string;
};

type ForecastResponse = {
  items?: Array<{
    id: string;
    activityId: string;
    code: string;
    description: string;
    type: string | null;
    unit: string;
    unitValue: number;
    qtyPlanned: number;
    observation: string | null;
  }>;
  message?: string;
};

type MeasurementRow = {
  id: string;
  activityId: string | null;
  code: string;
  description: string;
  unit: string;
  qtyPlanned: number;
  qtyExecuted: number;
  unitValue: number;
  observation: string;
};

type FeedbackState = {
  type: "success" | "error";
  message: string;
};

const FACTOR_RULES: FactorRule[] = [
  {
    id: "normal",
    label: "Normal",
    multiplier: 1,
    description: "Regra padrao da medicao. Aplicada ao abrir a tela.",
  },
  {
    id: "emergency",
    label: "Emergencial",
    multiplier: 1.2,
    description: "Usar quando o projeto exigir atendimento emergencial.",
  },
  {
    id: "city",
    label: "Municipio com modificador",
    multiplier: 1.25,
    description: "Regra reservada para municipio especifico vinculado no backend.",
  },
  {
    id: "island",
    label: "Ilha",
    multiplier: 2.85,
    description: "Usar quando o projeto estiver marcado como ilha.",
  },
];

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, amount: number) {
  const nextDate = new Date(base);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function formatDate(value: string) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("pt-BR");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatFactor(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function parseDecimal(value: string) {
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Number(parsed.toFixed(2));
}

function createRowId() {
  return `row-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyRow(): MeasurementRow {
  return {
    id: createRowId(),
    activityId: null,
    code: "",
    description: "",
    unit: "",
    qtyPlanned: 0,
    qtyExecuted: 0,
    unitValue: 0,
    observation: "",
  };
}

function mapForecastRows(items: NonNullable<ForecastResponse["items"]>): MeasurementRow[] {
  return items.map((item) => ({
    id: createRowId(),
    activityId: item.activityId,
    code: item.code ?? "",
    description: item.description ?? "",
    unit: item.unit ?? "",
    qtyPlanned: Number(item.qtyPlanned ?? 0),
    qtyExecuted: Number(item.qtyPlanned ?? 0),
    unitValue: Number(item.unitValue ?? 0),
    observation: item.observation ?? "",
  }));
}

function mapScheduleRows(params: {
  schedule: ScheduleItem;
  forecastItems: NonNullable<ForecastResponse["items"]>;
}) {
  const forecastByCatalogId = new Map(params.forecastItems.map((item) => [item.activityId, item]));
  const forecastByCode = new Map(params.forecastItems.map((item) => [item.code, item]));

  return params.schedule.activities.map((activity) => {
    const forecast =
      forecastByCatalogId.get(activity.catalogId) ??
      forecastByCode.get(activity.code) ??
      null;

    return {
      id: createRowId(),
      activityId: activity.catalogId,
      code: activity.code,
      description: activity.description,
      unit: activity.unit,
      qtyPlanned: Number(activity.quantity ?? 0),
      qtyExecuted: Number(activity.quantity ?? 0),
      unitValue: Number(forecast?.unitValue ?? 0),
      observation: forecast?.observation ?? "",
    } satisfies MeasurementRow;
  });
}

export function MeasurementPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const today = useMemo(() => new Date(), []);
  const [sourceMode, setSourceMode] = useState<SourceMode>("programming");
  const [rangeStart, setRangeStart] = useState(toIsoDate(today));
  const [rangeEnd, setRangeEnd] = useState(toIsoDate(addDays(today, 30)));
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [measurementCode, setMeasurementCode] = useState("");
  const [serviceOrderCode, setServiceOrderCode] = useState("");
  const [measurementDate, setMeasurementDate] = useState(toIsoDate(today));
  const [measurementTitle, setMeasurementTitle] = useState("");
  const [measurementNote, setMeasurementNote] = useState("");
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [selectedFactorRuleId, setSelectedFactorRuleId] = useState("normal");
  const [isEmergency, setIsEmergency] = useState(false);
  const [hasCityModifier, setHasCityModifier] = useState(false);
  const [isIsland, setIsIsland] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [lastPreviewAt, setLastPreviewAt] = useState("");

  const activeProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const activeSchedule = useMemo(
    () => schedules.find((item) => item.id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId],
  );
  const activeTeam = useMemo(
    () => teams.find((item) => item.id === activeSchedule?.teamId) ?? null,
    [activeSchedule?.teamId, teams],
  );
  const selectedFactorRule = useMemo(
    () => FACTOR_RULES.find((item) => item.id === selectedFactorRuleId) ?? FACTOR_RULES[0],
    [selectedFactorRuleId],
  );

  const suggestedRuleIds = useMemo(() => {
    const suggestions: string[] = [];

    if (isIsland) {
      suggestions.push("island");
    }
    if (hasCityModifier) {
      suggestions.push("city");
    }
    if (isEmergency) {
      suggestions.push("emergency");
    }

    return suggestions;
  }, [hasCityModifier, isEmergency, isIsland]);

  const factorConflict =
    suggestedRuleIds.length > 1
      ? "Mais de uma regra de fator foi marcada. Nesta primeira versao do front, escolha manualmente a regra final."
      : "";

  const totalPlanned = useMemo(
    () => rows.reduce((total, item) => total + item.qtyPlanned, 0),
    [rows],
  );
  const totalExecuted = useMemo(
    () => rows.reduce((total, item) => total + item.qtyExecuted, 0),
    [rows],
  );
  const totalAmount = useMemo(
    () =>
      rows.reduce(
        (total, item) => total + item.qtyExecuted * item.unitValue * selectedFactorRule.multiplier,
        0,
      ),
    [rows, selectedFactorRule.multiplier],
  );

  const scheduleOptions = useMemo(() => {
    const list = selectedProjectId
      ? schedules.filter((item) => item.projectId === selectedProjectId)
      : schedules;

    return list.sort((left, right) => {
      if (left.date === right.date) {
        return left.startTime.localeCompare(right.startTime);
      }

      return left.date.localeCompare(right.date);
    });
  }, [schedules, selectedProjectId]);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setTeams([]);
      setSchedules([]);
      return;
    }

    let ignore = false;

    async function loadSources() {
      setIsLoadingSources(true);

      try {
        const response = await fetch(`/api/programacao?startDate=${rangeStart}&endDate=${rangeEnd}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });

        const data = (await response.json().catch(() => null)) as ProgrammingResponse | null;
        if (!response.ok) {
          throw new Error(data?.message ?? "Falha ao carregar projetos e programacoes para a medicao.");
        }

        if (ignore) {
          return;
        }

        const nextProjects = (data?.projects ?? []).map((item) => ({
          id: item.id,
          code: item.code,
          serviceName: item.serviceName,
          city: item.city,
          base: item.base,
          note: item.note,
        }));
        const nextTeams = (data?.teams ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          serviceCenterName: item.serviceCenterName,
          foremanName: item.foremanName,
        }));
        const nextSchedules = (data?.schedules ?? []).map((item) => ({
          id: item.id,
          projectId: item.projectId,
          teamId: item.teamId,
          date: item.date,
          startTime: item.startTime,
          endTime: item.endTime,
          updatedAt: item.updatedAt,
          feeder: item.feeder ?? "",
          note: item.note ?? "",
          activities: item.activities ?? [],
        }));

        setProjects(nextProjects);
        setTeams(nextTeams);
        setSchedules(nextSchedules);

        setSelectedProjectId((current) => {
          if (current && nextProjects.some((item) => item.id === current)) {
            return current;
          }

          return nextProjects[0]?.id ?? "";
        });

        setSelectedScheduleId((current) => {
          if (current && nextSchedules.some((item) => item.id === current)) {
            return current;
          }

          return "";
        });
      } catch (error) {
        if (!ignore) {
          setFeedback({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Falha ao carregar projetos e programacoes para a medicao.",
          });
        }
      } finally {
        if (!ignore) {
          setIsLoadingSources(false);
        }
      }
    }

    void loadSources();

    return () => {
      ignore = true;
    };
  }, [accessToken, rangeEnd, rangeStart]);

  useEffect(() => {
    if (!selectedProjectId) {
      setRows([]);
      return;
    }

    let ignore = false;

    async function loadForecast() {
      setIsLoadingForecast(true);

      try {
        const response = await fetch(`/api/projects/activity-forecast?projectId=${selectedProjectId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });

        const data = (await response.json().catch(() => null)) as ForecastResponse | null;
        if (!response.ok) {
          throw new Error(data?.message ?? "Falha ao carregar atividades previstas do projeto.");
        }

        if (ignore) {
          return;
        }

        const forecastItems = data?.items ?? [];
        const nextRows =
          sourceMode === "programming" && activeSchedule
            ? mapScheduleRows({
                schedule: activeSchedule,
                forecastItems,
              })
            : mapForecastRows(forecastItems);

        setRows(nextRows);
      } catch (error) {
        if (!ignore) {
          setRows([]);
          setFeedback({
            type: "error",
            message:
              error instanceof Error ? error.message : "Falha ao carregar atividades previstas do projeto.",
          });
        }
      } finally {
        if (!ignore) {
          setIsLoadingForecast(false);
        }
      }
    }

    if (accessToken) {
      void loadForecast();
    }

    return () => {
      ignore = true;
    };
  }, [accessToken, activeSchedule, selectedProjectId, sourceMode]);

  useEffect(() => {
    if (!activeProject) {
      setMeasurementTitle("");
      setMeasurementNote("");
      return;
    }

    setMeasurementTitle((current) =>
      current.trim() ? current : `Medicao ${activeProject.code} - ${activeProject.serviceName}`,
    );
    setMeasurementNote((current) => (current.trim() ? current : activeProject.note ?? ""));
  }, [activeProject]);

  useEffect(() => {
    if (!activeSchedule) {
      return;
    }

    setSelectedProjectId(activeSchedule.projectId);
    setMeasurementDate(activeSchedule.date);
    setMeasurementTitle((current) =>
      current.trim() ? current : `OS ${activeProject?.code ?? ""} - ${formatDate(activeSchedule.date)}`,
    );
  }, [activeProject?.code, activeSchedule]);

  useEffect(() => {
    if (suggestedRuleIds.length === 0) {
      setSelectedFactorRuleId("normal");
      return;
    }

    if (suggestedRuleIds.length === 1) {
      setSelectedFactorRuleId(suggestedRuleIds[0]);
    }
  }, [suggestedRuleIds]);

  function handleSourceModeChange(nextMode: SourceMode) {
    setSourceMode(nextMode);
    setSelectedScheduleId("");
    setLastPreviewAt("");
  }

  function handleProjectChange(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedScheduleId("");
    setLastPreviewAt("");
  }

  function handleScheduleChange(scheduleId: string) {
    setSelectedScheduleId(scheduleId);
    const schedule = schedules.find((item) => item.id === scheduleId) ?? null;
    if (schedule) {
      setSelectedProjectId(schedule.projectId);
      setMeasurementDate(schedule.date);
      setServiceOrderCode((current) => current || `OS-${schedule.date.replaceAll("-", "")}`);
    }
    setLastPreviewAt("");
  }

  function updateRow(
    rowId: string,
    field: keyof Omit<MeasurementRow, "id" | "activityId">,
    value: string,
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        if (field === "qtyPlanned" || field === "qtyExecuted" || field === "unitValue") {
          return {
            ...row,
            [field]: parseDecimal(value),
          };
        }

        return {
          ...row,
          [field]: value,
        };
      }),
    );
  }

  function addManualRow() {
    setRows((current) => [...current, createEmptyRow()]);
  }

  function removeRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
  }

  function resetMeasurement() {
    setRows([]);
    setMeasurementCode("");
    setServiceOrderCode("");
    setMeasurementTitle("");
    setMeasurementNote("");
    setSelectedFactorRuleId("normal");
    setIsEmergency(false);
    setHasCityModifier(false);
    setIsIsland(false);
    setLastPreviewAt("");
    setFeedback(null);
  }

  function validatePreview() {
    if (!selectedProjectId) {
      setFeedback({ type: "error", message: "Selecione um projeto para montar a medicao." });
      return;
    }

    if (sourceMode === "programming" && !selectedScheduleId) {
      setFeedback({ type: "error", message: "Selecione uma programacao para gerar a OS da medicao." });
      return;
    }

    if (!rows.length) {
      setFeedback({ type: "error", message: "Inclua pelo menos uma atividade na medicao." });
      return;
    }

    const hasInvalidRow = rows.some((item) => !item.code.trim() || !item.description.trim() || item.qtyExecuted <= 0);
    if (hasInvalidRow) {
      setFeedback({
        type: "error",
        message: "Preencha codigo, descricao e quantidade executada maior que zero em todas as linhas.",
      });
      return;
    }

    setLastPreviewAt(new Date().toLocaleString("pt-BR"));
    setFeedback({
      type: "success",
      message:
        "Previa da medicao montada no frontend. Persistencia propria e regras finais de backend ainda serao implementadas.",
    });
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}

      <div className={styles.heroGrid}>
        <article className={styles.heroCard}>
          <span className={styles.eyebrow}>Medicao</span>
          <h2>Cadastro de OS e medicao por projeto</h2>
          <p>
            Esta primeira entrega monta o frontend da tela, reaproveitando `Projetos` e `Programacao` como origem
            da medicao, com calculo local e sem persistencia propria.
          </p>
          <div className={styles.heroTags}>
            <span>Projeto</span>
            <span>Programacao</span>
            <span>Atividades previstas</span>
            <span>Fator de multiplicacao</span>
          </div>
        </article>

        <article className={styles.summaryCard}>
          <div>
            <span className={styles.summaryLabel}>Regra atual</span>
            <strong>{selectedFactorRule.label}</strong>
            <small>Fator {formatFactor(selectedFactorRule.multiplier)}</small>
          </div>
          <div>
            <span className={styles.summaryLabel}>Quantidade executada</span>
            <strong>{totalExecuted.toFixed(2)}</strong>
            <small>{rows.length} atividade(s)</small>
          </div>
          <div>
            <span className={styles.summaryLabel}>Valor total</span>
            <strong>{formatCurrency(totalAmount)}</strong>
            <small>Calculo local do frontend</small>
          </div>
        </article>
      </div>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>Origem da medicao</h3>
            <p className={styles.cardSubtitle}>
              Selecione se a OS sera aberta a partir de uma programacao existente ou direto no projeto.
            </p>
          </div>
          {isLoadingSources ? <span className={styles.loadingHint}>Atualizando fontes...</span> : null}
        </div>

        <div className={styles.sourceTabs}>
          <button
            type="button"
            className={sourceMode === "programming" ? styles.sourceTabActive : styles.sourceTab}
            onClick={() => handleSourceModeChange("programming")}
          >
            Gerar da Programacao
          </button>
          <button
            type="button"
            className={sourceMode === "project" ? styles.sourceTabActive : styles.sourceTab}
            onClick={() => handleSourceModeChange("project")}
          >
            Criar do Projeto
          </button>
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Inicio da busca</span>
            <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Fim da busca</span>
            <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Projeto</span>
            <select value={selectedProjectId} onChange={(event) => handleProjectChange(event.target.value)}>
              <option value="">Selecione</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.serviceName}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Programacao</span>
            <select
              value={selectedScheduleId}
              onChange={(event) => handleScheduleChange(event.target.value)}
              disabled={sourceMode !== "programming"}
            >
              <option value="">{sourceMode === "programming" ? "Selecione" : "Nao se aplica"}</option>
              {scheduleOptions.map((schedule) => {
                const project = projects.find((item) => item.id === schedule.projectId);
                const team = teams.find((item) => item.id === schedule.teamId);
                return (
                  <option key={schedule.id} value={schedule.id}>
                    {formatDate(schedule.date)} | {project?.code ?? "Projeto"} | {team?.name ?? "Equipe"}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        <div className={styles.contextGrid}>
          <div className={styles.contextBox}>
            <span className={styles.contextLabel}>Projeto</span>
            <strong>{activeProject ? `${activeProject.code} - ${activeProject.serviceName}` : "Nao selecionado"}</strong>
            <small>
              {activeProject ? `${activeProject.city} | ${activeProject.base}` : "Selecione um projeto para carregar o previsto."}
            </small>
          </div>
          <div className={styles.contextBox}>
            <span className={styles.contextLabel}>OS / programacao</span>
            <strong>{activeSchedule ? formatDate(activeSchedule.date) : "Nao vinculada"}</strong>
            <small>
              {activeTeam
                ? `${activeTeam.name} | ${activeTeam.serviceCenterName}`
                : sourceMode === "project"
                  ? "Criacao manual a partir do projeto."
                  : "Selecione uma programacao ativa."}
            </small>
          </div>
          <div className={styles.contextBox}>
            <span className={styles.contextLabel}>Base da medicao</span>
            <strong>{isLoadingForecast ? "Carregando..." : `${rows.length} atividade(s)`}</strong>
            <small>
              {sourceMode === "programming"
                ? "Linhas partem da programacao e complementam valor unitario do previsto."
                : "Linhas partem do previsto do projeto."}
            </small>
          </div>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>Cabecalho da medicao</h3>
            <p className={styles.cardSubtitle}>Campos iniciais da OS e observacoes da medicao.</p>
          </div>
        </div>

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Codigo da medicao</span>
            <input
              value={measurementCode}
              onChange={(event) => setMeasurementCode(event.target.value)}
              placeholder="Ex.: MED-2026-0001"
            />
          </label>
          <label className={styles.field}>
            <span>Codigo da OS</span>
            <input
              value={serviceOrderCode}
              onChange={(event) => setServiceOrderCode(event.target.value)}
              placeholder="Ex.: OS-20260314-01"
            />
          </label>
          <label className={styles.field}>
            <span>Data da medicao</span>
            <input type="date" value={measurementDate} onChange={(event) => setMeasurementDate(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Origem</span>
            <input value={sourceMode === "programming" ? "Programacao" : "Projeto"} readOnly />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Titulo</span>
            <input
              value={measurementTitle}
              onChange={(event) => setMeasurementTitle(event.target.value)}
              placeholder="Titulo operacional da medicao"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Observacoes</span>
            <textarea
              value={measurementNote}
              onChange={(event) => setMeasurementNote(event.target.value)}
              rows={4}
              placeholder="Observacoes operacionais, premissas e pendencias da medicao."
            />
          </label>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>Fator de multiplicacao</h3>
            <p className={styles.cardSubtitle}>
              A tela abre em `1,00`. As regras automaticas finais ainda serao consolidadas no backend.
            </p>
          </div>
        </div>

        <div className={styles.factorLayout}>
          <div className={styles.factorRules}>
            {FACTOR_RULES.map((rule) => (
              <button
                key={rule.id}
                type="button"
                className={selectedFactorRuleId === rule.id ? styles.factorRuleActive : styles.factorRule}
                onClick={() => setSelectedFactorRuleId(rule.id)}
              >
                <strong>{rule.label}</strong>
                <span>Fator {formatFactor(rule.multiplier)}</span>
                <small>{rule.description}</small>
              </button>
            ))}
          </div>

          <div className={styles.factorSignals}>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={isEmergency} onChange={() => setIsEmergency((current) => !current)} />
              <span>Projeto emergencial</span>
            </label>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={hasCityModifier}
                onChange={() => setHasCityModifier((current) => !current)}
              />
              <span>Municipio com modificador 1,25</span>
            </label>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={isIsland} onChange={() => setIsIsland((current) => !current)} />
              <span>Projeto em ilha</span>
            </label>

            <div className={styles.factorHintBox}>
              <strong>Observacao desta etapa</strong>
              <p>
                O vinculo final do fator `1,25` com municipio especifico e a fonte de verdade do campo `ilha`
                ainda serao resolvidos no backend e no cadastro de projeto/locacao.
              </p>
            </div>

            {factorConflict ? <div className={styles.factorWarning}>{factorConflict}</div> : null}
          </div>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Itens da medicao</h3>
            <p className={styles.cardSubtitle}>
              Quantidade executada x valor unitario x fator {formatFactor(selectedFactorRule.multiplier)}.
            </p>
          </div>
          <div className={styles.tableActions}>
            <button type="button" className={styles.secondaryButton} onClick={addManualRow}>
              Incluir linha manual
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Descricao</th>
                <th>Unidade</th>
                <th>Qtd. prevista</th>
                <th>Qtd. executada</th>
                <th>Valor unitario</th>
                <th>Fator</th>
                <th>Valor total</th>
                <th>Observacao</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => {
                  const rowTotal = row.qtyExecuted * row.unitValue * selectedFactorRule.multiplier;

                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          className={styles.tableInput}
                          value={row.code}
                          onChange={(event) => updateRow(row.id, "code", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.tableInput}
                          value={row.description}
                          onChange={(event) => updateRow(row.id, "description", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.tableInput}
                          value={row.unit}
                          onChange={(event) => updateRow(row.id, "unit", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.tableInput}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.qtyPlanned}
                          onChange={(event) => updateRow(row.id, "qtyPlanned", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.tableInput}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.qtyExecuted}
                          onChange={(event) => updateRow(row.id, "qtyExecuted", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.tableInput}
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.unitValue}
                          onChange={(event) => updateRow(row.id, "unitValue", event.target.value)}
                        />
                      </td>
                      <td>
                        <span className={styles.factorTag}>{formatFactor(selectedFactorRule.multiplier)}</span>
                      </td>
                      <td>{formatCurrency(rowTotal)}</td>
                      <td>
                        <input
                          className={styles.tableInput}
                          value={row.observation}
                          onChange={(event) => updateRow(row.id, "observation", event.target.value)}
                        />
                      </td>
                      <td>
                        <button type="button" className={styles.ghostButton} onClick={() => removeRow(row.id)}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className={styles.emptyRow} colSpan={10}>
                    Nenhuma atividade carregada. Selecione projeto/programacao ou adicione uma linha manual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.totalBar}>
          <div>
            <span>Total previsto</span>
            <strong>{totalPlanned.toFixed(2)}</strong>
          </div>
          <div>
            <span>Total executado</span>
            <strong>{totalExecuted.toFixed(2)}</strong>
          </div>
          <div>
            <span>Valor total</span>
            <strong>{formatCurrency(totalAmount)}</strong>
          </div>
        </div>
      </article>

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Conferencia</h3>
            <p className={styles.cardSubtitle}>
              Esta area fecha a conferencia funcional do front antes da API propria de medicao.
            </p>
          </div>
        </div>

        <div className={styles.reviewGrid}>
          <div className={styles.reviewItem}>
            <span>Projeto</span>
            <strong>{activeProject ? activeProject.code : "Nao selecionado"}</strong>
            <small>{activeProject?.serviceName ?? "Sem projeto definido."}</small>
          </div>
          <div className={styles.reviewItem}>
            <span>OS / origem</span>
            <strong>{serviceOrderCode || "Nao informado"}</strong>
            <small>{sourceMode === "programming" ? "Origem por programacao" : "Origem direta no projeto"}</small>
          </div>
          <div className={styles.reviewItem}>
            <span>Equipe / data</span>
            <strong>{activeTeam?.name ?? "Nao vinculada"}</strong>
            <small>{activeSchedule ? formatDate(activeSchedule.date) : "Sem programacao associada."}</small>
          </div>
          <div className={styles.reviewItem}>
            <span>Ultima previa</span>
            <strong>{lastPreviewAt || "Ainda nao gerada"}</strong>
            <small>Sem persistencia de backend nesta etapa.</small>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.primaryButton} onClick={validatePreview}>
            Gerar previa da medicao
          </button>
          <button type="button" className={styles.ghostButton} onClick={resetMeasurement}>
            Limpar tela
          </button>
        </div>
      </article>
    </section>
  );
}
