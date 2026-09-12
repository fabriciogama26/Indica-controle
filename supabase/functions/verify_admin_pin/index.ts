// Edge Function: verify_admin_pin
// Validates admin PIN for the authenticated app user.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/http.ts'


const respond = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders })

const getBearerToken = (req: Request) => {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.substring(7).trim()
}

const sha256Hex = async (value: string) => {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond(405, { success: false, message: 'method_not_allowed' })

  const accessToken = getBearerToken(req)
  if (!accessToken) return respond(401, { success: false, message: 'Nao autenticado.' })

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData?.user?.id) return respond(401, { success: false, message: 'Sessao invalida.' })

  const body = await req.json().catch(() => ({}))
  const userId = String(body.user_id ?? '').trim()
  const pin = String(body.pin ?? '').trim()
  if (!userId || !pin) return respond(400, { success: false, message: 'Informe user_id e pin.' })

  // Rate limit ANTES de qualquer consulta. Sem isto, o espaco de um PIN de 4 a
  // 6 digitos e percorrido em minutos: a funcao respondia 200 com
  // success:false, sem contador e sem bloqueio, entao nada encarecia a
  // tentativa seguinte. A chave e (auth_user_id | user_id alvo), nao o IP --
  // quem chama ja esta autenticado, e id de sessao nao se troca a cada request
  // como um header de IP.
  const { data: rateData, error: rateError } = await supabase.rpc('rate_limit_check_and_hit', {
    p_scope: 'auth',
    p_route: 'auth.admin_pin',
    p_identity_hash: await sha256Hex(`${authData.user.id}|${userId}`),
    p_owner_id: null,
    p_ip_hash: null,
    p_max_hits: 5,
    p_window_seconds: 300,
  })

  if (rateError) {
    return respond(500, { success: false, message: 'Falha ao validar limite de requisicoes.' })
  }

  const rateResult = Array.isArray(rateData) ? rateData[0] : rateData
  if (rateResult?.allowed === false) {
    const retryAfterSeconds = Number(rateResult.retry_after) || 300
    return respond(429, {
      success: false,
      message: `Muitas tentativas. Tente novamente em ${retryAfterSeconds} segundos.`,
    })
  }

  const { data: appUser, error } = await supabase
    .from('app_users')
    .select('id, tenant_id, role_id, ativo')
    .eq('auth_user_id', authData.user.id)
    .eq('id', userId)
    .maybeSingle()

  if (error || !appUser?.id || appUser.ativo === false) {
    return respond(403, { success: false, message: 'Usuario sem permissao.' })
  }

  const { data: roleRow } = await supabase
    .from('app_roles')
    .select('id, role_key, is_admin')
    .eq('id', appUser.role_id)
    .maybeSingle()

  if (!roleRow?.is_admin) {
    return respond(403, { success: false, message: 'Acesso restrito a administradores.' })
  }

  // A comparacao acontece dentro do banco: o hash nunca sai da tabela, o bcrypt
  // compara em tempo constante e a RPC revalida vinculo e papel por conta
  // propria (migration 395). Continuamos enviando o SHA-256, nunca o PIN em
  // claro -- e por isso o contrato HTTP desta funcao nao muda.
  const { data: verified, error: verifyError } = await supabase.rpc('verify_admin_pin_secret', {
    p_auth_user_id: authData.user.id,
    p_app_user_id: appUser.id,
    p_pin_sha256: await sha256Hex(pin),
  })

  if (verifyError) {
    return respond(500, { success: false, message: 'Falha ao validar PIN.' })
  }

  if (verified !== true) {
    // Tentativa falha vira trilha: antes nao havia registro nenhum de forca
    // bruta contra o PIN. Falha de auditoria nao derruba a resposta.
    await supabase.from('login_audit').insert({
      user_id: appUser.id,
      tenant_id: appUser.tenant_id,
      event_type: 'ADMIN_PIN',
      event_at: new Date().toISOString(),
      status: 'FAILED',
      reason: 'PIN_INVALID',
      source: 'APP',
      created_by: appUser.id,
      updated_by: appUser.id,
    })

    return respond(200, { success: false, message: 'PIN invalido.' })
  }

  return respond(200, { success: true, message: 'OK' })
})
