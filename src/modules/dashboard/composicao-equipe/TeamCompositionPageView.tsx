"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { useExportCooldown } from "@/hooks/useExportCooldown";
import { usePagination } from "@/hooks/usePagination";
import { notifyTeamCompositionUpdated } from "@/lib/events/teamComposition";
import styles from "./TeamCompositionPageView.module.css";
import { downloadCsvFile, escapeCsvValue } from "@/lib/utils/csv";
import { formatDate, formatDateTime } from "@/lib/utils/formatters";

type ProjectOption = {
  id: string;
  code: string;
  serviceCenter: string;
};

type TeamOption = {
  id: string;
  name: string;
  vehiclePlate: string;
  serviceCenterName: string;
  foremanId: string;
  foremanName: string;
  foremanPhone: string | null;
};

type PersonOption = {
  id: string;
  name: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  jobTitleName: string;
};

type CompositionMember = {
  id?: string;
  personId: string;
  name: string;
  matriculation: string | null;
  cpf: string | null;
  phone: string | null;
  jobTitleName: string | null;
  isPresent: boolean;
  sortOrder?: number;
};

type WorkStatus = "WORKING" | "NOT_WORKING";
type WorkStatusFilter = "" | WorkStatus;

type CompositionItem = {
  id: string;
  compositionDate: string;
  projectId: string | null;
  projectIds?: string[];
  projects?: ProjectOption[];
  teamId: string;
  projectCode: string;
  projectServiceCenter: string;
  teamName: string;
  vehiclePlate: string;
  foremanName: string;
  workStatus: WorkStatus;
  sector: string;
  yard: string;
  startTime: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
  updatedByName: string;
  members: CompositionMember[];
};

type MetaResponse = {
  projects?: ProjectOption[];
  teams?: TeamOption[];
  people?: PersonOption[];
  message?: string;
};

type ListResponse = {
  compositions?: CompositionItem[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type DailyCoverageItem = {
  teamId: string;
  isCompleted: boolean;
  workStatus: WorkStatus | null;
};

type DailyCoverageResponse = {
  coverageDate?: string;
  coverage?: DailyCoverageItem[];
  summary?: {
    total: number;
    completed: number;
    pending: number;
    notWorking: number;
  };
  message?: string;
};

type SaveResponse = {
  success?: boolean;
  message?: string;
  composition?: CompositionItem | null;
  updatedAt?: string | null;
};

type HistoryEntry = {
  id: string;
  changeType: "UPDATE" | "CANCEL" | "ACTIVATE";
  reason: string | null;
  changes: Record<string, { from: string | null; to: string | null }>;
  createdAt: string;
  createdByName: string;
};

type HistoryResponse = {
  history?: HistoryEntry[];
  pagination?: { page: number; pageSize: number; total: number };
  message?: string;
};

type FormState = {
  id: string | null;
  expectedUpdatedAt: string | null;
  compositionDate: string;
  projectCode: string;
  projectIds: string[];
  teamId: string;
  workStatus: WorkStatus;
  sector: string;
  yard: string;
  startTime: string;
  notes: string;
  personSearch: string;
  members: CompositionMember[];
};

type FilterState = {
  startDate: string;
  endDate: string;
  projectCode: string;
  teamId: string;
  workStatus: WorkStatusFilter;
};

const PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 100;
const HISTORY_PAGE_SIZE = 5;

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthRange(today: string) {
  const year = today.slice(0, 4);
  const month = today.slice(5, 7);
  const end = new Date(Number(year), Number(month), 0).getDate();
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(end).padStart(2, "0")}`,
  };
}

function createInitialForm(today: string): FormState {
  return {
    id: null,
    expectedUpdatedAt: null,
    compositionDate: today,
    projectCode: "",
    projectIds: [],
    teamId: "",
    workStatus: "WORKING",
    sector: "OBRA",
    yard: "",
    startTime: "07:30",
    notes: "",
    personSearch: "",
    members: [],
  };
}

function buildQuery(filters: FilterState, projectId: string | null, page: number, pageSize = PAGE_SIZE) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (projectId) params.set("projectId", projectId);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.workStatus) params.set("workStatus", filters.workStatus);
  return params.toString();
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLookupKey(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeMatriculation(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function isForemanRole(value: unknown) {
  return normalizeLookupKey(value).includes("ENCARREGADO");
}

function findDuplicateMemberMatriculation(members: CompositionMember[]) {
  const seen = new Map<string, string>();
  for (const member of members) {
    const matriculation = normalizeMatriculation(member.matriculation);
    if (!matriculation) {
      continue;
    }
    const previousName = seen.get(matriculation);
    if (previousName) {
      return { matriculation, names: [previousName, member.name] };
    }
    seen.set(matriculation, member.name);
  }
  return null;
}

function countForemen(members: CompositionMember[]) {
  return members.filter((member) => isForemanRole(member.jobTitleName)).length;
}

function personOptionLabel(person: PersonOption | CompositionMember) {
  const matriculation = person.matriculation ? `${person.matriculation} - ` : "";
  return `${matriculation}${person.name}`;
}

function teamOptionLabel(team: TeamOption) {
  const teamName = normalizeText(team.name);
  const foremanName = normalizeText(team.foremanName);
  return foremanName && foremanName !== "Nao identificado" ? `${teamName} / ${foremanName}` : teamName;
}

function workStatusLabel(value: WorkStatus) {
  return value === "NOT_WORKING" ? "Nao atuou" : "Atuando";
}

function formatOperationalDate(value: string) {
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${String(parsed.getDate()).padStart(2, "0")}/${months[parsed.getMonth()]}`;
}

function formatOperationalTime(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (/^\d{2}:\d{2}$/.test(normalized)) return `${normalized}:00`;
  return normalized;
}

function onlyDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function formatCpf(value: string | null | undefined) {
  const digits = onlyDigits(value);
  if (!digits) return "-";
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatCsvPhone(value: string | null | undefined) {
  return onlyDigits(value) || normalizeText(value);
}

function formatOptional(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized || "-";
}

function getCompositionForemanPhone(composition: CompositionItem) {
  return composition.members.find((member) => isForemanRole(member.jobTitleName))?.phone ?? null;
}

function getCompositionMemberPhone(composition: CompositionItem, member: CompositionMember) {
  return getCompositionForemanPhone(composition) ?? member.phone;
}

function getFormForemanPhone(team: TeamOption | null, members: CompositionMember[]) {
  return team?.foremanPhone ?? members.find((member) => isForemanRole(member.jobTitleName))?.phone ?? null;
}

function buildVisibleCsv(compositions: CompositionItem[]) {
  const header = [
    "Data",
    "Projetos",
    "Equipe",
    "Situacao",
    "Setor",
    "Integrantes",
    "Encarregado",
    "Patio",
    "Placa",
    "Hora inicial",
    "Observacoes",
  ];
  const rows = compositions.map((composition) => [
    formatDate(composition.compositionDate),
    composition.projectCode,
    composition.teamName,
    workStatusLabel(composition.workStatus),
    composition.sector,
    composition.members.length,
    composition.foremanName,
    composition.yard,
    composition.vehiclePlate,
    composition.startTime,
    composition.notes,
  ]);
  return `\uFEFF${[header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";")).join("\n")}`;
}

function buildDetailedCsv(compositions: CompositionItem[]) {
  const header = [
    "Data",
    "PROJETOS",
    "Situacao",
    "Setor",
    "Matrícula",
    "Colaborador",
    "Função",
    "CPF",
    "TELEFONE",
    "Pátio",
    "Placa",
    "Hora inicial",
    "Presente",
  ];
  const rows = compositions.flatMap((composition) =>
    composition.members.map((member) => [
      formatOperationalDate(composition.compositionDate),
      composition.projectCode,
      workStatusLabel(composition.workStatus),
      composition.sector,
      member.matriculation ?? "",
      member.name,
      member.jobTitleName ?? "",
      formatCpf(member.cpf),
      formatCsvPhone(getCompositionMemberPhone(composition, member)),
      composition.yard,
      composition.vehiclePlate,
      formatOperationalTime(composition.startTime),
      member.isPresent ? "Sim" : "Nao",
    ]),
  );

  return `\uFEFF${[header, ...rows].map((line) => line.map((item) => escapeCsvValue(item)).join(";")).join("\n")}`;
}

function scrollDashboardContentToTop() {
  if (typeof window === "undefined") return;
  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function TeamCompositionPageView() {
  const { session } = useAuth();
  const router = useRouter();
  const logError = useErrorLogger("composicao-equipe");
  const exportCooldown = useExportCooldown();
  const today = useMemo(() => toIsoDate(new Date()), []);
  const initialFilters = useMemo<FilterState>(() => ({ ...monthRange(today), projectCode: "", teamId: "", workStatus: "" }), [today]);
  const [form, setForm] = useState<FormState>(() => createInitialForm(today));
  const [coverageDate, setCoverageDate] = useState(today);
  const [filterDraft, setFilterDraft] = useState<FilterState>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<FilterState>(initialFilters);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [compositions, setCompositions] = useState<CompositionItem[]>([]);
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [dailyCoverage, setDailyCoverage] = useState<DailyCoverageItem[]>([]);
  const [isLoadingCoverage, setIsLoadingCoverage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [detailComposition, setDetailComposition] = useState<CompositionItem | null>(null);
  const [historyComposition, setHistoryComposition] = useState<CompositionItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isNavigatingToMedicao, setIsNavigatingToMedicao] = useState(false);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const isEditing = Boolean(form.id);
  const projectByCode = useMemo(
    () => new Map(projects.map((project) => [normalizeLookupKey(project.code), project])),
    [projects],
  );
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const activeFilterProject = projectByCode.get(normalizeLookupKey(activeFilters.projectCode)) ?? null;
  const selectedTeam = teams.find((team) => team.id === form.teamId) ?? null;
  const selectedFormProjects = useMemo(
    () => form.projectIds.map((projectId) => projectById.get(projectId)).filter((project): project is ProjectOption => Boolean(project)),
    [form.projectIds, projectById],
  );
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const formForemanPhone = getFormForemanPhone(selectedTeam, form.members);
  const dailyCoverageByTeam = useMemo(
    () => new Map(dailyCoverage.map((item) => [item.teamId, item])),
    [dailyCoverage],
  );
  const orderedCoverageTeams = useMemo(
    () => [...teams].sort((left, right) => {
      const leftCompleted = dailyCoverageByTeam.get(left.id)?.isCompleted ?? false;
      const rightCompleted = dailyCoverageByTeam.get(right.id)?.isCompleted ?? false;
      if (leftCompleted !== rightCompleted) {
        return leftCompleted ? 1 : -1;
      }
      return left.name.localeCompare(right.name, "pt-BR");
    }),
    [dailyCoverageByTeam, teams],
  );
  const coverageSummary = useMemo(() => {
    const items = teams.map((team) => dailyCoverageByTeam.get(team.id));
    return {
      total: teams.length,
      completed: items.filter((item) => item?.isCompleted).length,
      pending: items.filter((item) => !item?.isCompleted).length,
      notWorking: items.filter((item) => item?.workStatus === "NOT_WORKING").length,
    };
  }, [dailyCoverageByTeam, teams]);

  const loadMeta = useCallback(async () => {
    if (!session?.accessToken) return;
    setIsLoadingMeta(true);
    try {
      const response = await fetch("/api/composicao-equipe/meta", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await response.json().catch(() => ({}))) as MetaResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar metadados." });
        return;
      }
      setProjects(data.projects ?? []);
      setTeams(data.teams ?? []);
      setPeople(data.people ?? []);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao carregar metadados." });
      await logError("Falha ao carregar metadados da composicao de equipe.", error);
    } finally {
      setIsLoadingMeta(false);
    }
  }, [logError, session?.accessToken]);

  const loadCompositions = useCallback(
    async (targetPage: number, filters: FilterState) => {
      if (!session?.accessToken) return [] as CompositionItem[];
      setIsLoadingList(true);
      try {
        const project = projectByCode.get(normalizeLookupKey(filters.projectCode)) ?? null;
        const query = buildQuery(filters, project?.id ?? null, targetPage);
        const response = await fetch(`/api/composicao-equipe?${query}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        const data = (await response.json().catch(() => ({}))) as ListResponse;
        if (!response.ok) {
          setCompositions([]);
          setTotal(0);
          setFeedback({ type: "error", message: data.message ?? "Falha ao listar composicoes." });
          return [] as CompositionItem[];
        }
        const nextItems = data.compositions ?? [];
        setCompositions(nextItems);
        setTotal(data.pagination?.total ?? 0);
        return nextItems;
      } catch (error) {
        setCompositions([]);
        setTotal(0);
        setFeedback({ type: "error", message: "Falha ao listar composicoes." });
        await logError("Falha ao listar composicoes de equipe.", error, { targetPage, filters });
        return [] as CompositionItem[];
      } finally {
        setIsLoadingList(false);
      }
    },
    [logError, projectByCode, session?.accessToken, setTotal],
  );

  const loadDailyCoverage = useCallback(async (coverageDate: string) => {
    if (!session?.accessToken || !coverageDate) {
      setDailyCoverage([]);
      return;
    }
    setIsLoadingCoverage(true);
    try {
      const params = new URLSearchParams({ coverageDate });
      const response = await fetch(`/api/composicao-equipe?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await response.json().catch(() => ({}))) as DailyCoverageResponse;
      if (!response.ok) {
        setDailyCoverage([]);
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar acompanhamento diario." });
        return;
      }
      setDailyCoverage(data.coverage ?? []);
    } catch (error) {
      setDailyCoverage([]);
      setFeedback({ type: "error", message: "Falha ao carregar acompanhamento diario." });
      await logError("Falha ao carregar acompanhamento diario da composicao.", error, { coverageDate });
    } finally {
      setIsLoadingCoverage(false);
    }
  }, [logError, session?.accessToken]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadCompositions(page, activeFilters);
  }, [activeFilters, loadCompositions, page]);

  useEffect(() => {
    void loadDailyCoverage(coverageDate);
  }, [coverageDate, loadDailyCoverage]);

  function resetForm() {
    setForm(createInitialForm(today));
  }

  function updateFilterField(field: keyof FilterState, value: string) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function applyFilters() {
    const normalizedProject = normalizeText(filterDraft.projectCode);
    if (normalizedProject && !projectByCode.has(normalizeLookupKey(normalizedProject))) {
      setFeedback({ type: "error", message: "Selecione um Projeto valido para filtrar." });
      return;
    }
    setPage(1);
    setActiveFilters(filterDraft);
    setFeedback(null);
  }

  function clearFilters() {
    setFilterDraft(initialFilters);
    setActiveFilters(initialFilters);
    setPage(1);
    setFeedback(null);
  }

  function applyTeam(teamId: string) {
    const nextTeam = teams.find((team) => team.id === teamId) ?? null;
    setForm((current) => {
      if (current.workStatus === "NOT_WORKING") {
        const foreman = nextTeam?.foremanId ? peopleById.get(nextTeam.foremanId) : null;
        return {
          ...current,
          teamId,
          yard: nextTeam?.serviceCenterName ?? "",
          members: foreman && nextTeam
            ? [{
                personId: foreman.id,
                name: foreman.name,
                matriculation: foreman.matriculation,
                cpf: foreman.cpf,
                phone: nextTeam.foremanPhone,
                jobTitleName: foreman.jobTitleName,
                isPresent: false,
              }]
            : [],
        };
      }
      if (!nextTeam?.foremanId || current.members.some((member) => member.personId === nextTeam.foremanId)) {
        return {
          ...current,
          teamId,
          yard: nextTeam?.serviceCenterName ?? "",
          members: current.members.map((member) => ({ ...member, phone: nextTeam?.foremanPhone ?? null })),
        };
      }
      const foreman = peopleById.get(nextTeam.foremanId);
      if (!foreman) {
        return {
          ...current,
          teamId,
          yard: nextTeam.serviceCenterName,
          members: current.members.map((member) => ({ ...member, phone: nextTeam.foremanPhone ?? null })),
        };
      }
      if (countForemen(current.members) > 0 && !current.members.some((member) => member.personId === foreman.id)) {
        setFeedback({
          type: "error",
          message: "A composicao nao pode conter mais de um encarregado. Remova o encarregado atual antes de trocar/adicionar outro.",
        });
        return { ...current, teamId, yard: nextTeam.serviceCenterName };
      }
      return {
        ...current,
        teamId,
        yard: nextTeam.serviceCenterName,
        members: [
          {
            personId: foreman.id,
            name: foreman.name,
            matriculation: foreman.matriculation,
            cpf: foreman.cpf,
            phone: nextTeam.foremanPhone,
            jobTitleName: foreman.jobTitleName,
            isPresent: true,
          },
          ...current.members.map((member) => ({ ...member, phone: nextTeam.foremanPhone ?? null })),
        ],
      };
    });
  }

  function selectPendingTeam(teamId: string) {
    setForm(createInitialForm(coverageDate));
    setFeedback(null);
    applyTeam(teamId);
  }

  function applyWorkStatus(workStatus: WorkStatus) {
    setForm((current) => {
      if (workStatus === "WORKING") {
        return {
          ...current,
          workStatus,
          members: current.members.map((member) => (
            member.personId === selectedTeam?.foremanId ? { ...member, isPresent: true } : member
          )),
        };
      }
      const foreman = selectedTeam?.foremanId ? peopleById.get(selectedTeam.foremanId) : null;
      return {
        ...current,
        workStatus,
        projectCode: "",
        projectIds: [],
        personSearch: "",
        members: foreman && selectedTeam
          ? [{
              personId: foreman.id,
              name: foreman.name,
              matriculation: foreman.matriculation,
              cpf: foreman.cpf,
              phone: selectedTeam.foremanPhone,
              jobTitleName: foreman.jobTitleName,
              isPresent: false,
            }]
          : [],
      };
    });
    setFeedback(null);
  }

  function findProjectBySearch(value: string) {
    const normalized = normalizeLookupKey(value);
    if (!normalized) return null;
    return projectByCode.get(normalized) ?? null;
  }

  function addProject() {
    if (form.workStatus === "NOT_WORKING") {
      setFeedback({ type: "error", message: "Equipe que nao atuou nao deve possuir projeto." });
      return;
    }
    const project = findProjectBySearch(form.projectCode);
    if (!project) {
      setFeedback({ type: "error", message: "Selecione um Projeto valido para adicionar." });
      return;
    }
    if (form.projectIds.includes(project.id)) {
      setFeedback({ type: "error", message: "Este Projeto ja esta na composicao." });
      return;
    }
    setForm((current) => ({
      ...current,
      projectCode: "",
      projectIds: [...current.projectIds, project.id],
    }));
    setFeedback(null);
  }

  function removeProject(projectId: string) {
    setForm((current) => ({
      ...current,
      projectIds: current.projectIds.filter((item) => item !== projectId),
    }));
  }

  function findPersonBySearch(value: string) {
    const normalized = normalizeLookupKey(value);
    if (!normalized) return null;
    return people.find((person) => {
      const label = normalizeLookupKey(personOptionLabel(person));
      const name = normalizeLookupKey(person.name);
      const matriculation = normalizeLookupKey(person.matriculation ?? "");
      return label === normalized || name === normalized || matriculation === normalized;
    }) ?? null;
  }

  function addMember() {
    if (form.workStatus === "NOT_WORKING") {
      setFeedback({ type: "error", message: "Equipe que nao atuou deve manter somente o encarregado." });
      return;
    }
    const person = findPersonBySearch(form.personSearch);
    if (!person) {
      setFeedback({ type: "error", message: "Selecione uma pessoa valida para adicionar." });
      return;
    }
    if (form.members.some((member) => member.personId === person.id)) {
      setFeedback({ type: "error", message: "Esta pessoa ja esta na composicao." });
      return;
    }
    const personMatriculation = normalizeMatriculation(person.matriculation);
    if (personMatriculation && form.members.some((member) => normalizeMatriculation(member.matriculation) === personMatriculation)) {
      setFeedback({ type: "error", message: `Matricula ${personMatriculation} ja incluida na composicao.` });
      return;
    }
    if (isForemanRole(person.jobTitleName) && countForemen(form.members) > 0) {
      setFeedback({ type: "error", message: "A composicao nao pode conter mais de um encarregado." });
      return;
    }
    setForm((current) => ({
      ...current,
      personSearch: "",
      members: [
        ...current.members,
        {
          personId: person.id,
          name: person.name,
          matriculation: person.matriculation,
          cpf: person.cpf,
          phone: selectedTeam?.foremanPhone ?? person.phone,
          jobTitleName: person.jobTitleName,
          isPresent: true,
        },
      ],
    }));
    setFeedback(null);
  }

  function removeMember(personId: string) {
    setForm((current) => ({ ...current, members: current.members.filter((member) => member.personId !== personId) }));
  }

  function toggleMemberPresence(personId: string, isPresent: boolean) {
    setForm((current) => ({
      ...current,
      members: current.members.map((member) => (member.personId === personId ? { ...member, isPresent } : member)),
    }));
  }

  function startEdit(composition: CompositionItem) {
    setForm({
      id: composition.id,
      expectedUpdatedAt: composition.updatedAt,
      compositionDate: composition.compositionDate,
      projectCode: "",
      projectIds: composition.projectIds?.length
        ? composition.projectIds
        : composition.projectId
          ? [composition.projectId]
          : [],
      teamId: composition.teamId,
      workStatus: composition.workStatus,
      sector: composition.sector,
      yard: composition.yard,
      startTime: composition.startTime,
      notes: composition.notes,
      personSearch: "",
      members: composition.members,
    });
    setFeedback(null);
    scrollDashboardContentToTop();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar composicao." });
      return;
    }
    const selectedProjects = form.workStatus === "NOT_WORKING" ? [] : selectedFormProjects;
    const missingFields = [
      !form.compositionDate ? "Data" : "",
      form.workStatus === "WORKING" && selectedProjects.length === 0 ? "Ao menos um Projeto valido" : "",
      !form.teamId || !selectedTeam ? "Equipe valida" : "",
      !normalizeText(form.sector) ? "Setor" : "",
      !form.startTime ? "Hora inicial" : "",
      selectedTeam && !normalizeText(selectedTeam.serviceCenterName || form.yard) ? "Patio/Centro de Servico da equipe" : "",
      !form.members.length ? "Ao menos uma pessoa" : "",
    ].filter(Boolean);

    if (missingFields.length) {
      setFeedback({ type: "error", message: `Campos obrigatorios pendentes: ${missingFields.join(", ")}.` });
      return;
    }

    if ((form.workStatus === "WORKING" && selectedProjects.length !== form.projectIds.length) || !selectedTeam) {
      setFeedback({ type: "error", message: "Projeto ou equipe invalida para salvar." });
      return;
    }

    const duplicatedMatriculation = findDuplicateMemberMatriculation(form.members);
    if (duplicatedMatriculation) {
      setFeedback({
        type: "error",
        message: `Matricula duplicada na composicao: ${duplicatedMatriculation.matriculation} (${duplicatedMatriculation.names.join(" / ")}).`,
      });
      return;
    }

    if (countForemen(form.members) > 1) {
      setFeedback({ type: "error", message: "A composicao nao pode conter mais de um encarregado." });
      return;
    }

    if (
      form.workStatus === "NOT_WORKING"
      && (
        form.members.length !== 1
        || form.members[0]?.personId !== selectedTeam.foremanId
        || form.members[0]?.isPresent !== false
      )
    ) {
      setFeedback({
        type: "error",
        message: "Equipe que nao atuou deve possuir somente o encarregado da equipe, marcado como nao presente.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    const resolvedYard = selectedTeam.serviceCenterName || form.yard;
    try {
      const response = await fetch("/api/composicao-equipe", {
        method: form.id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          id: form.id,
          expectedUpdatedAt: form.expectedUpdatedAt,
          compositionDate: form.compositionDate,
          projectId: selectedProjects[0]?.id ?? null,
          projectIds: selectedProjects.map((project) => project.id),
          teamId: form.teamId,
          workStatus: form.workStatus,
          sector: form.sector,
          yard: resolvedYard,
          startTime: form.startTime,
          notes: form.notes,
          members: form.members.map((member) => ({ personId: member.personId, isPresent: member.isPresent })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok || !data.success) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar composicao." });
        return;
      }
      setFeedback({ type: "success", message: data.message ?? "Composicao salva com sucesso." });
      notifyTeamCompositionUpdated();
      resetForm();
      setPage(1);
      await Promise.all([
        loadCompositions(1, activeFilters),
        loadDailyCoverage(coverageDate),
      ]);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao salvar composicao." });
      await logError("Falha ao salvar composicao de equipe.", error, { form });
    } finally {
      setIsSaving(false);
    }
  }

  async function loadHistory(composition: CompositionItem, targetPage: number) {
    if (!session?.accessToken) return;
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.set("historyCompositionId", composition.id);
      params.set("historyPage", String(targetPage));
      params.set("historyPageSize", String(HISTORY_PAGE_SIZE));
      const response = await fetch(`/api/composicao-equipe?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await response.json().catch(() => ({}))) as HistoryResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar historico." });
        return;
      }
      setHistoryEntries(data.history ?? []);
      setHistoryPage(data.pagination?.page ?? targetPage);
      setHistoryTotal(data.pagination?.total ?? 0);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao carregar historico." });
      await logError("Falha ao carregar historico da composicao.", error, { compositionId: composition.id });
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function openHistory(composition: CompositionItem) {
    setHistoryComposition(composition);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadHistory(composition, 1);
  }

  function closeHistory() {
    setHistoryComposition(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
  }

  function openMeasurement(composition: CompositionItem) {
    const projectId = composition.projectId ?? composition.projectIds?.[0] ?? "";
    if (!projectId) {
      setFeedback({ type: "error", message: "Composicao sem projeto nao permite iniciar medicao." });
      return;
    }

    const params = new URLSearchParams({
      projectId,
      teamId: composition.teamId,
      executionDate: composition.compositionDate,
      compositionId: composition.id,
    });

    setIsNavigatingToMedicao(true);
    router.push(`/medicao?${params.toString()}`);
  }

  async function loadAllForExport() {
    const allItems: CompositionItem[] = [];
    let targetPage = 1;
    while (true) {
      const project = projectByCode.get(normalizeLookupKey(activeFilters.projectCode)) ?? null;
      const query = buildQuery(activeFilters, project?.id ?? null, targetPage, EXPORT_PAGE_SIZE);
      const response = await fetch(`/api/composicao-equipe?${query}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session?.accessToken}` },
      });
      const data = (await response.json().catch(() => ({}))) as ListResponse;
      if (!response.ok) {
        throw new Error(data.message ?? "Falha ao exportar composicoes.");
      }
      allItems.push(...(data.compositions ?? []));
      const totalItems = data.pagination?.total ?? allItems.length;
      if (allItems.length >= totalItems || (data.compositions ?? []).length === 0) {
        break;
      }
      targetPage += 1;
    }
    return allItems;
  }

  async function exportListCsv() {
    if (!session?.accessToken || isExporting || exportCooldown.isCoolingDown) return;
    if (!exportCooldown.tryStart()) return;
    setIsExporting(true);
    try {
      const items = await loadAllForExport();
      downloadCsvFile(buildVisibleCsv(items), `composicao_equipe_lista_${today}.csv`);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar lista." });
      await logError("Falha ao exportar lista da composicao.", error);
    } finally {
      setIsExporting(false);
    }
  }

  async function exportDetailedCsv() {
    if (!session?.accessToken || isExporting || exportCooldown.isCoolingDown) return;
    if (!exportCooldown.tryStart()) return;
    setIsExporting(true);
    try {
      const items = await loadAllForExport();
      downloadCsvFile(buildDetailedCsv(items), `composicao_equipe_detalhes_${today}.csv`);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar detalhes." });
      await logError("Falha ao exportar detalhes da composicao.", error);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      <article className={styles.card}>
        <div className={styles.coverageHeader}>
          <div className={styles.coverageTitleBlock}>
            <h2 className={styles.cardTitle}>Composicoes das Equipes</h2>
            <label className={styles.coverageDateFilter}>
              <span>Data do acompanhamento</span>
              <input
                type="date"
                value={coverageDate}
                onChange={(event) => setCoverageDate(event.target.value || today)}
                required
              />
            </label>
          </div>
          <div className={styles.coverageSummary}>
            <span>Total: <strong>{coverageSummary.total}</strong></span>
            <span>Cadastradas: <strong>{coverageSummary.completed}</strong></span>
            <span>Pendentes: <strong>{coverageSummary.pending}</strong></span>
            <span>Nao atuaram: <strong>{coverageSummary.notWorking}</strong></span>
          </div>
        </div>
        {isLoadingCoverage || isLoadingMeta ? <p className={styles.coverageMessage}>Carregando equipes...</p> : null}
        {!isLoadingCoverage && !isLoadingMeta && orderedCoverageTeams.length === 0 ? (
          <p className={styles.coverageMessage}>Nenhuma equipe ativa encontrada.</p>
        ) : null}
        {!isLoadingCoverage && !isLoadingMeta && orderedCoverageTeams.length > 0 ? (
          <div className={styles.coverageGrid}>
            {orderedCoverageTeams.map((team) => {
              const coverage = dailyCoverageByTeam.get(team.id);
              const isCompleted = coverage?.isCompleted ?? false;
              const statusText = !isCompleted
                ? "Composicao pendente"
                : coverage?.workStatus === "NOT_WORKING"
                  ? "Nao atuou"
                  : "Composicao cadastrada";
              return (
                <button
                  key={team.id}
                  type="button"
                  className={`${styles.coverageCard} ${isCompleted ? styles.coverageCardCompleted : styles.coverageCardPending}`}
                  onClick={() => selectPendingTeam(team.id)}
                  disabled={isCompleted}
                  title={isCompleted ? statusText : "Selecionar equipe para cadastrar a composicao"}
                >
                  <strong>{team.name}</strong>
                  <span>{formatOptional(team.foremanName)}</span>
                  <small>{statusText}</small>
                </button>
              );
            })}
          </div>
        ) : null}
      </article>

      <form className={`${styles.card} ${isEditing ? styles.editingCard : ""}`} onSubmit={handleSubmit}>
        <h2 className={styles.cardTitle}>{isEditing ? "Editar Composicao de Equipe" : "Cadastro de Composicao de Equipe"}</h2>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Data <span className="requiredMark">*</span></span>
            <input type="date" value={form.compositionDate} onChange={(event) => setForm((current) => ({ ...current, compositionDate: event.target.value }))} required />
          </label>
          <section className={styles.projectPanel}>
            <div className={styles.projectAddGrid}>
              <label className={styles.field}>
                <span>Projeto {form.workStatus === "WORKING" ? <span className="requiredMark">*</span> : null}</span>
                <input
                  list="composicao-project-list"
                  value={form.projectCode}
                  onChange={(event) => setForm((current) => ({ ...current, projectCode: event.target.value }))}
                  placeholder={form.workStatus === "NOT_WORKING" ? "Nao exigido para equipe sem atuacao" : "Digite o SOB"}
                  disabled={form.workStatus === "NOT_WORKING"}
                />
              </label>
              <div className={styles.memberActions}>
                <button type="button" className={styles.secondaryButton} onClick={addProject} disabled={form.workStatus === "NOT_WORKING"}>Adicionar</button>
              </div>
            </div>
            <div className={styles.selectedProjectList}>
              {selectedFormProjects.length ? selectedFormProjects.map((project) => (
                <div key={project.id} className={styles.selectedProjectItem}>
                  <span>{project.code}</span>
                  <small>{formatOptional(project.serviceCenter)}</small>
                  <button type="button" className={styles.dangerButton} onClick={() => removeProject(project.id)} disabled={form.workStatus === "NOT_WORKING"}>Remover</button>
                </div>
              )) : (
                <p className={styles.tableHint}>{form.workStatus === "NOT_WORKING" ? "Sem projeto para equipe sem atuacao." : "Nenhum projeto adicionado."}</p>
              )}
            </div>
          </section>
          <label className={styles.field}>
            <span>Equipe <span className="requiredMark">*</span></span>
            <select value={form.teamId} onChange={(event) => applyTeam(event.target.value)} disabled={isLoadingMeta} required>
              <option value="" disabled>Selecione</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{teamOptionLabel(team)}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Setor <span className="requiredMark">*</span></span>
            <input value={form.sector} onChange={(event) => setForm((current) => ({ ...current, sector: event.target.value }))} required />
          </label>
          <label className={styles.field}>
            <span>Situacao da equipe <span className="requiredMark">*</span></span>
            <select value={form.workStatus} onChange={(event) => applyWorkStatus(event.target.value as WorkStatus)} required>
              <option value="WORKING">Atuando</option>
              <option value="NOT_WORKING">Nao atuou</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Hora inicial <span className="requiredMark">*</span></span>
            <input type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} required />
          </label>
          <label className={styles.field}>
            <span>Patio</span>
            <input
              value={selectedTeam?.serviceCenterName || form.yard}
              onChange={(event) => setForm((current) => ({ ...current, yard: event.target.value }))}
              disabled={Boolean(selectedTeam?.serviceCenterName)}
              placeholder={selectedTeam ? "Informe o patio/centro de servico" : "Selecione a equipe"}
            />
          </label>
          <label className={styles.field}>
            <span>Placa</span>
            <input value={selectedTeam?.vehiclePlate ?? ""} disabled />
          </label>
          <label className={styles.field}>
            <span>Encarregado</span>
            <input value={selectedTeam?.foremanName ?? ""} disabled />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Observacoes</span>
            <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={3} />
          </label>

          <section className={styles.memberPanel}>
            <div className={styles.tableHeader}>
              <h3 className={styles.cardTitle}>Integrantes</h3>
              <span className={styles.tableHint}>{form.members.length} pessoa(s) na composicao</span>
            </div>
            <div className={styles.memberAddGrid}>
              <label className={styles.field}>
                <span>Pessoa</span>
                <input list="composicao-people-list" value={form.personSearch} onChange={(event) => setForm((current) => ({ ...current, personSearch: event.target.value }))} placeholder="Digite matricula ou nome" disabled={form.workStatus === "NOT_WORKING"} />
              </label>
              <div className={styles.memberActions}>
                <button type="button" className={styles.secondaryButton} onClick={addMember} disabled={form.workStatus === "NOT_WORKING"}>Adicionar</button>
              </div>
            </div>
            {form.workStatus === "NOT_WORKING" ? (
              <p className={styles.statusHint}>Equipe sem atuacao: somente o encarregado e mantido, com presenca marcada como Nao.</p>
            ) : null}
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead><tr><th>Matricula</th><th>Colaborador</th><th>Funcao</th><th>CPF</th><th>Telefone</th><th>Presente</th><th>Acoes</th></tr></thead>
                <tbody>
                  {form.members.length ? form.members.map((member) => (
                    <tr key={member.personId}>
                      <td>{member.matriculation ?? "-"}</td>
                      <td>{member.name}</td>
                      <td>{member.jobTitleName ?? "-"}</td>
                      <td>{formatCpf(member.cpf)}</td>
                      <td>{formatOptional(formForemanPhone ?? member.phone)}</td>
                      <td>
                        <label className={styles.presenceToggle}>
                          <input type="checkbox" checked={member.isPresent} onChange={(event) => toggleMemberPresence(member.personId, event.target.checked)} disabled={form.workStatus === "NOT_WORKING"} />
                          {member.isPresent ? "Sim" : "Nao"}
                        </label>
                      </td>
                      <td>
                        <button type="button" className={styles.dangerButton} onClick={() => removeMember(member.personId)} disabled={form.workStatus === "NOT_WORKING"}>Remover</button>
                      </td>
                    </tr>
                  )) : <tr><td colSpan={7} className={styles.emptyRow}>Nenhuma pessoa adicionada.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <div className={`${styles.actions} ${styles.formActions}`}>
            <button type="submit" className={styles.primaryButton} disabled={isSaving || isLoadingMeta}>{isSaving ? "Salvando..." : "Salvar composicao"}</button>
            {isEditing ? <button type="button" className={styles.ghostButton} onClick={resetForm} disabled={isSaving}>Cancelar edicao</button> : null}
          </div>
        </div>
      </form>

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros</h3>
        <div className={styles.filterGrid}>
          <label className={styles.field}><span>Data inicial</span><input type="date" value={filterDraft.startDate} onChange={(event) => updateFilterField("startDate", event.target.value)} /></label>
          <label className={styles.field}><span>Data final</span><input type="date" value={filterDraft.endDate} onChange={(event) => updateFilterField("endDate", event.target.value)} /></label>
          <label className={styles.field}><span>Projeto</span><input list="composicao-project-list" value={filterDraft.projectCode} onChange={(event) => updateFilterField("projectCode", event.target.value)} placeholder="Todos" /></label>
          <label className={styles.field}><span>Equipe</span><select value={filterDraft.teamId} onChange={(event) => updateFilterField("teamId", event.target.value)}><option value="">Todas</option>{teams.map((team) => <option key={team.id} value={team.id}>{teamOptionLabel(team)}</option>)}</select></label>
          <label className={styles.field}><span>Situacao da equipe</span><select value={filterDraft.workStatus} onChange={(event) => updateFilterField("workStatus", event.target.value as WorkStatusFilter)}><option value="">Todas</option><option value="WORKING">Atuando</option><option value="NOT_WORKING">Nao atuou</option></select></label>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={applyFilters} disabled={isLoadingList}>Aplicar</button>
          <button type="button" className={styles.ghostButton} onClick={clearFilters} disabled={isLoadingList}>Limpar</button>
        </div>
      </article>

      {feedback ? <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div> : null}

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Lista de Composicoes</h3>
            <span className={styles.tableHint}>Projeto filtrado: {activeFilterProject?.code ?? "Todos"}</span>
          </div>
          <div className={styles.actions}>
            <CsvExportButton
              onClick={() => void exportListCsv()}
              disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
              isLoading={isExporting}
              className={styles.ghostButton}
              idleLabel="Exportar lista (CSV)"
            />
            <CsvExportButton
              onClick={() => void exportDetailedCsv()}
              disabled={isExporting || isLoadingList || exportCooldown.isCoolingDown}
              isLoading={isExporting}
              className={styles.ghostButton}
              idleLabel="Detalhes (CSV)"
              loadingLabel="Gerando..."
              showProgressModal={false}
            />
          </div>
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr><th>Data</th><th>Projetos</th><th>Equipe</th><th>Situacao</th><th>Setor</th><th>Integrantes</th><th>Encarregado</th><th>Patio</th><th>Placa</th><th>Hora inicial</th><th>Acoes</th></tr>
            </thead>
            <tbody>
              {compositions.length ? compositions.map((composition) => (
                <tr key={composition.id}>
                  <td>{formatDate(composition.compositionDate)}</td>
                  <td>{formatOptional(composition.projectCode)}</td>
                  <td>{composition.teamName}</td>
                  <td>{workStatusLabel(composition.workStatus)}</td>
                  <td>{composition.sector}</td>
                  <td>{composition.members.length} pessoa(s)</td>
                  <td>{formatOptional(composition.foremanName)}</td>
                  <td>{formatOptional(composition.yard)}</td>
                  <td>{formatOptional(composition.vehiclePlate)}</td>
                  <td>{composition.startTime}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.tableActions}>
                      <button type="button" className={`${styles.actionButton} ${styles.actionView}`} onClick={() => setDetailComposition(composition)} title="Detalhes" aria-label="Detalhes">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.8-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.8 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" /></svg>
                      </button>
                      <button type="button" className={`${styles.actionButton} ${styles.actionEdit}`} onClick={() => startEdit(composition)} title="Editar" aria-label="Editar">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 20 4.5-1 9-9a1.75 1.75 0 0 0-2.5-2.5l-9 9L4 20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                      </button>
                      <button type="button" className={`${styles.actionButton} ${styles.actionHistory}`} onClick={() => void openHistory(composition)} title="Historico" aria-label="Historico">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.75 12a8.25 8.25 0 1 0 2.25-5.69M3.75 4.75v4h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 8.5v3.75l2.5 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionMeasure}`}
                        onClick={() => openMeasurement(composition)}
                        disabled={!composition.projectId && !composition.projectIds?.[0]}
                        title={composition.projectId || composition.projectIds?.[0] ? "Fazer medicao" : "Fazer medicao indisponivel sem projeto"}
                        aria-label="Fazer medicao"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5.5h8M9.5 3.75h5a1.5 1.5 0 0 1 1.5 1.5V7H8V5.25a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 6.5H5.75A1.75 1.75 0 0 0 4 8.25v10A1.75 1.75 0 0 0 5.75 20h12.5A1.75 1.75 0 0 0 20 18.25v-10a1.75 1.75 0 0 0-1.75-1.75H17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="m8 14 2.25 2.25L16 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={11} className={styles.emptyRow}>{isLoadingList ? "Carregando composicoes..." : "Nenhuma composicao encontrada."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((current) => Math.max(1, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={isLoadingList}
          className={styles.pagination}
          actionsClassName={styles.paginationActions}
          buttonClassName={styles.ghostButton}
        />
      </article>

      {detailComposition ? (
        <div className={styles.modalOverlay} onClick={() => setDetailComposition(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}><h4>Detalhes da Composicao</h4><p className={styles.modalSubtitle}>{formatOptional(detailComposition.projectCode)} | {detailComposition.teamName}</p></div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailComposition(null)}>Fechar</button>
            </header>
            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Data:</strong> {formatDate(detailComposition.compositionDate)}</div>
                <div><strong>Projetos:</strong> {formatOptional(detailComposition.projectCode)}</div>
                <div><strong>Centros de Servico:</strong> {formatOptional(detailComposition.projectServiceCenter)}</div>
                <div><strong>Equipe:</strong> {detailComposition.teamName}</div>
                <div><strong>Situacao:</strong> {workStatusLabel(detailComposition.workStatus)}</div>
                <div><strong>Encarregado:</strong> {formatOptional(detailComposition.foremanName)}</div>
                <div><strong>Placa:</strong> {formatOptional(detailComposition.vehiclePlate)}</div>
                <div><strong>Setor:</strong> {detailComposition.sector}</div>
                <div><strong>Patio:</strong> {formatOptional(detailComposition.yard)}</div>
                <div><strong>Hora inicial:</strong> {detailComposition.startTime}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailComposition.updatedAt)}</div>
                <div><strong>Atualizado por:</strong> {detailComposition.updatedByName}</div>
                <div className={styles.detailWide}><strong>Observacoes:</strong> {formatOptional(detailComposition.notes)}</div>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead><tr><th>Matricula</th><th>Colaborador</th><th>Funcao</th><th>CPF</th><th>Telefone</th><th>Presente</th></tr></thead>
                  <tbody>{detailComposition.members.map((member) => <tr key={member.personId}><td>{member.matriculation ?? "-"}</td><td>{member.name}</td><td>{member.jobTitleName ?? "-"}</td><td>{formatCpf(member.cpf)}</td><td>{formatOptional(getCompositionMemberPhone(detailComposition, member))}</td><td>{member.isPresent ? "Sim" : "Nao"}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyComposition ? (
        <div className={styles.modalOverlay} onClick={closeHistory}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}><h4>Historico da Composicao</h4><p className={styles.modalSubtitle}>{formatOptional(historyComposition.projectCode)} | {historyComposition.teamName}</p></div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistory}>Fechar</button>
            </header>
            <div className={styles.modalBody}>
              {isLoadingHistory ? <p>Carregando historico...</p> : null}
              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma alteracao registrada.</p> : null}
              {!isLoadingHistory && historyEntries.map((entry) => (
                <article key={entry.id} className={styles.historyCard}>
                  <header className={styles.historyCardHeader}><strong>Atualizacao</strong><span>{formatDateTime(entry.createdAt)} | {entry.createdByName}</span></header>
                  {entry.reason ? <p className={styles.historyReason}>Motivo: {entry.reason}</p> : null}
                  <div className={styles.historyChanges}>
                    {Object.entries(entry.changes).map(([field, change]) => <div key={field} className={styles.historyChangeItem}><strong>{field}</strong><span>De: {change.from ?? "-"}</span><span>Para: {change.to ?? "-"}</span></div>)}
                  </div>
                </article>
              ))}
              {historyTotal > 0 ? (
                <div className={styles.pagination}>
                  <span>Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyTotal}</span>
                  <div className={styles.paginationActions}>
                    <button type="button" className={styles.ghostButton} onClick={() => void loadHistory(historyComposition, Math.max(1, historyPage - 1))} disabled={historyPage <= 1 || isLoadingHistory}>Anterior</button>
                    <button type="button" className={styles.ghostButton} onClick={() => void loadHistory(historyComposition, Math.min(historyTotalPages, historyPage + 1))} disabled={historyPage >= historyTotalPages || isLoadingHistory}>Proxima</button>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}

      <datalist id="composicao-project-list">{projects.map((project) => <option key={project.id} value={project.code}>{project.serviceCenter}</option>)}</datalist>
      <datalist id="composicao-people-list">{people.map((person) => <option key={person.id} value={personOptionLabel(person)}>{person.jobTitleName}</option>)}</datalist>

      {isNavigatingToMedicao ? (
        <div className={styles.modalOverlay}>
          <article className={styles.loadingCard} role="status" aria-live="polite">
            <span className={styles.loadingSpinner} aria-hidden="true" />
            <p className={styles.loadingText}>Aguarde, carregando medicao...</p>
          </article>
        </div>
      ) : null}
    </section>
  );
}
