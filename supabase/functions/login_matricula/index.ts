// Edge Function: login_matricula
// Login por matricula + IMEI, com auditoria.
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

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const supabaseAuth = createClient(supabaseUrl, serviceRoleKey, {
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

  const body = await req.json().catch(() => ({}))
  const matricula = String(body.matricula ?? '').trim()
  const senha = String(body.senha ?? '')
  const imei = String(body.imei ?? '').trim()
  const source = String(body.source ?? 'APP')
  const skipImeiCheck = Boolean(body.skip_imei_check)

  if (!matricula || !senha || !imei) {
    return respond(400, { success: false, message: 'Informe matricula, senha e IMEI.' })
  }

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('app_users')
    .select('id, email, role_id, tenant_id, ativo')
    .eq('matricula', matricula)
    .maybeSingle()

  if (userErr || !userRow?.email) {
    await supabaseAdmin.from('login_audit').insert({
      user_id: null,
      tenant_id: null,
      source,
      status: 'FAILED',
      reason: 'USER_NOT_FOUND',
      matricula,
      device_imei: imei,
    })
    return respond(401, { success: false, message: 'Login ou senha invalidos.' })
  }

  if (userRow.ativo === false) {
    await supabaseAdmin.from('login_audit').insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      source,
      status: 'FAILED',
      reason: 'INACTIVE',
      matricula,
      device_imei: imei,
      created_by: userRow.id,
      updated_by: userRow.id,
    })
    return respond(403, { success: false, message: 'Usuario inativo.' })
  }

  if (!skipImeiCheck) {
    const { data: imeiRow } = await supabaseAdmin
      .from('imei_whitelist')
      .select('id, ativo')
      .eq('tenant_id', userRow.tenant_id)
      .eq('imei', imei)
      .maybeSingle()

    if (!imeiRow || imeiRow.ativo === false) {
      await supabaseAdmin.from('login_audit').insert({
        user_id: userRow.id,
        tenant_id: userRow.tenant_id,
        source,
        status: 'FAILED',
        reason: 'IMEI_BLOCKED',
        matricula,
        device_imei: imei,
        created_by: userRow.id,
        updated_by: userRow.id,
      })
      return respond(403, { success: false, message: 'IMEI nao autorizado.' })
    }
  }

  const { data, error: signInError } = await supabaseAuth.auth.signInWithPassword({
    email: userRow.email,
    password: senha,
  })

  if (signInError || !data?.session?.access_token) {
    await supabaseAdmin.from('login_audit').insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      source,
      status: 'FAILED',
      reason: 'AUTH_INVALID',
      matricula,
      device_imei: imei,
      created_by: userRow.id,
      updated_by: userRow.id,
    })
    return respond(401, { success: false, message: 'Login ou senha invalidos.' })
  }

  const { data: roleRow } = await supabaseAdmin
    .from('app_roles')
    .select('id, role_key')
    .eq('id', userRow.role_id)
    .maybeSingle()

  const { data: auditRow } = await supabaseAdmin
    .from('login_audit')
    .insert({
      user_id: userRow.id,
      tenant_id: userRow.tenant_id,
      source,
      status: 'SUCCESS',
      matricula,
      device_imei: imei,
      created_by: userRow.id,
      updated_by: userRow.id,
    })
    .select('id')
    .maybeSingle()

  return respond(200, {
    success: true,
    message: 'OK',
    access_token: data.session.access_token,
    user_id: userRow.id,
    role: roleRow?.role_key ?? 'user',
    role_id: userRow.role_id,
    tenant_id: userRow.tenant_id,
    login_audit_id: auditRow?.id ?? null,
  })
})
