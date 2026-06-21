// Edge Function: sync_run
// Recebe o resumo de sincronizacao do app, grava no Supabase e aplica rate limit por usuario/dispositivo.
// Requer variaveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim()
    if (ip) return ip
  }
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || ''
}

const sha256Hex = async (value: string) => {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const normalizeText = (value: unknown, fallback = '') => {
  const text = String(value ?? '').trim()
  return text || fallback
}

const normalizeInt = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

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
    return respond(403, { success: false, message: 'Usuario sem permissao para sincronizar.' })
  }

  const body = await req.json().catch(() => ({}))
  const syncUuid = normalizeText(body.sync_uuid)
  const deviceId = normalizeText(body.device_id, 'N/A')

  if (!syncUuid) {
    return respond(400, { success: false, message: 'sync_uuid obrigatorio.' })
  }

  const ip = getClientIp(req) || 'unknown'
  const identityHash = await sha256Hex(`${appUser.tenant_id}|${appUser.id}|${deviceId}`)
  const ipHash = await sha256Hex(ip)
  const { data: rateData, error: rateError } = await supabase.rpc('rate_limit_check_and_hit', {
    p_scope: 'sync',
    p_route: 'sync.run',
    p_identity_hash: identityHash,
    p_owner_id: appUser.id,
    p_ip_hash: ipHash,
    p_max_hits: 1,
    p_window_seconds: 30,
  })

  if (rateError) {
    return respond(500, { success: false, message: 'Falha ao validar rate limit.' })
  }

  const rateResult = Array.isArray(rateData) ? rateData[0] : rateData
  if (rateResult?.allowed === false) {
    const retryAfterSeconds = Number(rateResult.retry_after) || 30
    return respond(
      429,
      {
        success: false,
        message: `Aguarde ${retryAfterSeconds} segundos para sincronizar novamente.`,
        retry_after: retryAfterSeconds,
      },
      { 'Retry-After': String(retryAfterSeconds) }
    )
  }

  const summaryPayload = {
    sync_uuid: syncUuid,
    tenant_id: appUser.tenant_id,
    user_id: appUser.id,
    device_id: deviceId,
    device_label: normalizeText(body.device_label) || null,
    source: normalizeText(body.source, 'APP'),
    status: normalizeText(body.status, 'SUCCESS'),
    trigger_type: normalizeText(body.trigger_type, 'MANUAL'),
    started_at: normalizeText(body.started_at),
    finished_at: normalizeText(body.finished_at),
    downloaded_at: normalizeText(body.downloaded_at) || null,
    uploaded_at: new Date().toISOString(),
    network_status: normalizeText(body.network_status) || null,
    pending_total: normalizeInt(body.pending_total),
    pending_sent: normalizeInt(body.pending_sent),
    materials_updated: normalizeInt(body.materials_updated),
    projects_updated: normalizeInt(body.projects_updated),
    balances_updated: normalizeInt(body.balances_updated),
    conflicts_found: normalizeInt(body.conflicts_found),
    warnings_count: normalizeInt(body.warnings_count),
    errors_count: normalizeInt(body.errors_count),
    message: normalizeText(body.message) || null,
    app_version: normalizeText(body.app_version) || null,
    created_by: appUser.id,
    updated_by: appUser.id,
  }

  const { error: upsertError } = await supabase
    .from('sync_runs')
    .upsert(summaryPayload, { onConflict: 'sync_uuid' })

  if (upsertError) {
    return respond(500, { success: false, message: 'Falha ao gravar resumo da sincronizacao.' })
  }

  const steps = Array.isArray(body.steps) ? body.steps : []
  if (steps.length > 0) {
    await supabase.from('sync_run_steps').delete().eq('sync_uuid', syncUuid)
    const stepPayload = steps.map((step: Record<string, unknown>, index: number) => ({
      sync_uuid: syncUuid,
      tenant_id: appUser.tenant_id,
      step_order: normalizeInt(step.step_order ?? index + 1),
      step_key: normalizeText(step.step_key, `step_${index + 1}`),
      step_label: normalizeText(step.step_label, `Etapa ${index + 1}`),
      status: normalizeText(step.status, 'SUCCESS'),
      items_count: normalizeInt(step.items_count),
      message: normalizeText(step.message) || null,
      started_at: normalizeText(step.started_at) || null,
      finished_at: normalizeText(step.finished_at) || null,
      created_by: appUser.id,
      updated_by: appUser.id,
    }))
    const { error: stepError } = await supabase.from('sync_run_steps').insert(stepPayload)
    if (stepError) {
      return respond(500, { success: false, message: 'Falha ao gravar etapas da sincronizacao.' })
    }
  }

  const alerts = Array.isArray(body.alerts) ? body.alerts : []
  if (alerts.length > 0) {
    await supabase.from('sync_run_alerts').delete().eq('sync_uuid', syncUuid)
    const alertPayload = alerts.map((alert: Record<string, unknown>) => ({
      sync_uuid: syncUuid,
      tenant_id: appUser.tenant_id,
      severity: normalizeText(alert.severity, 'INFO'),
      alert_code: normalizeText(alert.alert_code) || null,
      title: normalizeText(alert.title, 'Aviso de sincronizacao'),
      message: normalizeText(alert.message) || null,
      payload: alert.payload ?? null,
      created_by: appUser.id,
      updated_by: appUser.id,
    }))
    const { error: alertError } = await supabase.from('sync_run_alerts').insert(alertPayload)
    if (alertError) {
      return respond(500, { success: false, message: 'Falha ao gravar avisos da sincronizacao.' })
    }
  }

  return respond(200, {
    success: true,
    message: 'Sincronizacao registrada com sucesso.',
    sync_uuid: syncUuid,
  })
})
