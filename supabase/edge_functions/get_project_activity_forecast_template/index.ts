// Edge Function: get_project_activity_forecast_template
// Returns XLSX template for project activity forecast import (codigo, quantidade).

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const getBearerToken = (req: Request) => {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.substring(7).trim()
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

function buildWorkbookArrayBuffer() {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['codigo', 'quantidade'],
    ['ATV-001', '1'],
  ])

  worksheet['!cols'] = [{ wch: 22 }, { wch: 22 }]
  XLSX.utils.book_append_sheet(workbook, worksheet, 'AtividadesPrevistas')

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const accessToken = getBearerToken(req)
  if (!accessToken) {
    return new Response(JSON.stringify({ success: false, message: 'Nao autenticado.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData?.user?.id) {
    return new Response(JSON.stringify({ success: false, message: 'Sessao invalida.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('tenant_id, ativo')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (appUserError || !appUser?.tenant_id || appUser.ativo === false) {
    return new Response(JSON.stringify({ success: false, message: 'Usuario sem permissao.' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const arrayBuffer = buildWorkbookArrayBuffer()
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo_atividades_previstas.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
})
