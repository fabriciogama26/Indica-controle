export type AuthMode = "local" | "remote";

export type AuthUser = {
  userId: string;
  role: string;
  roleId: string | null;
  tenantId: string;
  loginName: string;
  displayName?: string | null;
  pageAccess: string[];
  hasCustomPermissions: boolean;
  loginAuditId: string | null;
  sessionRef: string | null;
};

export type AuthSession = {
  source: AuthMode;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number | null;
  tokenType: string;
  user: AuthUser;
};

export type LoginPayload = {
  loginName: string;
  password: string;
};

export type LoginResponse = {
  success: boolean;
  message: string;
  session?: AuthSession;
};
