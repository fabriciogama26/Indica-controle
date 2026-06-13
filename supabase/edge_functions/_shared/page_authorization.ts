type AppUserPageContext = {
  id: string
  tenant_id: string
  role_id: string | null
}

type PageAuthorizationResult =
  | { allowed: true }
  | { allowed: false; status: 403 | 500; message: string }

type QueryResult = {
  data: unknown
  error: unknown
}

type QueryBuilder = {
  select: (columns: string) => QueryBuilder
  eq: (column: string, value: unknown) => QueryBuilder
  maybeSingle: () => Promise<QueryResult>
}

type PageAuthorizationClient = {
  from: (table: string) => QueryBuilder
}

export async function requirePageAccess(
  supabaseClient: unknown,
  appUser: AppUserPageContext,
  pageKey: string,
  action: string
): Promise<PageAuthorizationResult> {
  const supabase = supabaseClient as PageAuthorizationClient

  if (appUser.role_id) {
    const { data: role, error: roleError } = await supabase
      .from('app_roles')
      .select('is_admin, ativo')
      .eq('id', appUser.role_id)
      .maybeSingle()

    if (roleError) {
      return { allowed: false, status: 500, message: 'Nao foi possivel validar a permissao da importacao.' }
    }

    const roleRecord = role as { ativo?: boolean; is_admin?: boolean } | null
    if (roleRecord?.ativo !== false && roleRecord?.is_admin === true) {
      return { allowed: true }
    }
  }

  const { data: userPermission, error: userPermissionError } = await supabase
    .from('app_user_page_permissions')
    .select('can_access')
    .eq('tenant_id', appUser.tenant_id)
    .eq('user_id', appUser.id)
    .eq('page_key', pageKey)
    .maybeSingle()

  if (userPermissionError) {
    return { allowed: false, status: 500, message: 'Nao foi possivel validar a permissao da importacao.' }
  }

  const userPermissionRecord = userPermission as { can_access?: boolean } | null
  if (userPermissionRecord) {
    return userPermissionRecord.can_access === true
      ? { allowed: true }
      : { allowed: false, status: 403, message: `Acesso negado para executar ${action} em ${pageKey}.` }
  }

  if (!appUser.role_id) {
    return { allowed: false, status: 403, message: `Acesso negado para executar ${action} em ${pageKey}.` }
  }

  const { data: rolePermission, error: rolePermissionError } = await supabase
    .from('role_page_permissions')
    .select('can_access')
    .eq('tenant_id', appUser.tenant_id)
    .eq('role_id', appUser.role_id)
    .eq('page_key', pageKey)
    .maybeSingle()

  if (rolePermissionError) {
    return { allowed: false, status: 500, message: 'Nao foi possivel validar a permissao da importacao.' }
  }

  const rolePermissionRecord = rolePermission as { can_access?: boolean } | null
  return rolePermissionRecord?.can_access === true
    ? { allowed: true }
    : { allowed: false, status: 403, message: `Acesso negado para executar ${action} em ${pageKey}.` }
}
