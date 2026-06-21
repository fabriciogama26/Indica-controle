// _shared/supabase.ts
// Shared Supabase service-role client for Edge Functions.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
