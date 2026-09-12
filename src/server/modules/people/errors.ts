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

export function isMatriculationNumericTypeMismatchError(error: unknown) {
  const dbError = (error ?? {}) as DbErrorShape;
  const message = normalizeDbErrorText(dbError.message);
  const details = normalizeDbErrorText(dbError.details);
  const hint = normalizeDbErrorText(dbError.hint);
  const combined = `${message} ${details} ${hint}`.trim();
  const hasNumericIlikeOperatorError = (
    combined.includes("operator does not exist")
    && (combined.includes("~~*") || combined.includes("ilike"))
    && (
      combined.includes("numeric")
      || combined.includes("integer")
      || combined.includes("bigint")
      || combined.includes("smallint")
    )
  );

  const hasNumericColumnMention = (
    combined.includes("column \"matriculation\" is of type numeric")
    || combined.includes("column matriculation is of type numeric")
    || combined.includes("matriculation is of type numeric")
  );
  const hasTextValueMention = (
    combined.includes("expression is of type text")
    || combined.includes("expression is of type character varying")
    || combined.includes("expression is of type varchar")
  );

  return (
    hasNumericIlikeOperatorError
    || combined.includes("invalid input syntax for type numeric")
    || hasNumericColumnMention
    || (combined.includes("matriculation") && hasTextValueMention)
  );
}

export function mapPersonDbError(error: unknown, fallbackMessage: string) {
  const dbError = (error ?? {}) as DbErrorShape;
  const message = normalizeDbErrorText(dbError.message);
  const details = normalizeDbErrorText(dbError.details);
  const hint = normalizeDbErrorText(dbError.hint);
  const combined = `${message} ${details} ${hint}`.trim();

  if (
    combined.includes("people_unique_tenant_matriculation_key")
    || combined.includes("idx_people_unique_tenant_matriculation")
    || combined.includes("pessoa duplicada para matricula")
  ) {
    return {
      status: 409,
      message: "Ja existe pessoa com esta matricula no tenant atual.",
      reason: "DUPLICATE_PERSON_MATRICULATION",
    } as const;
  }

  if (
    combined.includes("people_unique_tenant_cpf_matriculation_key")
    || combined.includes("idx_people_unique_tenant_cpf_matriculation")
  ) {
    return {
      status: 409,
      message: "Ja existe pessoa com este CPF e esta matricula no tenant atual.",
      reason: "DUPLICATE_PERSON_CPF_MATRICULATION",
    } as const;
  }

  if (
    combined.includes("people_unique_tenant_cpf_key")
    || combined.includes("idx_people_unique_tenant_cpf")
  ) {
    return {
      status: 409,
      message: "Ja existe pessoa com este CPF no tenant atual.",
      reason: "DUPLICATE_PERSON_CPF",
    } as const;
  }

  if (combined.includes("chk_people_cpf_format") || combined.includes("invalid_person_cpf")) {
    return {
      status: 400,
      message: "CPF invalido. Informe 11 digitos ou deixe em branco.",
      reason: "INVALID_PERSON_CPF",
    } as const;
  }

  if (combined.includes("duplicate key") || combined.includes("people_unique_identity")) {
    return {
      status: 409,
      message: "Ja existe pessoa com o mesmo nome, matricula, cargo, tipo e nivel no tenant atual.",
      reason: "DUPLICATE_PERSON_IDENTITY",
    } as const;
  }

  if (combined.includes("people_job_title_type_tenant_fk")) {
    return {
      status: 422,
      message: "Tipo invalido para o cargo selecionado.",
      reason: "INVALID_JOB_TITLE_TYPE",
    } as const;
  }

  if (combined.includes("people_job_level_tenant_fk")) {
    return {
      status: 422,
      message: "Nivel invalido para o tenant atual.",
      reason: "INVALID_JOB_LEVEL",
    } as const;
  }

  if (
    combined.includes("chk_people_matriculation_not_blank")
    || combined.includes("null value in column \"matriculation\"")
  ) {
    return {
      status: 400,
      message: "Matricula obrigatoria para salvar pessoa.",
      reason: "MATRICULATION_REQUIRED",
    } as const;
  }

  if (isMatriculationNumericTypeMismatchError(error) || combined.includes("invalid input syntax for type numeric")) {
    return {
      status: 400,
      message: "Matricula invalida para este ambiente. Use somente numeros.",
      reason: "INVALID_MATRICULATION_FORMAT",
    } as const;
  }

  if (combined.includes("save_person_record") && combined.includes("function")) {
    return {
      status: 500,
      message: "RPC save_person_record indisponivel no banco. Aplique a migration 079_create_people_and_invite_write_rpcs.sql.",
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
