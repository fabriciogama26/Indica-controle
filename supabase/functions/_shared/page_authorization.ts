// _shared/page_authorization.ts
// Page + action authorization for Edge Functions using service-role client.
// Mirrors the logic of public.user_has_page_action() but operates without
// auth.uid() context — receives appUser explicitly.

type AppUserContext = {
  id: string
  tenant_id: string
  role_id: string | null
}

type PermissionRow = {
  can_access: boolean
  can_create: boolean
  can_update: boolean
  can_cancel: boolean
  can_reverse: boolean
  can_import: boolean
  can_export: boolean
}

export type PageAuthResult =
  | { allowed: true }
  | { allowed: false; status: 403 | 500; message: string }

// Maps action strings to app_user_page_permissions columns.
const ACTION_COLUMN: Record<string, keyof PermissionRow> = {
  read:    'can_access',
  create:  'can_create',
  update:  'can_update',
  cancel:  'can_cancel',
  reverse: 'can_reverse',
  import:  'can_import',
  export:  'can_export',
}

type SupabaseQueryBuilder = {
  select(columns: string): SupabaseQueryBuilder
  eq(column: string, value: string): SupabaseQueryBuilder
  maybeSingle(): Promise<{ data: unknown; error: unknown }>
}

type SupabaseLike = {
  from(table: string): SupabaseQueryBuilder
}

export async function requirePageAccess(
  supabase: SupabaseLike,
  appUser: AppUserContext,
  pageKey: string,
  action: string,
): Promise<PageAuthResult> {
  const actionColumn: keyof PermissionRow = ACTION_COLUMN[action] ?? 'can_access'

  // Admin short-circuit: check role first.
  if (appUser.role_id) {
    const { data: role, error: roleError } = await supabase
      .from('app_roles')
      .select('is_admin, ativo')
      .eq('id', appUser.role_id)
      .maybeSingle()

    if (roleError) {
      return { allowed: false, status: 500, message: 'Nao foi possivel validar a permissao.' }
    }

    const r = role as { ativo?: boolean; is_admin?: boolean } | null
    if (r?.ativo !== false && r?.is_admin === true) {
      return { allowed: true }
    }
  }

  // User-specific permission row — checks access AND the specific action column.
  const { data: userPerm, error: userPermError } = await supabase
    .from('app_user_page_permissions')
    .select('can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export')
    .eq('tenant_id', appUser.tenant_id)
    .eq('user_id', appUser.id)
    .eq('page_key', pageKey)
    .maybeSingle()

  if (userPermError) {
    return { allowed: false, status: 500, message: 'Nao foi possivel validar a permissao.' }
  }

  if (userPerm) {
    const p = userPerm as PermissionRow
    const granted = p.can_access === true && p[actionColumn] === true
    return granted
      ? { allowed: true }
      : { allowed: false, status: 403, message: `Permissao insuficiente para ${action} em ${pageKey}.` }
  }

  // No user-specific row: deny by default (conservative).
  return { allowed: false, status: 403, message: `Acesso negado para ${action} em ${pageKey}.` }
}

// Verifies that the tenant is active. Call after resolving appUser.
export async function requireActiveTenant(
  supabase: SupabaseLike,
  tenantId: string,
): Promise<{ active: true } | { active: false; status: 403 | 500; message: string }> {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('ativo')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) {
    return { active: false, status: 500, message: 'Nao foi possivel verificar o tenant.' }
  }

  const t = tenant as { ativo?: boolean } | null
  if (!t || t.ativo === false) {
    return { active: false, status: 403, message: 'Tenant inativo.' }
  }

  return { active: true }
}
