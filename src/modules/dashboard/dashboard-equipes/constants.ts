export const DASHBOARD_TEAMS_ENDPOINT = "/api/dashboard-equipes";

// Padrao TECNICA: e a operacao que o dashboard sempre mostrou, entao abrir a tela
// sem escolher nada continua entregando exatamente o mesmo recorte de antes.
export const DEFAULT_TEAM_CATEGORY_CODE = "TECNICA";

export const EMPTY_DASHBOARD_TEAMS_FILTERS = {
  teamCategoryCode: DEFAULT_TEAM_CATEGORY_CODE,
  cycleStart: "",
  startDate: "",
  endDate: "",
  project: "",
  teamId: "",
  foreman: "",
  supervisorId: "",
} as const;
