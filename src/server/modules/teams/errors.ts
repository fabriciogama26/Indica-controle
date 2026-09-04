type DbErrorShape = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

function normalizeDbErrorText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isMissingFunctionError(error: unknown, functionName: string) {
  const rawMessage = normalizeDbErrorText((error as DbErrorShape | null)?.message);
  return rawMessage.includes("function") && rawMessage.includes(functionName.toLowerCase());
}

function isTeamDuplicateCombinationError(rawMessage: unknown) {
  const message = normalizeDbErrorText(rawMessage);
  if (!message.includes("duplicate key")) {
    return false;
  }

  return (
    message.includes("teams_tenant_foreman_name_plate_key")
    || message.includes("teams_tenant_id_name_key")
    || message.includes("teams_tenant_id_vehicle_plate_key")
  );
}

export function mapTeamDbError(error: unknown, fallbackMessage: string) {
  const dbError = (error ?? {}) as DbErrorShape;
  const message = normalizeDbErrorText(dbError.message);
  const details = normalizeDbErrorText(dbError.details);
  const hint = normalizeDbErrorText(dbError.hint);
  const combined = `${message} ${details} ${hint}`.trim();

  if (isTeamDuplicateCombinationError(combined) || combined.includes("duplicate_team_combination")) {
    return {
      status: 409,
      message: "Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual.",
      reason: "DUPLICATE_TEAM_COMBINATION",
    } as const;
  }

  if (combined.includes("teams_service_center_tenant_fk")) {
    return {
      status: 422,
      message: "Base invalida para o tenant atual.",
      reason: "INVALID_SERVICE_CENTER",
    } as const;
  }

  if (combined.includes("teams_team_type_tenant_fk")) {
    return {
      status: 422,
      message: "Tipo de equipe invalido para o tenant atual.",
      reason: "INVALID_TEAM_TYPE",
    } as const;
  }

  if (combined.includes("teams_team_category_tenant_fk") || combined.includes("invalid_team_category")) {
    return {
      status: 422,
      message: "Tipo de equipe invalido para o tenant atual.",
      reason: "INVALID_TEAM_CATEGORY",
    } as const;
  }

  if (combined.includes("teams_foreman_person_tenant_fk")) {
    return {
      status: 422,
      message: "Encarregado invalido para o tenant atual.",
      reason: "INVALID_FOREMAN",
    } as const;
  }

  if (combined.includes("teams_supervisor_person_tenant_fk") || combined.includes("invalid_supervisor")) {
    return {
      status: 422,
      message: "Supervisor invalido para o tenant atual.",
      reason: "INVALID_SUPERVISOR",
    } as const;
  }

  if (combined.includes("invalid_stock_center")) {
    return {
      status: 422,
      message: "Centro de estoque proprio invalido para a equipe.",
      reason: "INVALID_STOCK_CENTER",
    } as const;
  }

  if (
    combined.includes("stock_center_already_linked")
    || combined.includes("idx_teams_unique_stock_center")
  ) {
    return {
      status: 409,
      message: "Este centro de estoque proprio ja esta vinculado a outra equipe.",
      reason: "STOCK_CENTER_ALREADY_LINKED",
    } as const;
  }

  if (
    combined.includes("chk_teams_name_not_blank")
    || combined.includes("chk_teams_vehicle_plate_not_blank")
    || combined.includes("null value in column \"name\"")
    || combined.includes("null value in column \"vehicle_plate\"")
    || combined.includes("null value in column \"service_center_id\"")
    || combined.includes("null value in column \"team_type_id\"")
    || combined.includes("null value in column \"team_category_id\"")
  ) {
    return {
      status: 400,
      message: "Preencha todos os campos obrigatorios da equipe.",
      reason: "MISSING_REQUIRED_FIELDS",
    } as const;
  }

  if (combined.includes("save_team_record") && combined.includes("function")) {
    return {
      status: 500,
      message: "RPC save_team_record indisponivel no banco. Aplique a migration 077_create_admin_write_rpcs.sql.",
      reason: "RPC_MISSING",
    } as const;
  }

  if (combined.includes("set_team_record_status") && combined.includes("function")) {
    return {
      status: 500,
      message: "RPC set_team_record_status indisponivel no banco. Aplique a migration 077_create_admin_write_rpcs.sql.",
      reason: "RPC_MISSING",
    } as const;
  }

  const detailsMessage = [dbError.message, dbError.hint, dbError.details]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join(" | ");

  return {
    status: 500,
    message: detailsMessage ? `${fallbackMessage} ${detailsMessage}` : fallbackMessage,
    reason: null,
  } as const;
}
