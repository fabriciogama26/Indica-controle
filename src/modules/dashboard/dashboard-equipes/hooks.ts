"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";

import { fetchDashboardTeams } from "./api";
import { EMPTY_DASHBOARD_TEAMS_FILTERS } from "./constants";
import type {
  DashboardSupervisorRow,
  DashboardTeamsCategory,
  DashboardTeamForemanRow,
  DashboardTeamRow,
  DashboardTeamsCycle,
  DashboardTeamsFilters,
  DashboardTeamsOption,
  DashboardTeamsWeek,
} from "./types";

export function useDashboardTeams() {
  const { session } = useAuth();
  const logError = useErrorLogger("dashboard_equipes");
  const [filters, setFilters] = useState<DashboardTeamsFilters>({ ...EMPTY_DASHBOARD_TEAMS_FILTERS });
  const [draftFilters, setDraftFilters] = useState<DashboardTeamsFilters>({ ...EMPTY_DASHBOARD_TEAMS_FILTERS });
  const [teamCategories, setTeamCategories] = useState<DashboardTeamsCategory[]>([]);
  // Operacao que a resposta REALMENTE trouxe. E ela que decide os rotulos da tela --
  // usar o rascunho trocaria `Encarregado` por `Eletricista` antes de os dados
  // mudarem, com a tabela ainda mostrando a operacao anterior.
  const [appliedTeamCategoryCode, setAppliedTeamCategoryCode] = useState(
    EMPTY_DASHBOARD_TEAMS_FILTERS.teamCategoryCode as string,
  );
  const [cycles, setCycles] = useState<DashboardTeamsCycle[]>([]);
  const [projects, setProjects] = useState<DashboardTeamsOption[]>([]);
  const [teams, setTeams] = useState<DashboardTeamsOption[]>([]);
  const [foremen, setForemen] = useState<DashboardTeamsOption[]>([]);
  const [supervisors, setSupervisors] = useState<DashboardTeamsOption[]>([]);
  const [cycleWeeks, setCycleWeeks] = useState<DashboardTeamsWeek[]>([]);
  const [teamRows, setTeamRows] = useState<DashboardTeamRow[]>([]);
  const [teamRowsByWeek, setTeamRowsByWeek] = useState<Record<string, DashboardTeamRow[]>>({});
  const [teamForemanRows, setTeamForemanRows] = useState<DashboardTeamForemanRow[]>([]);
  const [teamForemanRowsByWeek, setTeamForemanRowsByWeek] = useState<Record<string, DashboardTeamForemanRow[]>>({});
  const [supervisorRows, setSupervisorRows] = useState<DashboardSupervisorRow[]>([]);
  const [supervisorRowsByWeek, setSupervisorRowsByWeek] = useState<Record<string, DashboardSupervisorRow[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const suppressNextAutoLoadRef = useRef(false);

  const load = useCallback(async () => {
    if (!session?.accessToken) return;

    setIsLoading(true);
    try {
      const data = await fetchDashboardTeams({
        accessToken: session.accessToken,
        filters,
      });
      const nextCycleStart = filters.cycleStart || data.selectedCycleStart || "";
      setTeamCategories(data.teamCategories ?? []);
      setAppliedTeamCategoryCode(data.teamCategoryCode ?? filters.teamCategoryCode);
      setCycles(data.cycles ?? []);
      setProjects(data.filters?.projects ?? []);
      setTeams(data.filters?.teams ?? []);
      setForemen(data.filters?.foremen ?? []);
      setSupervisors(data.filters?.supervisors ?? []);
      setCycleWeeks(data.cycleWeeks ?? []);
      setTeamRows(data.teamsProduction ?? []);
      setTeamRowsByWeek(data.teamsProductionByWeek ?? {});
      setTeamForemanRows(data.teamForemen ?? []);
      setTeamForemanRowsByWeek(data.teamForemenByWeek ?? {});
      setSupervisorRows(data.supervisorsProduction ?? []);
      setSupervisorRowsByWeek(data.supervisorsProductionByWeek ?? {});
      if (nextCycleStart && !filters.cycleStart) {
        suppressNextAutoLoadRef.current = true;
        setFilters((current) => current.cycleStart ? current : { ...current, cycleStart: nextCycleStart });
        setDraftFilters((current) => current.cycleStart ? current : { ...current, cycleStart: nextCycleStart });
      }
      setErrorMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Dashboard Equipes.";
      await logError("Falha ao carregar Dashboard Equipes", error, {
        cycleStart: filters.cycleStart || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      });
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [filters, logError, session?.accessToken]);

  useEffect(() => {
    if (suppressNextAutoLoadRef.current) {
      suppressNextAutoLoadRef.current = false;
      return;
    }
    void load();
  }, [load]);

  // O tipo operacional passa pelo botao `Filtrar`, como os demais filtros da tela.
  // O que ele NAO pode fazer e carregar a selecao anterior junto: ciclos, projetos,
  // equipes, encarregados e supervisores saem das ordens da operacao, entao um
  // `teamId` tecnico continuaria no estado e seria enviado numa consulta comercial --
  // o select ja nao mostraria a opcao, mas o valor iria na requisicao. Por isso a
  // troca limpa esses campos no proprio rascunho.
  const changeTeamCategoryCode = useCallback((teamCategoryCode: string) => {
    setDraftFilters((current) => ({
      ...current,
      teamCategoryCode,
      cycleStart: "",
      project: "",
      teamId: "",
      foreman: "",
      supervisorId: "",
    }));
  }, []);

  return {
    filters,
    draftFilters,
    setDraftFilters,
    applyFilters: () => setFilters({ ...draftFilters }),
    changeTeamCategoryCode,
    reload: load,
    teamCategories,
    appliedTeamCategoryCode,
    cycles,
    projects,
    teams,
    foremen,
    supervisors,
    cycleWeeks,
    teamRows,
    teamRowsByWeek,
    teamForemanRows,
    teamForemanRowsByWeek,
    supervisorRows,
    supervisorRowsByWeek,
    isLoading,
    errorMessage,
  };
}
