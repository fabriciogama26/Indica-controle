// Edge Function: import_project_activity_forecast
// Imports project activity forecast XLSX (codigo, quantidade) with RPC guard.

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
  code: string
  qtyPlanned: number
}

function parseWorkbook(content: ArrayBuffer): { rows: ParsedRow[]; errors: string[] } {
  const workbook = XLSX.read(content, { type: 'array', cellDates: false, raw: false })
  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    return { rows: [], errors: ['Planilha XLSX sem abas.'] }
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  })

  if (rawRows.length === 0) {
    return { rows: [], errors: ['Planilha vazia. Preencha ao menos uma linha.'] }
  }

  const firstRow = rawRows[0] ?? {}
  const normalizedToOriginal = new Map<string, string>()
  for (const key of Object.keys(firstRow)) {
    normalizedToOriginal.set(normalizeHeader(key), key)
  }

  const codeKey = normalizedToOriginal.get('codigo') ?? ''
  const qtyKey = normalizedToOriginal.get('quantidade') ?? ''

  if (!codeKey || !qtyKey) {
    return {
      rows: [],
      errors: ['Cabecalho invalido. Use o modelo oficial com as colunas: codigo, quantidade.'],
    }
  }

  const rows: ParsedRow[] = []
  const errors: string[] = []

  rawRows.forEach((row, index) => {
    const line = index + 2
    const code = normalizeText(row[codeKey]).toUpperCase()
    const qty = parsePositiveNumber(row[qtyKey])

    if (!code && !normalizeText(row[qtyKey])) {
      return
    }

    if (!code) {
      errors.push(`Linha ${line}: codigo obrigatorio.`)
      return
    }

    if (qty === null) {
      errors.push(`Linha ${line}: quantidade invalida.`)
      return
    }

    rows.push({ line, code, qtyPlanned: qty })
  })

  if (rows.length === 0 && errors.length === 0) {
    errors.push('Nenhuma linha valida encontrada para importacao.')
  }

  return { rows, errors }
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
    return respond(403, { success: false, message: 'Usuario sem permissao para importar atividades previstas.' })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return respond(400, { success: false, message: 'Falha ao ler o formulario enviado.' })
  }

  const projectId = normalizeText(formData.get('projectId'))
  const file = formData.get('file')

  if (!projectId) {
    return respond(400, { success: false, message: 'projectId obrigatorio.' })
  }

  if (!(file instanceof File)) {
    return respond(400, { success: false, message: 'Arquivo XLSX obrigatorio.' })
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return respond(400, { success: false, message: 'Somente arquivo .xlsx e permitido.' })
  }

  if (file.size > 5 * 1024 * 1024) {
    return respond(400, { success: false, message: 'Arquivo maior que 5MB nao e permitido.' })
  }

  const { data: project, error: projectError } = await supabase
    .from('project')
    .select('id, sob')
    .eq('tenant_id', appUser.tenant_id)
    .eq('id', projectId)
    .maybeSingle()

  if (projectError || !project?.id) {
    return respond(404, { success: false, message: 'Projeto nao encontrado no tenant informado.' })
  }

  const parsed = parseWorkbook(await file.arrayBuffer())
  if (parsed.errors.length > 0) {
    return respond(400, {
      success: false,
      message: 'Falha ao validar planilha de atividades previstas.',
      errors: parsed.errors.slice(0, 30),
    })
  }

  const codeList = parsed.rows.map((item) => item.code)
  const { data: activities, error: activitiesError } = await supabase
    .from('service_activities')
    .select('id, code')
    .eq('tenant_id', appUser.tenant_id)
    .eq('ativo', true)
    .in('code', codeList)

  if (activitiesError) {
    return respond(500, { success: false, message: 'Falha ao validar atividades da planilha.' })
  }

  const activityByCode = new Map<string, { id: string; code: string }>()
  ;(activities ?? []).forEach((item: { id: string; code: string }) => {
    activityByCode.set(normalizeText(item.code).toUpperCase(), item)
  })

  const missingCodes = codeList.filter((code) => !activityByCode.has(code))
  if (missingCodes.length > 0) {
    return respond(400, {
      success: false,
      message: 'Existem codigos de atividade nao cadastrados no tenant.',
      errors: missingCodes.slice(0, 50).map((code) => `Atividade nao encontrada: ${code}`),
    })
  }

  const activityIdsInFile = parsed.rows.map((row) => activityByCode.get(row.code)?.id).filter(Boolean) as string[]

  const { data: precheckData, error: precheckError } = await supabase.rpc('precheck_project_activity_forecast_import', {
    p_tenant_id: appUser.tenant_id,
    p_project_id: project.id,
    p_activity_ids: activityIdsInFile,
  })

  if (precheckError) {
    return respond(500, { success: false, message: 'Falha ao validar protecao de importacao.' })
  }

  const precheckResult = (precheckData ?? {}) as Record<string, unknown>
  if (precheckResult.success !== true) {
    const reason = String(precheckResult.reason ?? '')
    const blockedCodes = Array.isArray(precheckResult.codes) ? precheckResult.codes.map((v) => String(v)) : []

    if (reason === 'CODE_ALREADY_IMPORTED') {
      return respond(409, {
        success: false,
        message: 'Importacao bloqueada: codigo ja importado anteriormente para este projeto.',
        reason,
        codes: blockedCodes,
      })
    }

    if (reason === 'DUPLICATE_CODE_IN_FILE') {
      return respond(409, {
        success: false,
        message: 'Importacao bloqueada: codigo duplicado dentro da planilha.',
        reason,
        codes: blockedCodes,
      })
    }

    return respond(409, {
      success: false,
      message: 'Importacao bloqueada pela validacao de protecao.',
      reason,
    })
  }

  const mergedByCode = new Map<string, number>()
  parsed.rows.forEach((row) => {
    const current = mergedByCode.get(row.code) ?? 0
    mergedByCode.set(row.code, current + row.qtyPlanned)
  })

  const payload = Array.from(mergedByCode.entries()).map(([code, qty]) => ({
    activity_id: activityByCode.get(code)?.id,
    qty_planned: qty,
  }))

  const { data: appendData, error: appendError } = await supabase.rpc('append_project_activity_forecast', {
    p_tenant_id: appUser.tenant_id,
    p_project_id: project.id,
    p_actor_user_id: appUser.id,
    p_items: payload,
    p_source: 'IMPORT_XLSX_EDGE',
  })

  if (appendError) {
    return respond(500, { success: false, message: 'Falha ao registrar atividades previstas do projeto.' })
  }

  const appendResult = (appendData ?? {}) as Record<string, unknown>
  if (appendResult.success !== true) {
    return respond(409, {
      success: false,
      message: 'Importacao bloqueada pela validacao de atividades previstas.',
      reason: String(appendResult.reason ?? ''),
      codes: appendResult.codes ?? [],
    })
  }

  return respond(200, {
    success: true,
    message: `Atividades previstas do projeto ${String(project.sob ?? '')} importadas com sucesso.`,
    summary: {
      projectId: String(project.id),
      projectSob: String(project.sob ?? ''),
      rowsRead: parsed.rows.length,
      activitiesRegistered: Number(appendResult.inserted ?? 0),
      sourceFile: file.name,
    },
  })
})
