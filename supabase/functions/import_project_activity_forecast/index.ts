// Edge Function: import_project_activity_forecast
// Imports project activity forecast XLSX (projeto, codigo, quantidade).

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { corsHeaders, respond, getBearerToken } from '../_shared/http.ts'
import { createServiceClient } from '../_shared/supabase.ts'
import { parseWorkbook, normalizeText, makeIssue, ImportIssue } from '../_shared/xlsx.ts'
import { requirePageAccess, requireActiveTenant } from '../_shared/page_authorization.ts'

const supabase = createServiceClient()

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
    .select('id, tenant_id, ativo, role_id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (appUserError || !appUser?.tenant_id || appUser.ativo === false) {
    return respond(403, { success: false, message: 'Usuario sem permissao para importar atividades previstas.' })
  }

  const tenantCheck = await requireActiveTenant(supabase, appUser.tenant_id)
  if (!tenantCheck.active) {
    return respond(tenantCheck.status, { success: false, message: tenantCheck.message })
  }

  const pageAuthorization = await requirePageAccess(supabase, appUser, 'projetos', 'import')
  if (!pageAuthorization.allowed) {
    return respond(pageAuthorization.status, { success: false, message: pageAuthorization.message })
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
      message: 'Falha ao validar planilha de atividades previstas.',
      errors: parsed.issues.slice(0, 30).map((i) => `Linha ${i.line}: ${i.error}`),
      errorRows: parsed.issues.slice(0, 200),
    })
  }

  const projectSobList = [...new Set(parsed.rows.map((r) => r.projectSob))]
  const codeList = [...new Set(parsed.rows.map((r) => r.code))]

  const { data: projects, error: projectsError } = await supabase
    .from('project')
    .select('id, sob')
    .eq('tenant_id', appUser.tenant_id)
    .in('sob', projectSobList)

  if (projectsError) {
    return respond(500, { success: false, message: 'Falha ao validar projetos da planilha.' })
  }

  const { data: activities, error: activitiesError } = await supabase
    .from('service_activities')
    .select('id, code')
    .eq('tenant_id', appUser.tenant_id)
    .eq('ativo', true)
    .in('code', codeList)

  if (activitiesError) {
    return respond(500, { success: false, message: 'Falha ao validar atividades da planilha.' })
  }

  const projectBySob = new Map<string, { id: string; sob: string }>()
  ;(projects ?? []).forEach((p: { id: string; sob: string }) => {
    projectBySob.set(normalizeText(p.sob).toUpperCase(), p)
  })

  const activityByCode = new Map<string, { id: string; code: string }>()
  ;(activities ?? []).forEach((a: { id: string; code: string }) => {
    activityByCode.set(normalizeText(a.code).toUpperCase(), a)
  })

  const validationIssues: ImportIssue[] = []
  const firstOccurrence = new Map<string, true>()
  parsed.rows.forEach((row) => {
    if (!projectBySob.has(row.projectSob)) {
      validationIssues.push(makeIssue(row.line, 'projeto', row.projectSob, 'Projeto nao encontrado no tenant.'))
    }
    if (!activityByCode.has(row.code)) {
      validationIssues.push(makeIssue(row.line, 'codigo', row.code, 'Atividade ativa nao encontrada no tenant.'))
    }
    const key = `${row.projectSob}|${row.code}`
    if (firstOccurrence.has(key)) {
      validationIssues.push(makeIssue(row.line, 'codigo', row.code, 'Codigo duplicado para o mesmo projeto dentro da planilha.'))
    } else {
      firstOccurrence.set(key, true)
    }
  })

  if (validationIssues.length > 0) {
    return respond(400, {
      success: false,
      message: 'Existem erros de validacao na planilha de atividades previstas.',
      errors: validationIssues.slice(0, 30).map((i) => `Linha ${i.line}: ${i.error}`),
      errorRows: validationIssues.slice(0, 200),
    })
  }

  const rowsByProject = new Map<string, typeof parsed.rows>()
  parsed.rows.forEach((row) => {
    const project = projectBySob.get(row.projectSob)
    if (!project?.id) return
    const current = rowsByProject.get(project.id) ?? []
    current.push(row)
    rowsByProject.set(project.id, current)
  })

  const projectIdToSob = new Map<string, string>()
  projectBySob.forEach((p) => projectIdToSob.set(p.id, p.sob))

  let inserted = 0
  let skipped = 0
  const skippedIssues: ImportIssue[] = []
  const projectsSucceeded: string[] = []
  const projectsFailed: { sob: string; reason: string }[] = []

  for (const [projectId, projectRows] of rowsByProject.entries()) {
    const sob = projectIdToSob.get(projectId) ?? projectId
    const activityIds = projectRows.map((r) => activityByCode.get(r.code)?.id).filter(Boolean) as string[]

    const { data: existingRows, error: existingError } = await supabase
      .from('project_activity_forecast')
      .select('service_activity_id')
      .eq('tenant_id', appUser.tenant_id)
      .eq('project_id', projectId)
      .in('service_activity_id', activityIds)

    if (existingError) {
      projectsFailed.push({ sob, reason: 'Falha ao verificar atividades existentes no projeto.' })
      continue
    }

    const existingIds = new Set(
      (existingRows ?? []).map((r: { service_activity_id: string }) => String(r.service_activity_id)),
    )
    const rowsToInsert = projectRows.filter((row) => {
      const activityId = activityByCode.get(row.code)?.id ?? ''
      if (existingIds.has(activityId)) {
        skipped += 1
        skippedIssues.push(makeIssue(row.line, 'codigo', row.code, 'Codigo ja existe no projeto. Linha ignorada.'))
        return false
      }
      return true
    })

    if (rowsToInsert.length === 0) {
      projectsSucceeded.push(sob)
      continue
    }

    const { data: precheckData, error: precheckError } = await supabase.rpc('precheck_project_activity_forecast_import', {
      p_tenant_id: appUser.tenant_id,
      p_project_id: projectId,
      p_activity_ids: rowsToInsert.map((r) => activityByCode.get(r.code)?.id).filter(Boolean) as string[],
    })

    if (precheckError) {
      projectsFailed.push({ sob, reason: 'Falha ao validar protecao de importacao.' })
      continue
    }

    const precheck = (precheckData ?? {}) as Record<string, unknown>
    if (precheck.success !== true) {
      projectsFailed.push({
        sob,
        reason: `Importacao bloqueada: ${String(precheck.reason ?? 'conflito')}`,
      })
      continue
    }

    const { data: appendData, error: appendError } = await supabase.rpc('append_project_activity_forecast', {
      p_tenant_id: appUser.tenant_id,
      p_project_id: projectId,
      p_actor_user_id: appUser.id,
      p_items: rowsToInsert.map((r) => ({
        activity_id: activityByCode.get(r.code)?.id,
        qty_planned: r.qtyPlanned,
      })),
      p_source: 'IMPORT_XLSX_EDGE',
    })

    if (appendError) {
      projectsFailed.push({ sob, reason: 'Falha ao registrar atividades previstas.' })
      continue
    }

    const appendResult = (appendData ?? {}) as Record<string, unknown>
    if (appendResult.success !== true) {
      projectsFailed.push({
        sob,
        reason: `Importacao bloqueada: ${String(appendResult.reason ?? 'conflito')}`,
      })
      continue
    }

    inserted += Number(appendResult.inserted ?? 0)
    projectsSucceeded.push(sob)
  }

  if (projectsFailed.length > 0) {
    return respond(207, {
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
    })
  }

  return respond(200, {
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
  })
})
