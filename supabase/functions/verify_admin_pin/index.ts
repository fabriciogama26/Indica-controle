// Edge Function: verify_admin_pin
// Validates admin PIN for the authenticated app user.

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

  const { data: appUser, error } = await supabase
    .from('app_users')
    .select('id, tenant_id, role_id, ativo, admin_pin_hash')
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

  const expectedHash = String(appUser.admin_pin_hash ?? '').trim().toLowerCase()
  if (!expectedHash) {
    return respond(403, { success: false, message: 'PIN admin nao configurado.' })
  }

  const incomingHash = await sha256Hex(pin)
  if (incomingHash !== expectedHash) {
    return respond(200, { success: false, message: 'PIN invalido.' })
  }

  return respond(200, { success: true, message: 'OK' })
})
