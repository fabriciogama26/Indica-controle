// Edge Function: import_project_forecast
// Imports project forecast XLSX (projeto, codigo, quantidade) with RPC guard.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const respond = (
  status: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, ...extraHeaders },
  })

const getBearerToken = (req: Request) => {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.substring(7).trim()
}

const normalizeText = (value: unknown) => String(value ?? '').trim()

const normalizeHeader = (value: unknown) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const parsePositiveNumber = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }

  const raw = normalizeText(value)
  if (!raw) return null

  let normalized = raw.replace(/\s+/g, '')
  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = normalized.replace(/,/g, '')
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.')
  }

  const numeric = Number(normalized)
  if (!Number.isFinite(numeric) || numeric <= 0) return null

  return numeric
}

type ParsedRow = {
  line: number
  projectSob: string
  code: string
  qtyPlanned: number
}

type ImportIssue = {
  line: number
  column: string
  value: string
  error: string
}

function makeIssue(line: number, column: string, value: unknown, error: string): ImportIssue {
  return {
    line,
    column,
    value: normalizeText(value),
    error,
  }
}

function parseWorkbook(content: ArrayBuffer): { rows: ParsedRow[]; issues: ImportIssue[] } {
  const workbook = XLSX.read(content, { type: 'array', cellDates: false, raw: false })
  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    return { rows: [], issues: [makeIssue(1, 'arquivo', '', 'Planilha XLSX sem abas.')] }
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  })

  if (rawRows.length === 0) {
    return { rows: [], issues: [makeIssue(1, 'arquivo', '', 'Planilha vazia. Preencha ao menos uma linha.')] }
  }

  const firstRow = rawRows[0] ?? {}
  const normalizedToOriginal = new Map<string, string>()
  for (const key of Object.keys(firstRow)) {
    normalizedToOriginal.set(normalizeHeader(key), key)
  }

  const projectKey = normalizedToOriginal.get('projeto') ?? normalizedToOriginal.get('sob') ?? ''
  const codeKey = normalizedToOriginal.get('codigo') ?? ''
  const qtyKey = normalizedToOriginal.get('quantidade') ?? ''

  if (!projectKey || !codeKey || !qtyKey) {
    return {
      rows: [],
      issues: [
        makeIssue(
          1,
          'cabecalho',
          Object.keys(firstRow).join('; '),
          'Cabecalho invalido. Use o modelo oficial com as colunas: projeto, codigo, quantidade.',
        ),
      ],
    }
  }

  const rows: ParsedRow[] = []
  const issues: ImportIssue[] = []

  rawRows.forEach((row, index) => {
    const line = index + 2
    const projectSob = normalizeText(row[projectKey]).toUpperCase()
    const code = normalizeText(row[codeKey]).toUpperCase()
    const qty = parsePositiveNumber(row[qtyKey])

    if (!projectSob && !code && !normalizeText(row[qtyKey])) {
      return
    }

    if (!projectSob) {
      issues.push(makeIssue(line, 'projeto', row[projectKey], 'Projeto obrigatorio.'))
    }

    if (!code) {
      issues.push(makeIssue(line, 'codigo', row[codeKey], 'Codigo obrigatorio.'))
    }

    if (qty === null) {
      issues.push(makeIssue(line, 'quantidade', row[qtyKey], 'Quantidade invalida.'))
    }

    if (!projectSob || !code || qty === null) {
      return
    }

    rows.push({ line, projectSob, code, qtyPlanned: qty })
  })

  if (rows.length === 0 && issues.length === 0) {
    issues.push(makeIssue(1, 'arquivo', '', 'Nenhuma linha valida encontrada para importacao.'))
  }

  return { rows, issues }
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return respond(405, { success: false, message: 'method_not_allowed' })
  }

  const accessToken = getBearerToken(req)
  if (!accessToken) {
    return respond(401, { success: false, message: 'Nao autenticado.' })
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData?.user?.id) {
    return respond(401, { success: false, message: 'Sessao invalida.' })
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('id, tenant_id, ativo')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (appUserError || !appUser?.tenant_id || appUser.ativo === false) {
    return respond(403, { success: false, message: 'Usuario sem permissao para importar materiais previstos.' })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return respond(400, { success: false, message: 'Falha ao ler o formulario enviado.' })
  }

  const file = formData.get('file')

  if (!(file instanceof File)) {
    return respond(400, { success: false, message: 'Arquivo XLSX obrigatorio.' })
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return respond(400, { success: false, message: 'Somente arquivo .xlsx e permitido.' })
  }

  if (file.size > 5 * 1024 * 1024) {
    return respond(400, { success: false, message: 'Arquivo maior que 5MB nao e permitido.' })
  }

  const parsed = parseWorkbook(await file.arrayBuffer())
  if (parsed.issues.length > 0) {
    return respond(400, {
      success: false,
      message: 'Falha ao validar planilha de materiais previstos.',
      errors: parsed.issues.slice(0, 30).map((issue) => `Linha ${issue.line}: ${issue.error}`),
      errorRows: parsed.issues.slice(0, 200),
    })
  }

  const projectSobList = Array.from(new Set(parsed.rows.map((item) => item.projectSob)))
  const codeList = Array.from(new Set(parsed.rows.map((item) => item.code)))

  const { data: projects, error: projectsError } = await supabase
    .from('project')
    .select('id, sob')
    .eq('tenant_id', appUser.tenant_id)
    .in('sob', projectSobList)

  if (projectsError) {
    return respond(500, { success: false, message: 'Falha ao validar projetos da planilha.' })
  }

  const projectBySob = new Map<string, { id: string; sob: string }>()
  ;(projects ?? []).forEach((item: { id: string; sob: string }) => {
    projectBySob.set(normalizeText(item.sob).toUpperCase(), item)
  })

  const { data: materials, error: materialsError } = await supabase
    .from('materials')
    .select('id, codigo')
    .eq('tenant_id', appUser.tenant_id)
    .in('codigo', codeList)

  if (materialsError) {
    return respond(500, { success: false, message: 'Falha ao validar materiais da planilha.' })
  }

  const validationIssues: ImportIssue[] = []

  const materialByCode = new Map<string, { id: string; codigo: string }>()
  ;(materials ?? []).forEach((item: { id: string; codigo: string }) => {
    materialByCode.set(normalizeText(item.codigo).toUpperCase(), item)
  })

  const firstOccurrence = new Map<string, ParsedRow>()
  parsed.rows.forEach((row) => {
    if (!projectBySob.has(row.projectSob)) {
      validationIssues.push(makeIssue(row.line, 'projeto', row.projectSob, 'Projeto nao encontrado no tenant informado.'))
    }

    if (!materialByCode.has(row.code)) {
      validationIssues.push(makeIssue(row.line, 'codigo', row.code, 'Material nao encontrado no tenant.'))
    }

    const duplicateKey = `${row.projectSob}|${row.code}`
    if (firstOccurrence.has(duplicateKey)) {
      validationIssues.push(makeIssue(row.line, 'codigo', row.code, 'Codigo duplicado para o mesmo projeto dentro da planilha.'))
    } else {
      firstOccurrence.set(duplicateKey, row)
    }
  })

  if (validationIssues.length > 0) {
    return respond(400, {
      success: false,
      message: 'Existem erros de validacao na planilha de materiais previstos.',
      errors: validationIssues.slice(0, 30).map((issue) => `Linha ${issue.line}: ${issue.error}`),
      errorRows: validationIssues.slice(0, 200),
    })
  }

  const rowsByProject = new Map<string, ParsedRow[]>()
  parsed.rows.forEach((row) => {
    const project = projectBySob.get(row.projectSob)
    if (!project?.id) return
    const current = rowsByProject.get(project.id) ?? []
    current.push(row)
    rowsByProject.set(project.id, current)
  })

  let inserted = 0
  let skipped = 0
  const skippedIssues: ImportIssue[] = []
  const processedProjectIds = new Set<string>()

  for (const [projectId, projectRows] of rowsByProject.entries()) {
    const materialIdsInProject = projectRows.map((row) => materialByCode.get(row.code)?.id).filter(Boolean) as string[]
    const { data: existingRows, error: existingError } = await supabase
      .from('project_material_forecast')
      .select('material_id')
      .eq('tenant_id', appUser.tenant_id)
      .eq('project_id', projectId)
      .in('material_id', materialIdsInProject)

    if (existingError) {
      return respond(500, { success: false, message: 'Falha ao validar materiais ja cadastrados no projeto.' })
    }

    const existingMaterialIds = new Set((existingRows ?? []).map((item: { material_id: string }) => String(item.material_id)))
    const rowsToInsert = projectRows.filter((row) => {
      const materialId = materialByCode.get(row.code)?.id ?? ''
      if (existingMaterialIds.has(materialId)) {
        skipped += 1
        skippedIssues.push(makeIssue(row.line, 'codigo', row.code, 'Codigo ja existe no projeto. Linha ignorada.'))
        return false
      }
      return true
    })

    if (rowsToInsert.length === 0) {
      continue
    }

    const { data: precheckData, error: precheckError } = await supabase.rpc('precheck_project_material_forecast_import', {
      p_tenant_id: appUser.tenant_id,
      p_project_id: projectId,
      p_material_ids: rowsToInsert.map((row) => materialByCode.get(row.code)?.id).filter(Boolean) as string[],
    })

    if (precheckError) {
      return respond(500, { success: false, message: 'Falha ao validar protecao de importacao.' })
    }

    const precheckResult = (precheckData ?? {}) as Record<string, unknown>
    if (precheckResult.success !== true) {
      return respond(409, {
        success: false,
        message: 'Importacao bloqueada pela validacao de materiais previstos.',
        reason: String(precheckResult.reason ?? ''),
        codes: precheckResult.codes ?? [],
      })
    }

    const payload = rowsToInsert.map((row) => ({
      material_id: materialByCode.get(row.code)?.id,
      qty_planned: row.qtyPlanned,
    }))

    const { data: appendData, error: appendError } = await supabase.rpc('append_project_material_forecast', {
      p_tenant_id: appUser.tenant_id,
      p_project_id: projectId,
      p_actor_user_id: appUser.id,
      p_items: payload,
      p_source: 'IMPORT_XLSX_EDGE',
    })

    if (appendError) {
      return respond(500, { success: false, message: 'Falha ao registrar materiais previstos do projeto.' })
    }

    const appendResult = (appendData ?? {}) as Record<string, unknown>
    if (appendResult.success !== true) {
      return respond(409, {
        success: false,
        message: 'Importacao bloqueada pela validacao de materiais previstos.',
        reason: String(appendResult.reason ?? ''),
        codes: appendResult.codes ?? [],
      })
    }

    inserted += Number(appendResult.inserted ?? 0)
    processedProjectIds.add(projectId)
  }

  return respond(200, {
    success: true,
    message:
      skipped > 0
        ? `Materiais previstos importados parcialmente. ${inserted} linhas cadastradas e ${skipped} linhas ignoradas por ja existirem no projeto.`
        : `Materiais previstos importados com sucesso. Projetos processados: ${processedProjectIds.size}.`,
    ...(skippedIssues.length > 0 ? { errorRows: skippedIssues.slice(0, 200) } : {}),
    summary: {
      rowsRead: parsed.rows.length,
      projectsProcessed: processedProjectIds.size,
      materialsRegistered: inserted,
      skippedRows: skipped,
      sourceFile: file.name,
    },
  })
})
