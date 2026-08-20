"use client";

import type { FormEvent } from "react";

import styles from "../../entrada/StockTransfersPageView.module.css";
import type { FilterState, MaterialCategoryOption, MaterialSubcategoryOption, TeamOption } from "../types";

type TeamOperationFiltersProps = {
  filterDraft: FilterState;
  activeTeams: TeamOption[];
  categoryOptions: MaterialCategoryOption[];
  filterSubcategoryOptions: MaterialSubcategoryOption[];
  filterProjectSearch: string;
  isLoadingHistory: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  onProjectSearchChange: (value: string) => void;
  onUpdateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  onUpdateCategory: (categoryId: string) => void;
};

export function TeamOperationFilters({
  filterDraft,
  activeTeams,
  categoryOptions,
  filterSubcategoryOptions,
  filterProjectSearch,
  isLoadingHistory,
  onSubmit,
  onClear,
  onProjectSearchChange,
  onUpdateFilter,
  onUpdateCategory,
}: TeamOperationFiltersProps) {
  return (
    <article className={styles.card}>
      <h3 className={styles.cardTitle}>Filtros</h3>

      <form className={styles.filterGrid} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span>Data inicial</span>
          <input type="date" value={filterDraft.startDate} onChange={(event) => onUpdateFilter("startDate", event.target.value)} />
        </label>

        <label className={styles.field}>
          <span>Data final</span>
          <input type="date" value={filterDraft.endDate} onChange={(event) => onUpdateFilter("endDate", event.target.value)} />
        </label>

        <label className={styles.field}>
          <span>Operacao</span>
          <select value={filterDraft.operationKind} onChange={(event) => onUpdateFilter("operationKind", event.target.value as FilterState["operationKind"])}>
            <option value="TODOS">Todos</option>
            <option value="REQUISITION">Requisicao</option>
            <option value="RETURN">Devolucao</option>
            <option value="FIELD_RETURN">Retorno de campo</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Equipe</span>
          <select value={filterDraft.teamId} onChange={(event) => onUpdateFilter("teamId", event.target.value)}>
            <option value="">Todas</option>
            {activeTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>

        <label className={styles.field}>
          <span>Projeto</span>
          <input
            type="text"
            value={filterProjectSearch}
            onChange={(event) => onProjectSearchChange(event.target.value)}
            list="saida-projeto-filtro-list"
            placeholder="Digite o codigo do projeto"
          />
        </label>

        <label className={styles.field}>
          <span>Material (codigo)</span>
          <input type="text" value={filterDraft.materialCode} onChange={(event) => onUpdateFilter("materialCode", event.target.value)} placeholder="Filtrar por material" />
        </label>

        <label className={styles.field}>
          <span>Categoria</span>
          <select value={filterDraft.categoryId} onChange={(event) => onUpdateCategory(event.target.value)}>
            <option value="">Todas</option>
            {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>

        <label className={styles.field}>
          <span>Subcategoria</span>
          <select value={filterDraft.subcategoryId} onChange={(event) => onUpdateFilter("subcategoryId", event.target.value)} disabled={!filterDraft.categoryId}>
            <option value="">Todas</option>
            {filterSubcategoryOptions.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
          </select>
        </label>

        <label className={styles.field}>
          <span>Tipo</span>
          <select value={filterDraft.entryType} onChange={(event) => onUpdateFilter("entryType", event.target.value as FilterState["entryType"])}>
            <option value="TODOS">Todos</option>
            <option value="NOVO">NOVO</option>
            <option value="SUCATA">SUCATA</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Status de estorno</span>
          <select value={filterDraft.reversalStatus} onChange={(event) => onUpdateFilter("reversalStatus", event.target.value as FilterState["reversalStatus"])}>
            <option value="TODOS">Todos</option>
            <option value="ESTORNADAS">Estornadas</option>
            <option value="NAO_ESTORNADAS">Nao estornadas</option>
            <option value="ESTORNOS">Somente estornos</option>
          </select>
        </label>

        <div className={styles.actions}>
          <button type="submit" className={styles.secondaryButton} disabled={isLoadingHistory}>Aplicar</button>
          <button type="button" className={styles.ghostButton} onClick={onClear} disabled={isLoadingHistory}>Limpar</button>
        </div>
      </form>
    </article>
  );
}
