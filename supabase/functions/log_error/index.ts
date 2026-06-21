// Edge Function: log_error
// Persists application errors for the authenticated tenant.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const respond = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), { status, headers: corsHeaders })

const getBearerToken = (req: Request) => {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.substring(7).trim()
}

const safeText = (value: unknown, fallback = '') => {
  const text = String(value ?? '').trim()
  return text || fallback
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

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('id, tenant_id, matricula, ativo')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (appUserError || !appUser?.id || appUser.ativo === false) {
    return respond(403, { success: false, message: 'Usuario sem permissao.' })
  }

  const body = await req.json().catch(() => ({}))
  const { error } = await supabase
    .from('app_error_logs')
    .insert({
      tenant_id: appUser.tenant_id,
      user_id: appUser.id,
      matricula: safeText(body.matricula, appUser.matricula),
      source: safeText(body.source, 'APP'),
      device_imei: safeText(body.device_imei),
      severity: safeText(body.severity, 'ERROR'),
      screen: safeText(body.screen),
      message: safeText(body.message, 'Erro sem mensagem'),
      stacktrace: safeText(body.stacktrace),
      context: body,
      created_by: appUser.id,
      updated_by: appUser.id,
    })

  if (error) {
    return respond(500, { success: false, message: 'Falha ao registrar erro.' })
  }

  return respond(200, { success: true, message: 'Erro registrado.' })
})
