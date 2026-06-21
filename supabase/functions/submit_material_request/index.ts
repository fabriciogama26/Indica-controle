// Edge Function: submit_material_request
// Authenticates the caller, applies server-side rate limit, and delegates stock logic to the RPC submit_requisicao.
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

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

async function applyAuditTrail(
  tenantId: string,
  actorUserId: string,
  clientRequestId: string,
  projeto: string,
  itens: Array<Record<string, unknown>>,
  requisicaoId: string | null,
  rejected: boolean,
) {
  const codigos = itens
    .map((item) => normalizeText(item.codigo))
    .filter((codigo) => codigo.length > 0)

  let materialIds: string[] = []
  if (codigos.length > 0) {
    const { data: materials } = await supabase
      .from('materials')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('codigo', codigos)
    materialIds = (materials ?? []).map((item: { id: string }) => item.id)
  }

  if (requisicaoId) {
    await supabase
      .from('requisicoes')
      .update({ created_by: actorUserId, updated_by: actorUserId })
      .eq('id', requisicaoId)
      .eq('tenant_id', tenantId)

    await supabase
      .from('requisicao_itens')
      .update({ created_by: actorUserId, updated_by: actorUserId })
      .eq('requisicao_id', requisicaoId)
      .eq('tenant_id', tenantId)
  }

  await supabase
    .from('stock_movements')
    .update({ created_by: actorUserId, updated_by: actorUserId })
    .eq('request_id', clientRequestId)
    .eq('tenant_id', tenantId)

  if (rejected) {
    await supabase
      .from('stock_conflicts')
      .update({ created_by: actorUserId, updated_by: actorUserId })
      .eq('request_id', clientRequestId)
      .eq('tenant_id', tenantId)

    const { data: conflicts } = await supabase
      .from('stock_conflicts')
      .select('id')
      .eq('request_id', clientRequestId)
      .eq('tenant_id', tenantId)

    const conflictIds = (conflicts ?? []).map((item: { id: string }) => item.id)
    if (conflictIds.length > 0) {
      await supabase
        .from('stock_conflict_items')
        .update({ created_by: actorUserId, updated_by: actorUserId })
        .in('conflict_id', conflictIds)
        .eq('tenant_id', tenantId)
    }
  }

  if (materialIds.length > 0) {
    await supabase
      .from('inventory_balance')
      .update({ created_by: actorUserId, updated_by: actorUserId })
      .eq('tenant_id', tenantId)
      .in('material_id', materialIds)

    if (projeto) {
      await supabase
        .from('project_material_balance')
        .update({ created_by: actorUserId, updated_by: actorUserId })
        .eq('tenant_id', tenantId)
        .eq('projeto', projeto)
        .in('material_id', materialIds)
    }
  }
}

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
    return respond(403, { success: false, message: 'Usuario sem permissao para movimentar material.' })
  }

  const body = await req.json().catch(() => ({}))
  const clientRequestId = normalizeText(body.client_request_id)
  const deviceId = normalizeText(body.device_id, 'N/A')
  const projeto = normalizeText(body.projeto).toUpperCase()
  const itens = Array.isArray(body.itens) ? body.itens : []

  if (!clientRequestId) {
    return respond(400, { success: false, message: 'client_request_id obrigatorio.' })
  }

  if (itens.length === 0) {
    return respond(400, { success: false, message: 'Informe ao menos um item para movimentar.' })
  }

  const ip = getClientIp(req) || 'unknown'
  const identityHash = await sha256Hex(`${appUser.tenant_id}|${appUser.id}|${deviceId}`)
  const ipHash = await sha256Hex(ip)
  const { data: rateData, error: rateError } = await supabase.rpc('rate_limit_check_and_hit', {
    p_scope: 'materials',
    p_route: 'submit_material_request',
    p_identity_hash: identityHash,
    p_owner_id: appUser.id,
    p_ip_hash: ipHash,
    p_max_hits: 20,
    p_window_seconds: 60,
  })

  if (rateError) {
    return respond(500, { success: false, message: 'Falha ao validar rate limit.' })
  }

  const rateResult = Array.isArray(rateData) ? rateData[0] : rateData
  if (rateResult?.allowed === false) {
    const retryAfterSeconds = Number(rateResult.retry_after) || 60
    return respond(
      429,
      {
        success: false,
        message: `Limite de requisicoes excedido. Aguarde ${retryAfterSeconds} segundos.`,
        retry_after: retryAfterSeconds,
      },
      { 'Retry-After': String(retryAfterSeconds) }
    )
  }

  const { data, error } = await supabase.rpc('submit_requisicao', {
    p_client_request_id: clientRequestId,
    p_requisitor: normalizeText(body.requisitor),
    p_projeto: projeto,
    p_usuario: normalizeText(body.usuario),
    p_data: normalizeText(body.data),
    p_tipo_operacao: normalizeText(body.tipo_operacao),
    p_observacao: normalizeText(body.observacao),
    p_origem: normalizeText(body.origem, 'APP'),
    p_device_id: deviceId,
    p_tenant_id: appUser.tenant_id,
    p_itens: itens,
  })

  if (error) {
    return respond(500, { success: false, message: 'Falha ao aplicar movimentacao de materiais.' })
  }

  const result = data as Record<string, unknown> | null
  const status = String(result?.status ?? '')
  const reason = String(result?.reason ?? '')
  const requisicaoId = result?.requisicao_id ? String(result.requisicao_id) : null

  if (status === 'APPLIED' || status === 'ALREADY_APPLIED') {
    await applyAuditTrail(appUser.tenant_id, appUser.id, clientRequestId, projeto, itens, requisicaoId, false)
    return respond(200, {
      success: true,
      message: status === 'APPLIED' ? 'Movimentacao aplicada com sucesso.' : 'Movimentacao ja aplicada anteriormente.',
      result,
    })
  }

  if (status === 'REJECTED') {
    await applyAuditTrail(appUser.tenant_id, appUser.id, clientRequestId, projeto, itens, requisicaoId, true)
    return respond(409, {
      success: false,
      message: 'Movimentacao rejeitada.',
      reason,
      result,
    })
  }

  return respond(200, {
    success: true,
    message: 'Operacao processada.',
    result,
  })
})
