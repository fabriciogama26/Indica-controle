export type AuthMode = "local" | "remote";

export type AuthUser = {
  userId: string;
  role: string;
  tenantId: string;
  loginName: string;
  loginAuditId: string | null;
};

export type AuthSession = {
  source: AuthMode;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
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
