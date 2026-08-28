import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { resolveAuthenticatedAppUser } from "@/lib/server/appUsersAdmin";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { withIdempotency } from "@/lib/server/idempotency";
import { authorizeProjectsAction } from "@/server/modules/projects/authorization";

type ParsedImportRow = {
  line: number;
  projectSob: string;
  code: string;
  qtyPlanned: number;
};

type ImportIssue = {
  line: number;
  column: string;
  value: string;
  error: string;
};

type ProjectLookupRow = {
  id: string;
  sob: string;
};

type ActivityLookupRow = {
  id: string;
  code: string;
};

type ExistingForecastRow = {
  project_id: string;
  service_activity_id: string;
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const PROJECT_FORECAST_QTY_LIMIT = 100000;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeImportKey(value: unknown) {
  return normalizeText(value).toUpperCase();
}

function normalizeHeader(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parsePositiveNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= PROJECT_FORECAST_QTY_LIMIT ? Number(value.toFixed(2)) : null;
  }

  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }

  let normalized = raw.replace(/\s+/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 && numeric <= PROJECT_FORECAST_QTY_LIMIT ? Number(numeric.toFixed(2)) : null;
}

function makeIssue(line: number, column: string, value: unknown, error: string): ImportIssue {
  return {
    line,
    column,
    value: normalizeText(value),
    error,
  };
}

function parseWorkbook(content: ArrayBuffer) {
  const workbook = XLSX.read(content, { type: "array", cellDates: false, raw: false });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return { rows: [] as ParsedImportRow[], issues: [makeIssue(1, "arquivo", "", "Planilha XLSX sem abas.")] };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    defval: "",
    raw: false,
  }) as Record<string, unknown>[];

  if (rawRows.length === 0) {
    return {
      rows: [] as ParsedImportRow[],
      issues: [makeIssue(1, "arquivo", "", "Planilha vazia. Preencha ao menos uma linha.")],
    };
  }

  const firstRow = rawRows[0] ?? {};
  const normalizedToOriginal = new Map<string, string>();
  Object.keys(firstRow).forEach((key) => {
    normalizedToOriginal.set(normalizeHeader(key), key);
  });

  const projectKey = normalizedToOriginal.get("projeto") ?? normalizedToOriginal.get("sob") ?? "";
  const codeKey = normalizedToOriginal.get("codigo") ?? "";
  const qtyKey = normalizedToOriginal.get("quantidade") ?? "";

  if (!projectKey || !codeKey || !qtyKey) {
    return {
      rows: [] as ParsedImportRow[],
      issues: [
        makeIssue(
          1,
          "cabecalho",
          Object.keys(firstRow).join("; "),
          "Cabecalho invalido. Use o modelo oficial com as colunas: projeto, codigo, quantidade.",
        ),
      ],
    };
  }

  const rows: ParsedImportRow[] = [];
  const issues: ImportIssue[] = [];

  rawRows.forEach((row, index) => {
    const line = index + 2;
    const projectSob = normalizeImportKey(row[projectKey]);
    const code = normalizeImportKey(row[codeKey]);
    const qtyPlanned = parsePositiveNumber(row[qtyKey]);

    if (!projectSob && !code && !normalizeText(row[qtyKey])) {
      return;
    }

    if (!projectSob) issues.push(makeIssue(line, "projeto", row[projectKey], "Projeto obrigatorio."));
    if (!code) issues.push(makeIssue(line, "codigo", row[codeKey], "Codigo obrigatorio."));
    if (qtyPlanned === null) {
      issues.push(
        makeIssue(
          line,
          "quantidade",
          row[qtyKey],
          `Quantidade invalida. Informe valor maior que zero e menor ou igual a ${PROJECT_FORECAST_QTY_LIMIT}.`,
        ),
      );
    }
    if (!projectSob || !code || qtyPlanned === null) {
      return;
    }

    rows.push({ line, projectSob, code, qtyPlanned });
  });

  if (rows.length === 0 && issues.length === 0) {
    issues.push(makeIssue(1, "arquivo", "", "Nenhuma linha valida encontrada para importacao."));
  }

  return { rows, issues };
}

function buildValidationResponse(issues: ImportIssue[], rowsRead: number, message: string) {
  return NextResponse.json(
    {
      success: false,
      message,
      errors: issues.slice(0, 30).map((issue) => `Linha ${issue.line}: ${issue.error}`),
      errorRows: issues.slice(0, 200),
      summary: {
        rowsRead,
        activitiesRegistered: 0,
        skippedRows: 0,
      },
    },
    { status: 400 },
  );
}

function makePairKey(projectId: string, activityId: string) {
  return `${projectId}::${activityId}`;
}

export async function POST(request: NextRequest) {
  const preAuth = await resolveAuthenticatedAppUser(request);
  const tenantId = "appUser" in preAuth ? preAuth.appUser.tenant_id : null;
  const actorUserId = "appUser" in preAuth ? preAuth.appUser.id : null;

  return withIdempotency(request, tenantId, actorUserId, "/api/projects/activity-forecast/import:IMPORT", () => handleImport(request));
}

async function handleImport(request: NextRequest) {
  try {
    const resolution = await resolveAuthenticatedAppUser(request, {
      invalidSessionMessage: "Sessao invalida para importar atividades previstas.",
      inactiveMessage: "Usuario inativo.",
    });

    if ("error" in resolution) {
      return NextResponse.json({ message: resolution.error.message }, { status: resolution.error.status });
    }

    const authorizationError = await authorizeProjectsAction(resolution, "create");
    if (authorizationError) return authorizationError;

    // Importacao le e parseia XLSX de ate 5MB e grava em lote: e a rota mais
    // cara do modulo. O teto abaixo cobre retentativa legitima do usuario sem
    // permitir repeticao continua.
    const limited = await enforceRateLimit(resolution.supabase, {
      route: "api.projects.activity-forecast.import",
      identity: resolution.appUser.id,
      maxHits: 5,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ success: false, message: "Falha ao ler o formulario enviado." }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, message: "Arquivo XLSX obrigatorio." }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ success: false, message: "Somente arquivo .xlsx e permitido." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ success: false, message: "Arquivo maior que 5MB nao e permitido." }, { status: 400 });
    }

    const parsed = parseWorkbook(await file.arrayBuffer());
    if (parsed.issues.length > 0) {
      return buildValidationResponse(parsed.issues, parsed.rows.length, "Falha ao validar planilha de atividades previstas.");
    }

    const { supabase, appUser } = resolution;
    const projectSobList = Array.from(new Set(parsed.rows.map((row) => row.projectSob)));
    const codeList = Array.from(new Set(parsed.rows.map((row) => row.code)));

    const [projectsResult, activitiesResult] = await Promise.all([
      supabase
        .from("project")
        .select("id, sob")
        .eq("tenant_id", appUser.tenant_id)
        .in("sob", projectSobList)
        .returns<ProjectLookupRow[]>(),
      supabase
        .from("service_activities")
        .select("id, code")
        .eq("tenant_id", appUser.tenant_id)
        .eq("ativo", true)
        .in("code", codeList)
        .returns<ActivityLookupRow[]>(),
    ]);

    if (projectsResult.error) {
      return NextResponse.json({ success: false, message: "Falha ao validar projetos da planilha." }, { status: 500 });
    }

    if (activitiesResult.error) {
      return NextResponse.json({ success: false, message: "Falha ao validar atividades da planilha." }, { status: 500 });
    }

    const projectBySob = new Map(
      (projectsResult.data ?? []).map((project) => [normalizeImportKey(project.sob), project]),
    );
    const activityByCode = new Map(
      (activitiesResult.data ?? []).map((activity) => [normalizeImportKey(activity.code), activity]),
    );

    const validationIssues: ImportIssue[] = [];
    const firstOccurrence = new Map<string, true>();
    parsed.rows.forEach((row) => {
      if (!projectBySob.has(row.projectSob)) {
        validationIssues.push(makeIssue(row.line, "projeto", row.projectSob, "Projeto nao encontrado no tenant."));
      }

      if (!activityByCode.has(row.code)) {
        validationIssues.push(makeIssue(row.line, "codigo", row.code, "Atividade ativa nao encontrada no tenant."));
      }

      const duplicateKey = `${row.projectSob}|${row.code}`;
      if (firstOccurrence.has(duplicateKey)) {
        validationIssues.push(makeIssue(row.line, "codigo", row.code, "Codigo duplicado para o mesmo projeto dentro da planilha."));
      } else {
        firstOccurrence.set(duplicateKey, true);
      }
    });

    if (validationIssues.length > 0) {
      return buildValidationResponse(validationIssues, parsed.rows.length, "Existem erros de validacao na planilha de atividades previstas.");
    }

    const projectIds = Array.from(new Set((projectsResult.data ?? []).map((project) => project.id)));
    const activityIds = Array.from(new Set((activitiesResult.data ?? []).map((activity) => activity.id)));
    const existingResult =
      projectIds.length > 0 && activityIds.length > 0
        ? await supabase
            .from("project_activity_forecast")
            .select("project_id, service_activity_id")
            .eq("tenant_id", appUser.tenant_id)
            .in("project_id", projectIds)
            .in("service_activity_id", activityIds)
            .returns<ExistingForecastRow[]>()
        : { data: [] as ExistingForecastRow[], error: null };

    if (existingResult.error) {
      return NextResponse.json({ success: false, message: "Falha ao verificar atividades existentes no projeto." }, { status: 500 });
    }

    const existingPairs = new Set(
      (existingResult.data ?? []).map((row) => makePairKey(row.project_id, row.service_activity_id)),
    );
    const rowsByProject = new Map<string, ParsedImportRow[]>();
    const projectIdToSob = new Map<string, string>();
    let skipped = 0;
    const skippedIssues: ImportIssue[] = [];

    parsed.rows.forEach((row) => {
      const project = projectBySob.get(row.projectSob);
      const activity = activityByCode.get(row.code);
      if (!project || !activity) {
        return;
      }

      projectIdToSob.set(project.id, project.sob);
      const pairKey = makePairKey(project.id, activity.id);
      if (existingPairs.has(pairKey)) {
        skipped += 1;
        skippedIssues.push(makeIssue(row.line, "codigo", row.code, "Codigo ja existe no projeto. Linha ignorada."));
        return;
      }

      const current = rowsByProject.get(project.id) ?? [];
      current.push(row);
      rowsByProject.set(project.id, current);
    });

    let inserted = 0;
    const projectsSucceeded: string[] = [];
    const projectsFailed: Array<{ sob: string; reason: string }> = [];

    for (const [projectId, projectRows] of rowsByProject.entries()) {
      const sob = projectIdToSob.get(projectId) ?? projectId;
      const rowsToInsert = projectRows
        .map((row) => {
          const activity = activityByCode.get(row.code);
          if (!activity) return null;
          return {
            tenant_id: appUser.tenant_id,
            project_id: projectId,
            service_activity_id: activity.id,
            qty_planned: row.qtyPlanned,
            observation: null,
            source: "IMPORT_XLSX_API",
            created_by: appUser.id,
            updated_by: appUser.id,
          };
        })
        .filter(Boolean);

      if (rowsToInsert.length === 0) {
        projectsSucceeded.push(sob);
        continue;
      }

      const { error: insertError } = await supabase.from("project_activity_forecast").insert(rowsToInsert);
      if (insertError) {
        projectsFailed.push({ sob, reason: "Falha ao registrar atividades previstas do projeto." });
        continue;
      }

      inserted += rowsToInsert.length;
      projectsSucceeded.push(sob);
    }

    if (projectsFailed.length > 0) {
      return NextResponse.json(
        {
          success: false,
          partial: true,
          message: `Importacao parcial: ${projectsSucceeded.length} projeto(s) importados, ${projectsFailed.length} com erro. Corrija os projetos indicados e reimporte somente eles.`,
          projectsSucceeded,
          projectsFailed,
          ...(skippedIssues.length > 0 ? { errorRows: skippedIssues.slice(0, 200) } : {}),
          summary: {
            rowsRead: parsed.rows.length,
            projectsSucceeded: projectsSucceeded.length,
            projectsFailed: projectsFailed.length,
            activitiesRegistered: inserted,
            skippedRows: skipped,
            sourceFile: file.name,
          },
        },
        { status: 207 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        skipped > 0
          ? `Atividades previstas importadas parcialmente. ${inserted} linhas cadastradas e ${skipped} linhas ignoradas por ja existirem no projeto.`
          : `Atividades previstas importadas com sucesso. Projetos processados: ${projectsSucceeded.length}.`,
      ...(skippedIssues.length > 0 ? { errorRows: skippedIssues.slice(0, 200) } : {}),
      summary: {
        rowsRead: parsed.rows.length,
        projectsProcessed: projectsSucceeded.length,
        activitiesRegistered: inserted,
        skippedRows: skipped,
        sourceFile: file.name,
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Falha ao importar atividades previstas." }, { status: 500 });
  }
}
