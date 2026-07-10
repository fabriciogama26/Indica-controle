"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { isAdminRole } from "@/lib/auth/authorization";
import { ActionIcon } from "@/components/ui/ActionIcon";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import { formatDate, formatDateTime } from "@/lib/utils/formatters";
import styles from "./CronogramaSolicitacoesPageView.module.css";
import {
  cancelSolicitacao,
  fetchEstadoProgramacao,
  fetchList,
  fetchMeta,
  fetchTipoDefaults,
  saveSolicitacao,
  setTipoDefault,
  verifySolicitacao,
} from "./api";
import {
  DEFAULT_FILTERS,
  PRIORIDADE_LABEL,
  SORT_OPTIONS,
  STATUS_LABEL,
  TIPO_LABEL,
} from "./constants";
import type {
  FilterState,
  FormState,
  MetaResponse,
  Prioridade,
  ProjetoOption,
  SolicitacaoItem,
  SolicitacaoSummary,
  TipoDefaultUser,
  TipoSolicitacao,
} from "./types";

const EMPTY_SUMMARY: SolicitacaoSummary = {
  total: 0,
  pendentes: 0,
  concluidas: 0,
  atrasadas: 0,
  vencendoHoje: 0,
  vencendoProximos3: 0,
};

function addDaysIso(dateIso: string, days: number): string {
  const parsed = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function computePreviewDataLimite(prioridade: Prioridade, dataEntrada: string, manual: string): string {
  if (!dataEntrada) return "";
  if (prioridade === "BAIXA") return addDaysIso(dataEntrada, 10);
  if (prioridade === "MEDIA") return addDaysIso(dataEntrada, 5);
  return manual;
}

function emptyForm(): FormState {
  return {
    id: null,
    projetoId: "",
    projetoBusca: "",
    tipo: "INSPECAO",
    prioridade: "BAIXA",
    dataEntrada: "",
    dataLimite: "",
    responsavelId: "",
    observacao: "",
    justificativaPrioridade: "",
    expectedUpdatedAt: null,
  };
}

function priorityClass(prioridade: string): string {
  if (prioridade === "ALTA") return styles.badgeAlta;
  if (prioridade === "MEDIA") return styles.badgeMedia;
  if (prioridade === "BAIXA") return styles.badgeBaixa;
  return "";
}

function statusClass(status: string): string {
  if (status === "CONCLUIDO") return styles.badgeConcluido;
  if (status === "ATRASADO") return styles.badgeAtrasado;
  if (status === "CANCELADO") return styles.badgeCancelado;
  return styles.badgePendente;
}

export function CronogramaSolicitacoesPageView() {
  const { session } = useAuth();
  const token = session?.accessToken ?? "";
  const isAdmin = isAdminRole(session?.user.role);

  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [items, setItems] = useState<SolicitacaoItem[]>([]);
  const [summary, setSummary] = useState<SolicitacaoSummary>(EMPTY_SUMMARY);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [detailsItem, setDetailsItem] = useState<SolicitacaoItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [estadoInfo, setEstadoInfo] = useState<{ allowed: boolean; message: string | null; estado: string } | null>(null);

  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [defaultUsers, setDefaultUsers] = useState<TipoDefaultUser[]>([]);
  const [defaultsLoading, setDefaultsLoading] = useState(false);

  const asbuiltSet = useMemo(() => new Set(meta?.asbuiltProjetoIds ?? []), [meta]);
  const projectMap = useMemo(() => {
    const map = new Map<string, ProjetoOption>();
    (meta?.projetos ?? []).forEach((p) => map.set(p.id, p));
    return map;
  }, [meta]);

  const loadMeta = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchMeta(token);
      setMeta(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dados de apoio.");
    }
  }, [token]);

  const loadList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchList(token, filters, page);
      setItems(data.items);
      setSummary(data.summary);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar solicitacoes.");
    } finally {
      setLoading(false);
    }
  }, [token, filters, page]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const updateFilter = (patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));

  const projectOptions = useMemo(() => {
    const term = form.projetoBusca.trim().toUpperCase();
    let list = meta?.projetos ?? [];
    if (form.tipo === "AS_BUILT") {
      list = list.filter((p) => asbuiltSet.has(p.id));
    }
    if (term) {
      list = list.filter((p) => p.codigo.toUpperCase().includes(term) || p.municipio.toUpperCase().includes(term));
    }
    return list.slice(0, 30);
  }, [meta, form.projetoBusca, form.tipo, asbuiltSet]);

  const selectedProject = form.projetoId ? projectMap.get(form.projetoId) ?? null : null;
  const previewDataLimite = computePreviewDataLimite(form.prioridade, form.dataEntrada, form.dataLimite);

  const validateEstado = useCallback(
    async (projetoId: string, tipo: TipoSolicitacao) => {
      if (!token || !projetoId) {
        setEstadoInfo(null);
        return;
      }
      try {
        const data = await fetchEstadoProgramacao(token, projetoId, tipo);
        setEstadoInfo({ allowed: data.allowed, message: data.blockMessage, estado: data.estadoProgramacao });
      } catch {
        setEstadoInfo(null);
      }
    },
    [token],
  );

  const openCreate = () => {
    const base = emptyForm();
    const dflt = meta?.defaultTipo;
    if (dflt === "INSPECAO" || dflt === "AS_BUILT" || dflt === "LOCACAO") {
      base.tipo = dflt;
    }
    setForm(base);
    setEstadoInfo(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openDefaults = async () => {
    if (!token) return;
    setDefaultsOpen(true);
    setDefaultsLoading(true);
    try {
      const data = await fetchTipoDefaults(token);
      setDefaultUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar tipos padrao por usuario.");
      setDefaultsOpen(false);
    } finally {
      setDefaultsLoading(false);
    }
  };

  const changeDefault = async (userId: string, tipo: string) => {
    if (!token) return;
    try {
      const res = await setTipoDefault(token, userId, tipo);
      setDefaultUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, defaultTipo: res.defaultTipo } : u)));
      if (userId === session?.user.userId) {
        setMeta((prev) => (prev ? { ...prev, defaultTipo: res.defaultTipo } : prev));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar tipo padrao.");
    }
  };

  const openEdit = (item: SolicitacaoItem) => {
    setForm({
      id: item.id,
      projetoId: item.projetoId,
      projetoBusca: item.projetoCodigo,
      tipo: item.tipo,
      prioridade: item.prioridade,
      dataEntrada: item.dataEntrada,
      dataLimite: item.dataLimite,
      responsavelId: item.responsavelId,
      observacao: item.observacao ?? "",
      justificativaPrioridade: item.justificativaPrioridade ?? "",
      expectedUpdatedAt: item.updatedAt,
    });
    setEstadoInfo(null);
    setFormError(null);
    setFormOpen(true);
    if (item.tipo === "AS_BUILT") void validateEstado(item.projetoId, "AS_BUILT");
  };

  const selectProject = (option: ProjetoOption) => {
    setForm((prev) => ({ ...prev, projetoId: option.id, projetoBusca: option.codigo }));
    if (form.tipo === "AS_BUILT") void validateEstado(option.id, "AS_BUILT");
  };

  const changeTipo = (tipo: TipoSolicitacao) => {
    setForm((prev) => ({ ...prev, tipo }));
    if (tipo === "AS_BUILT" && form.projetoId) {
      void validateEstado(form.projetoId, "AS_BUILT");
    } else {
      setEstadoInfo(null);
    }
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setFormError(null);

    if (!form.projetoId) {
      setFormError("Selecione um projeto valido da lista.");
      return;
    }
    if (!form.dataEntrada) {
      setFormError("Informe a Data de Entrada.");
      return;
    }
    if (!form.responsavelId) {
      setFormError("Selecione o responsavel.");
      return;
    }
    if (form.prioridade === "ALTA") {
      if (!form.dataLimite) {
        setFormError("Informe a Data Limite para prioridade Alta.");
        return;
      }
      if (form.dataLimite < form.dataEntrada) {
        setFormError("A Data Limite nao pode ser menor que a Data de Entrada.");
        return;
      }
      if (!form.justificativaPrioridade.trim()) {
        setFormError("Informe a justificativa da prioridade Alta.");
        return;
      }
    }
    if (form.tipo === "AS_BUILT" && estadoInfo && !estadoInfo.allowed) {
      setFormError(estadoInfo.message ?? "Estado da Programacao nao permite As Built.");
      return;
    }

    setSaving(true);
    try {
      await saveSolicitacao(token, {
        id: form.id,
        projetoId: form.projetoId,
        tipo: form.tipo,
        prioridade: form.prioridade,
        dataEntrada: form.dataEntrada,
        dataLimite: form.prioridade === "ALTA" ? form.dataLimite : null,
        responsavelId: form.responsavelId,
        observacao: form.observacao.trim() || null,
        justificativaPrioridade: form.prioridade === "ALTA" ? form.justificativaPrioridade.trim() : null,
        expectedUpdatedAt: form.expectedUpdatedAt,
      });
      setFormOpen(false);
      setFeedback(form.id ? "Solicitacao atualizada." : "Solicitacao cadastrada.");
      await loadList();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar solicitacao.");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async (item: SolicitacaoItem) => {
    if (!token) return;
    if (!window.confirm(`Marcar a solicitacao do projeto ${item.projetoCodigo} como Verificado (Concluido)?`)) return;
    try {
      await verifySolicitacao(token, item.id, item.updatedAt);
      setFeedback("Solicitacao verificada.");
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao verificar solicitacao.");
    }
  };

  const handleCancel = async (item: SolicitacaoItem) => {
    if (!token) return;
    const motivo = window.prompt("Informe o motivo do cancelamento:");
    if (motivo === null) return;
    if (!motivo.trim()) {
      setError("Motivo do cancelamento e obrigatorio.");
      return;
    }
    try {
      await cancelSolicitacao(token, item.id, motivo.trim(), item.updatedAt);
      setFeedback("Solicitacao cancelada.");
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar solicitacao.");
    }
  };

  const exportCsv = () => {
    const header = [
      "Projeto",
      "Tipo",
      "Prioridade",
      "Data de Entrada",
      "Data Limite",
      "Dias Restantes",
      "Dias em Atraso",
      "Responsavel",
      "Solicitante",
      "Municipio",
      "Estado da Programacao",
      "Status",
      "Ultima Atualizacao",
    ];
    const rows = items.map((item) => [
      item.projetoCodigo,
      TIPO_LABEL[item.tipo],
      PRIORIDADE_LABEL[item.prioridade],
      formatDate(item.dataEntrada),
      formatDate(item.dataLimite),
      item.diasRestantes ?? "",
      item.diasAtraso ?? "",
      item.responsavelNome,
      item.solicitanteNome,
      item.projetoMunicipio,
      item.estadoProgramacaoAtual,
      STATUS_LABEL[item.statusEfetivo],
      formatDateTime(item.updatedAt),
    ]);
    const content = buildCsvContent(header, rows);
    downloadCsvFile(content, `cronograma-solicitacoes-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const cards: Array<{ label: string; value: number; tone: string }> = [
    { label: "Total", value: summary.total, tone: styles.cardTotal },
    { label: "Pendentes", value: summary.pendentes, tone: styles.cardPendente },
    { label: "Concluidas", value: summary.concluidas, tone: styles.cardConcluido },
    { label: "Atrasadas", value: summary.atrasadas, tone: styles.cardAtrasado },
    { label: "Vencendo Hoje", value: summary.vencendoHoje, tone: styles.cardHoje },
    { label: "Vencendo em 3 dias", value: summary.vencendoProximos3, tone: styles.cardProximos },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Cronograma de Solicitacoes</h1>
          <p className={styles.subtitle}>Inspecao, As Built e Locacao com controle de prazo (SLA).</p>
        </div>
        <div className={styles.headerActions}>
          {isAdmin && (
            <button type="button" className={styles.secondaryButton} onClick={openDefaults}>
              Tipo padrao por usuario
            </button>
          )}
          <button type="button" className={styles.secondaryButton} onClick={exportCsv} disabled={!items.length}>
            Exportar Excel (CSV)
          </button>
          <button type="button" className={styles.primaryButton} onClick={openCreate}>
            Nova Solicitacao
          </button>
        </div>
      </header>

      <section className={styles.cards}>
        {cards.map((card) => (
          <div key={card.label} className={`${styles.card} ${card.tone}`}>
            <span className={styles.cardValue}>{card.value}</span>
            <span className={styles.cardLabel}>{card.label}</span>
          </div>
        ))}
      </section>

      {(error || feedback) && (
        <div className={error ? styles.alertError : styles.alertOk} onClick={() => { setError(null); setFeedback(null); }}>
          {error ?? feedback}
        </div>
      )}

      <section className={styles.filters}>
        <input
          className={styles.input}
          placeholder="Pesquisar (projeto, codigo, responsavel, solicitante)"
          value={filters.search}
          onChange={(e) => updateFilter({ search: e.target.value })}
        />
        <select className={styles.select} value={filters.tipo} onChange={(e) => updateFilter({ tipo: e.target.value })}>
          <option value="">Todos os tipos</option>
          {(meta?.tipos ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className={styles.select} value={filters.prioridade} onChange={(e) => updateFilter({ prioridade: e.target.value })}>
          <option value="">Todas as prioridades</option>
          {(meta?.prioridades ?? []).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select className={styles.select} value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
          <option value="">Todos os status</option>
          {(meta?.status ?? []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className={styles.select} value={filters.responsavelId} onChange={(e) => updateFilter({ responsavelId: e.target.value })}>
          <option value="">Todos os responsaveis</option>
          {(meta?.responsaveis ?? []).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <input
          className={styles.input}
          placeholder="Municipio"
          value={filters.municipio}
          onChange={(e) => updateFilter({ municipio: e.target.value })}
        />
        <label className={styles.dateField}>
          Prazo de
          <input type="date" className={styles.input} value={filters.dataLimiteInicio} onChange={(e) => updateFilter({ dataLimiteInicio: e.target.value })} />
        </label>
        <label className={styles.dateField}>
          Prazo ate
          <input type="date" className={styles.input} value={filters.dataLimiteFim} onChange={(e) => updateFilter({ dataLimiteFim: e.target.value })} />
        </label>
        <select className={styles.select} value={filters.sort} onChange={(e) => updateFilter({ sort: e.target.value })}>
          {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>Ordenar por {s.label}</option>)}
        </select>
        <button type="button" className={styles.secondaryButton} onClick={clearFilters}>Limpar</button>
      </section>

      <section className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Tipo</th>
              <th>Prioridade</th>
              <th>Entrada</th>
              <th>Prazo</th>
              <th>Dias</th>
              <th>Responsavel</th>
              <th>Ultimo Estado Prog.</th>
              <th>Status</th>
              <th>Atualizado</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} className={styles.emptyCell}>Carregando...</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={11} className={styles.emptyCell}>Nenhuma solicitacao encontrada.</td></tr>
            )}
            {!loading && items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.projetoCodigo}</strong>
                  <div className={styles.muted}>{item.projetoMunicipio}</div>
                </td>
                <td>{TIPO_LABEL[item.tipo]}</td>
                <td><span className={`${styles.badge} ${priorityClass(item.prioridade)}`}>{PRIORIDADE_LABEL[item.prioridade]}</span></td>
                <td>{formatDate(item.dataEntrada)}</td>
                <td>{formatDate(item.dataLimite)}</td>
                <td>
                  {item.statusEfetivo === "ATRASADO"
                    ? <span className={styles.atraso}>{item.diasAtraso} em atraso</span>
                    : item.diasRestantes !== null
                      ? `${item.diasRestantes} restante(s)`
                      : "-"}
                </td>
                <td>{item.responsavelNome}</td>
                <td>
                  {item.estadoProgramacaoAtual === "A PROGRAMAR"
                    ? <span className={styles.muted}>A PROGRAMAR</span>
                    : item.estadoProgramacaoAtual}
                </td>
                <td><span className={`${styles.badge} ${statusClass(item.statusEfetivo)}`}>{STATUS_LABEL[item.statusEfetivo]}</span></td>
                <td>
                  {formatDateTime(item.updatedAt)}
                  <div className={styles.muted}>{item.updatedByName}</div>
                </td>
                <td className={styles.actionsCell}>
                  <div className={styles.tableActions}>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.actionView}`}
                      onClick={() => setDetailsItem(item)}
                      title="Detalhes"
                      aria-label="Ver detalhes"
                    >
                      <ActionIcon name="details" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.actionEdit}`}
                      onClick={() => openEdit(item)}
                      title="Editar"
                      aria-label="Editar"
                      disabled={item.status !== "PENDENTE"}
                    >
                      <ActionIcon name="edit" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.actionActivate}`}
                      onClick={() => handleVerify(item)}
                      title="Verificado (concluir)"
                      aria-label="Verificado"
                      disabled={item.status !== "PENDENTE"}
                    >
                      <ActionIcon name="activate" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.actionButton} ${styles.actionCancel}`}
                      onClick={() => handleCancel(item)}
                      title="Cancelar"
                      aria-label="Cancelar"
                      disabled={item.status !== "PENDENTE"}
                    >
                      <ActionIcon name="cancel" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className={styles.pager}>
        <span>{pagination.total} solicitacao(oes) - pagina {pagination.page} de {totalPages}</span>
        <div className={styles.pagerButtons}>
          <button type="button" className={styles.secondaryButton} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Anterior</button>
          <button type="button" className={styles.secondaryButton} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Proxima</button>
        </div>
      </footer>

      {formOpen && (
        <div className={styles.modalBackdrop} onClick={() => !saving && setFormOpen(false)}>
          <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={submitForm}>
            <div className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle}>{form.id ? "Editar Solicitacao" : "Nova Solicitacao"}</h2>
                <p className={styles.modalSubtitle}>Solicitacao tecnica com controle de prazo (SLA).</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => !saving && setFormOpen(false)} aria-label="Fechar">
                &times;
              </button>
            </div>

            <div className={styles.modalBody}>
            <div className={styles.formGrid}>
              <label className={styles.formField}>
                Tipo de Solicitacao
                <select className={styles.select} value={form.tipo} onChange={(e) => changeTipo(e.target.value as TipoSolicitacao)}>
                  <option value="INSPECAO">Fiscalizacao</option>
                  <option value="AS_BUILT">As Built</option>
                  <option value="LOCACAO">Locacao</option>
                </select>
              </label>

              <label className={styles.formField}>
                Projeto {form.tipo === "AS_BUILT" ? "(somente Estado Trabalho Concluido ou Beneficio Atingido)" : ""}
                <input
                  className={styles.input}
                  placeholder="Digite o codigo do projeto"
                  value={form.projetoBusca}
                  onChange={(e) => setForm((prev) => ({ ...prev, projetoBusca: e.target.value, projetoId: "" }))}
                />
                {form.projetoBusca.trim() && !form.projetoId && (
                  <div className={styles.autocomplete}>
                    {projectOptions.length === 0 && <div className={styles.autocompleteEmpty}>Nenhum projeto</div>}
                    {projectOptions.map((option) => (
                      <button type="button" key={option.id} className={styles.autocompleteItem} onClick={() => selectProject(option)}>
                        <strong>{option.codigo}</strong> <span className={styles.muted}>{option.municipio}</span>
                      </button>
                    ))}
                  </div>
                )}
              </label>

              <label className={styles.formField}>
                Prioridade
                <select className={styles.select} value={form.prioridade} onChange={(e) => setForm((prev) => ({ ...prev, prioridade: e.target.value as Prioridade }))}>
                  <option value="BAIXA">Baixa (+10 dias)</option>
                  <option value="MEDIA">Media (+5 dias)</option>
                  <option value="ALTA">Alta (manual)</option>
                </select>
              </label>

              <label className={styles.formField}>
                Responsavel
                <select className={styles.select} value={form.responsavelId} onChange={(e) => setForm((prev) => ({ ...prev, responsavelId: e.target.value }))}>
                  <option value="">Selecione</option>
                  {(meta?.responsaveis ?? []).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                </select>
              </label>

              <label className={styles.formField}>
                Data de Entrada
                <input type="date" className={styles.input} value={form.dataEntrada} onChange={(e) => setForm((prev) => ({ ...prev, dataEntrada: e.target.value }))} />
              </label>

              <label className={styles.formField}>
                Data Limite
                {form.prioridade === "ALTA" ? (
                  <input type="date" className={styles.input} value={form.dataLimite} min={form.dataEntrada} onChange={(e) => setForm((prev) => ({ ...prev, dataLimite: e.target.value }))} />
                ) : (
                  <input className={styles.input} value={previewDataLimite ? formatDate(previewDataLimite) : "-"} readOnly />
                )}
              </label>

              {form.prioridade === "ALTA" && (
                <label className={`${styles.formField} ${styles.formFieldWide}`}>
                  Justificativa da Prioridade (Alta)
                  <textarea className={styles.textarea} value={form.justificativaPrioridade} onChange={(e) => setForm((prev) => ({ ...prev, justificativaPrioridade: e.target.value }))} />
                </label>
              )}

              <label className={`${styles.formField} ${styles.formFieldWide}`}>
                Observacoes
                <textarea className={styles.textarea} value={form.observacao} onChange={(e) => setForm((prev) => ({ ...prev, observacao: e.target.value }))} />
              </label>
            </div>

            {selectedProject && (
              <div className={styles.projectInfo}>
                <span><strong>Municipio:</strong> {selectedProject.municipio || "-"}</span>
                <span><strong>Endereco:</strong> {selectedProject.endereco || "-"}</span>
                <span><strong>Prioridade do Projeto:</strong> {selectedProject.prioridade || "-"}</span>
              </div>
            )}

            {form.tipo === "AS_BUILT" && estadoInfo && (
              <div className={estadoInfo.allowed ? styles.estadoOk : styles.estadoBlock}>
                Estado da Programacao: {estadoInfo.estado || "sem programacao"}.
                {!estadoInfo.allowed && ` ${estadoInfo.message}`}
              </div>
            )}

            {formError && <div className={styles.alertError}>{formError}</div>}
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</button>
              <button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        </div>
      )}

      {detailsItem && (
        <div className={styles.modalBackdrop} onClick={() => setDetailsItem(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle}>Detalhes da Solicitacao</h2>
                <p className={styles.modalSubtitle}>{TIPO_LABEL[detailsItem.tipo]} - {detailsItem.projetoCodigo}</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setDetailsItem(null)} aria-label="Fechar">
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              <dl className={styles.detailGrid}>
                <div><dt>Projeto</dt><dd>{detailsItem.projetoCodigo}</dd></div>
                <div><dt>Municipio</dt><dd>{detailsItem.projetoMunicipio || "-"}</dd></div>
                <div className={styles.detailWide}><dt>Endereco</dt><dd>{detailsItem.projetoEndereco || "-"}</dd></div>
                <div><dt>Prioridade do Projeto</dt><dd>{detailsItem.projetoPrioridade || "-"}</dd></div>
                <div><dt>Tipo</dt><dd>{TIPO_LABEL[detailsItem.tipo]}</dd></div>
                <div><dt>Prioridade</dt><dd>{PRIORIDADE_LABEL[detailsItem.prioridade]}</dd></div>
                <div><dt>Status</dt><dd>{STATUS_LABEL[detailsItem.statusEfetivo]}</dd></div>
                <div><dt>Estado da Programacao</dt><dd>{detailsItem.estadoProgramacaoAtual}</dd></div>
                <div><dt>Data de Entrada</dt><dd>{formatDate(detailsItem.dataEntrada)}</dd></div>
                <div><dt>Data Limite</dt><dd>{formatDate(detailsItem.dataLimite)}</dd></div>
                <div><dt>Data de Conclusao</dt><dd>{detailsItem.dataConclusao ? formatDate(detailsItem.dataConclusao) : "-"}</dd></div>
                <div>
                  <dt>Dias</dt>
                  <dd>
                    {detailsItem.statusEfetivo === "ATRASADO"
                      ? `${detailsItem.diasAtraso} em atraso`
                      : detailsItem.diasRestantes !== null
                        ? `${detailsItem.diasRestantes} restante(s)`
                        : "-"}
                  </dd>
                </div>
                <div><dt>Responsavel</dt><dd>{detailsItem.responsavelNome}</dd></div>
                <div><dt>Solicitante</dt><dd>{detailsItem.solicitanteNome}</dd></div>
                <div className={styles.detailWide}><dt>Observacoes</dt><dd>{detailsItem.observacao || "-"}</dd></div>
                {detailsItem.prioridade === "ALTA" && (
                  <div className={styles.detailWide}><dt>Justificativa da Prioridade</dt><dd>{detailsItem.justificativaPrioridade || "-"}</dd></div>
                )}
                {detailsItem.status === "CANCELADO" && (
                  <div className={styles.detailWide}><dt>Motivo do Cancelamento</dt><dd>{detailsItem.motivoCancelamento || "-"}</dd></div>
                )}
                {detailsItem.estadoProgramacaoSnapshot && (
                  <div className={styles.detailWide}><dt>Estado no cadastro (snapshot)</dt><dd>{detailsItem.estadoProgramacaoSnapshot}</dd></div>
                )}
                <div className={styles.detailWide}><dt>Criado por</dt><dd>{detailsItem.createdByName} - {formatDateTime(detailsItem.createdAt)}</dd></div>
                <div className={styles.detailWide}><dt>Atualizado por</dt><dd>{detailsItem.updatedByName} - {formatDateTime(detailsItem.updatedAt)}</dd></div>
              </dl>
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setDetailsItem(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {defaultsOpen && (
        <div className={styles.modalBackdrop} onClick={() => setDefaultsOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle}>Tipo padrao por usuario</h2>
                <p className={styles.modalSubtitle}>Define o tipo ja selecionado ao abrir Nova Solicitacao. O usuario ainda pode trocar.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setDefaultsOpen(false)} aria-label="Fechar">
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              {defaultsLoading && <div className={styles.muted}>Carregando...</div>}
              {!defaultsLoading && defaultUsers.length === 0 && <div className={styles.muted}>Nenhum usuario.</div>}
              {!defaultsLoading && defaultUsers.length > 0 && (
                <div className={styles.defaultsList}>
                  {defaultUsers.map((u) => (
                    <div key={u.userId} className={styles.defaultsRow}>
                      <span>{u.userName}</span>
                      <select
                        className={styles.select}
                        value={u.defaultTipo ?? ""}
                        onChange={(e) => changeDefault(u.userId, e.target.value)}
                      >
                        <option value="">(Nenhum)</option>
                        <option value="INSPECAO">Fiscalizacao</option>
                        <option value="AS_BUILT">As Built</option>
                        <option value="LOCACAO">Locacao</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setDefaultsOpen(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
