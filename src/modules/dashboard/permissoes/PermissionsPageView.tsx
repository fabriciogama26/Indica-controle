"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./PermissionsPageView.module.css";

type PermissionCard = {
  pageKey: string;
  label: string;
  path: string;
  section: string;
  enabled: boolean;
};

type RoleOption = {
  value: string;
  label: string;
};

type UserStatus = "Ativo" | "Inativo";

type PermissionSnapshot = {
  pageKey: string;
  enabled: boolean;
};

type TenantUser = {
  id: string;
  loginName: string;
  matricula: string | null;
  role: string;
  roleLabel: string;
  status: UserStatus;
  tenantId: string;
  canInvite?: boolean;
  updatedAt?: string | null;
};

const roleOptions: RoleOption[] = [
  { value: "master", label: "Master" },
  { value: "admin", label: "Admin" },
  { value: "supervisor", label: "Supervisor" },
  { value: "viewer", label: "Viewer" },
  { value: "user", label: "User" },
];

// Checklist obrigatorio para nova tela:
// 1) Criar migration com app_pages + role_page_permissions + app_user_page_permissions (backfill por tenant).
// 2) Incluir pageKey/path/section no catalogo abaixo.
// 3) Atualizar menuSections/titleMap no AppShell para manter navegacao e titulo consistentes.
const permissionCatalog = [
  { pageKey: "home", label: "Dashboard Estoque", path: "/home", section: "Visao Geral" },
  { pageKey: "dashboard-medicao", label: "Dashboard Medicao", path: "/dashboard-medicao", section: "Visao Geral" },
  { pageKey: "projetos", label: "Projetos", path: "/projetos", section: "Operacao" },
  { pageKey: "locacao", label: "Locacao", path: "/locacao", section: "Operacao" },
  { pageKey: "programacao-simples", label: "Programacao", path: "/programacao-simples", section: "Operacao" },
  {
    pageKey: "programacao-visualizacao",
    label: "Visualizacao Programacao",
    path: "/programacao-visualizacao",
    section: "Operacao",
  },
  { pageKey: "medicao", label: "Medicao", path: "/medicao", section: "Operacao" },
  { pageKey: "estoque", label: "Estoque Atual", path: "/estoque", section: "Almoxarifado" },
  { pageKey: "posicao-trafo", label: "Rastreio de TRAFO", path: "/posicao-trafo", section: "Almoxarifado" },
  { pageKey: "entrada", label: "Movimentacao de Estoque", path: "/entrada", section: "Almoxarifado" },
  { pageKey: "saida", label: "Operacoes de Equipe", path: "/saida", section: "Almoxarifado" },
  { pageKey: "materiais", label: "Materiais", path: "/materiais", section: "Cadastros" },
  { pageKey: "pessoas", label: "Pessoas", path: "/pessoas", section: "Cadastros" },
  { pageKey: "cargo", label: "Cargo", path: "/cargo", section: "Cadastros" },
  { pageKey: "equipes", label: "Equipes", path: "/equipes", section: "Cadastros" },
  { pageKey: "atividades", label: "Atividades", path: "/atividades", section: "Cadastros" },
  { pageKey: "meta", label: "Meta", path: "/meta", section: "Cadastros" },
  { pageKey: "prioridade", label: "Prioridade", path: "/prioridade", section: "Cadastro Base" },
  { pageKey: "centro-servico", label: "Centro de Servico", path: "/centro-servico", section: "Cadastro Base" },
  { pageKey: "contrato", label: "Contrato", path: "/contrato", section: "Cadastro Base" },
  { pageKey: "tipo-equipe", label: "Tipo de Equipe", path: "/tipo-equipe", section: "Cadastro Base" },
  { pageKey: "imei", label: "Imei", path: "/imei", section: "Cadastro Base" },
  { pageKey: "tipo-servico", label: "Tipo de Servico", path: "/tipo-servico", section: "Cadastro Base" },
  { pageKey: "nivel-tensao", label: "Nivel de Tensao", path: "/nivel-tensao", section: "Cadastro Base" },
  { pageKey: "porte", label: "Porte", path: "/porte", section: "Cadastro Base" },
  {
    pageKey: "responsavel-distribuidora",
    label: "Responsavel Distribuidora",
    path: "/responsavel-distribuidora",
    section: "Cadastro Base",
  },
  { pageKey: "municipio", label: "Municipio", path: "/municipio", section: "Cadastro Base" },
] as const;

function createPermissionSet(role: string): PermissionCard[] {
  const defaultPageAccess = [
    "home",
    "dashboard-medicao",
    "projetos",
    "locacao",
    "programacao-simples",
    "programacao-visualizacao",
    "medicao",
    "meta",
    "estoque",
    "posicao-trafo",
    "entrada",
    "saida",
    "materiais",
    "pessoas",
    "cargo",
    "equipes",
    "prioridade",
    "centro-servico",
    "contrato",
    "atividades",
    "tipo-equipe",
    "imei",
    "tipo-servico",
    "nivel-tensao",
    "porte",
    "responsavel-distribuidora",
    "municipio",
  ];

  return permissionCatalog.map((item) => {
    if (role === "master" || role === "admin") {
      return { ...item, enabled: true };
    }

    if (role === "supervisor") {
      return { ...item, enabled: defaultPageAccess.includes(item.pageKey) };
    }

    if (role === "viewer") {
      return {
        ...item,
        enabled: ["home", "estoque", "posicao-trafo"].includes(item.pageKey),
      };
    }

    return {
      ...item,
      enabled: defaultPageAccess.includes(item.pageKey),
    };
  });
}

function applyPermissionSnapshot(role: string, snapshots: PermissionSnapshot[]) {
  const base = createPermissionSet(role);
  if (snapshots.length === 0) {
    return base;
  }

  const snapshotMap = new Map(snapshots.map((item) => [item.pageKey, item.enabled]));
  return base.map((permission) => ({
    ...permission,
    enabled: snapshotMap.has(permission.pageKey) ? Boolean(snapshotMap.get(permission.pageKey)) : false,
  }));
}

export function PermissionsPageView() {
  const { session } = useAuth();
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<TenantUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<TenantUser | null>(null);
  const [selectedRole, setSelectedRole] = useState("");
  const [status, setStatus] = useState<UserStatus>("Ativo");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [permissions, setPermissions] = useState<PermissionCard[]>(() => createPermissionSet("user"));
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isLoadingSelectedUser, setIsLoadingSelectedUser] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInviting, setIsInviting] = useState(false);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    const normalized = searchValue.trim();
    if (!isSearchActive || normalized.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);

      try {
        const response = await fetch(`/api/app-users/search?q=${encodeURIComponent(normalized)}`, {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
          signal: controller.signal,
        });

        const data = (await response.json().catch(() => ({}))) as {
          users?: TenantUser[];
          message?: string;
        };

        if (!response.ok) {
          setSearchResults([]);
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao buscar usuarios do tenant.",
          });
          return;
        }

        setSearchResults(data.users ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSearchResults([]);
          setFeedback({
            type: "error",
            message: "Falha ao buscar usuarios do tenant.",
          });
        }
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [isSearchActive, searchValue, session?.accessToken]);

  const groupedPermissions = useMemo(() => {
    return permissions.reduce<Record<string, PermissionCard[]>>((accumulator, permission) => {
      if (!accumulator[permission.section]) {
        accumulator[permission.section] = [];
      }

      accumulator[permission.section].push(permission);
      return accumulator;
    }, {});
  }, [permissions]);

  const releasedScreens = useMemo(() => permissions.filter((permission) => permission.enabled).length, [permissions]);
  const showResults = isSearchActive && searchValue.trim().length >= 2 && (isSearching || searchResults.length > 0);

  async function applyUser(user: TenantUser) {
    setSelectedUser(user);
    setSearchValue(user.loginName);
    setSearchResults([]);
    setIsSearchActive(false);
    setSelectedRole(user.role);
    setStatus(user.status);
    setPermissions(createPermissionSet(user.role));
    setFeedback(null);

    if (!session?.accessToken) {
      return;
    }

    setIsLoadingSelectedUser(true);

    try {
      const response = await fetch(`/api/app-users/${user.id}/permissions`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as {
        user?: TenantUser;
        permissions?: PermissionSnapshot[];
        message?: string;
      };

      if (!response.ok || !data.user) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar credenciais do usuario.",
        });
        return;
      }

      setSelectedUser(data.user);
      setSelectedRole(data.user.role);
      setStatus(data.user.status);
      setPermissions(applyPermissionSnapshot(data.user.role, data.permissions ?? []));
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao carregar credenciais do usuario.",
      });
    } finally {
      setIsLoadingSelectedUser(false);
    }
  }

  function handleRoleChange(role: string) {
    setSelectedRole(role);
    setPermissions(createPermissionSet(role));
    setFeedback(null);
  }

  function updatePermission(pageKey: string, enabled: boolean) {
    if (!selectedUser) {
      return;
    }

    setPermissions((current) =>
      current.map((permission) =>
        permission.pageKey === pageKey
          ? {
              ...permission,
              enabled,
            }
          : permission,
      ),
    );
    setFeedback(null);
  }

  async function handleSave() {
    if (!selectedUser) {
      setFeedback({ type: "error", message: "Selecione um usuario do tenant antes de salvar." });
      return;
    }

    if (!selectedRole) {
      setFeedback({ type: "error", message: "Selecione o role do usuario antes de salvar." });
      return;
    }

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para salvar as credenciais." });
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`/api/app-users/${selectedUser.id}/permissions`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          role: selectedRole,
          status,
          expectedUpdatedAt: selectedUser.updatedAt ?? null,
          permissions: permissions.map((permission) => ({
            pageKey: permission.pageKey,
            enabled: permission.enabled,
          })),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        code?: string;
        updatedAt?: string;
      };

      if (!response.ok || !data.success) {
        if (data.code === "CONCURRENT_MODIFICATION") {
          await applyUser(selectedUser);
        }

        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao salvar as credenciais do usuario.",
        });
        return;
      }

      setSelectedUser((current) =>
        current
          ? {
              ...current,
              role: selectedRole,
              status,
              updatedAt: data.updatedAt ?? current.updatedAt ?? null,
            }
          : current,
      );

      setFeedback({
        type: "success",
        message:
          data.message ??
          (selectedUser.id === session?.user.userId
            ? "Credencial atualizada com sucesso. Entre novamente para aplicar as mudancas na sua sessao."
            : "Credencial atualizada com sucesso."),
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao salvar as credenciais do usuario.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleInvite() {
    if (!selectedUser) {
      setFeedback({ type: "error", message: "Selecione um usuario antes de enviar o convite." });
      return;
    }

    if (!selectedUser.canInvite) {
      setFeedback({ type: "error", message: "Usuario ja vinculado ao Auth ou sem email para convite." });
      return;
    }

    if (!session?.accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para enviar o convite." });
      return;
    }

    setIsInviting(true);

    try {
      const response = await fetch(`/api/app-users/${selectedUser.id}/invite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };

      if (!response.ok || !data.success) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao enviar convite do usuario.",
        });
        return;
      }

      setSelectedUser((current) => (current ? { ...current, canInvite: false } : current));
      setFeedback({
        type: "success",
        message: data.message ?? "Convite enviado com sucesso.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "Falha ao enviar convite do usuario.",
      });
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.iconBadge}>
            <svg viewBox="0 0 24 24" fill="none" className={styles.headerIcon} aria-hidden="true">
              <path
                d="M12 3.75 5.25 6.75v5.1c0 4.35 2.97 8.4 6.75 9.15 3.78-.75 6.75-4.8 6.75-9.15v-5.1L12 3.75Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="m9.75 12 1.5 1.5 3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div>
            <h2 className={styles.title}>Credenciais e Permissoes</h2>
            <p className={styles.description}>Pesquise um usuario do tenant atual e defina quais telas ele pode visualizar.</p>
          </div>
        </div>

        <button type="button" className={styles.historyButton}>
          Historico
        </button>
      </header>

      <article className={styles.topCard}>
        <label className={styles.field}>
          <span>Usuario</span>
          <input
            type="text"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value);
              setIsSearchActive(true);
              setFeedback(null);
            }}
            placeholder="Digite login_name ou matricula"
          />
          {showResults ? (
            <div className={styles.searchResults}>
              {isSearching ? <div className={styles.searchStatus}>Buscando usuarios do tenant...</div> : null}
              {!isSearching && searchResults.length > 0
                ? searchResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className={selectedUser?.id === user.id ? styles.searchResultActive : styles.searchResult}
                      onClick={() => applyUser(user)}
                    >
                      <strong>{user.loginName}</strong>
                      <span>{user.matricula ? `Matricula: ${user.matricula}` : "Matricula nao informada"}</span>
                    </button>
                  ))
                : null}
            </div>
          ) : isSearchActive && searchValue.trim().length >= 2 && !isSearching ? (
            <div className={styles.searchEmpty}>Nenhum usuario encontrado no tenant para o filtro informado.</div>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>Role</span>
          <select value={selectedRole} onChange={(event) => handleRoleChange(event.target.value)} disabled={!selectedUser}>
            <option value="" disabled>
              Selecione
            </option>
            {roleOptions.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.statusField}>
          <span>Status</span>
          <button
            type="button"
            className={status === "Ativo" ? styles.statusToggleActive : styles.statusToggleInactive}
            onClick={() => setStatus((current) => (current === "Ativo" ? "Inativo" : "Ativo"))}
            aria-pressed={status === "Ativo"}
            disabled={!selectedUser}
          >
            <span className={styles.toggleThumb} />
            <span>{status}</span>
          </button>
        </div>
      </article>

      <article className={styles.contextCard}>
        <span>Tenant: {selectedUser?.tenantId ?? session?.user.tenantId ?? "sem tenant"}</span>
        <span>{isLoadingSelectedUser ? "Carregando credenciais..." : `${releasedScreens} telas liberadas`}</span>
      </article>

      <section className={styles.permissionSections}>
        {Object.entries(groupedPermissions).map(([section, sectionPermissions]) => (
          <article key={section} className={styles.sectionBlock}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>{section}</h3>
              <span className={styles.sectionHint}>Se a tela estiver liberada, o usuario herda o pacote de permissao dela.</span>
            </div>

            <div className={styles.cardGrid}>
              {sectionPermissions.map((permission) => (
                <article key={permission.pageKey} className={styles.permissionCard}>
                  <div className={styles.permissionCardHead}>
                    <div>
                      <div className={styles.permissionTitle}>{permission.label}</div>
                      <div className={styles.permissionRoute}>{permission.path}</div>
                    </div>

                    <button
                      type="button"
                      className={permission.enabled ? styles.cardToggleActive : styles.cardToggleInactive}
                      onClick={() => updatePermission(permission.pageKey, !permission.enabled)}
                      aria-pressed={permission.enabled}
                      disabled={!selectedUser}
                    >
                      <span className={styles.toggleThumb} />
                      <span>{permission.enabled ? "Liberado" : "Bloqueado"}</span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>
        ))}
      </section>

      {feedback ? (
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <div className={styles.actionsFooter}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={handleInvite}
          disabled={!selectedUser || !selectedUser.canInvite || isInviting || isLoadingSelectedUser}
        >
          {isInviting ? "Enviando convite..." : "Enviar convite"}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleSave}
          disabled={!selectedUser || isSaving || isLoadingSelectedUser}
        >
          {isSaving ? "Salvando..." : "Salvar credencial"}
        </button>
      </div>
    </section>
  );
}
