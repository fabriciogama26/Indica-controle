"use client";

import Image from "next/image";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { consumeAuthFeedback, requestPasswordRecovery } from "@/services/auth/auth.service";
import styles from "./LoginPageView.module.css";

export function LoginPageView() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useAuth();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: () => login({ loginName, password }),
    onSuccess: (result) => {
      if (result.success) {
        router.replace("/home");
        return;
      }
      setFeedback(result.message);
    },
    onError: () => {
      setFeedback("Falha ao autenticar. Verifique a configuracao do ambiente.");
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: () => requestPasswordRecovery(loginName),
    onSuccess: (result) => {
      setFeedback(result.message);
    },
    onError: () => {
      setFeedback("Falha ao solicitar a recuperacao de senha.");
    },
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/home");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    const authFeedback = consumeAuthFeedback();
    if (authFeedback) {
      const timeoutId = window.setTimeout(() => {
        setFeedback(authFeedback);
      }, 0);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    loginMutation.mutate();
  }

  function handleRecoveryClick() {
    if (!loginName.trim()) {
      setFeedback("Informe seu login para enviar o email de recuperacao.");
      return;
    }

    setFeedback(null);
    recoveryMutation.mutate();
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.logoOrbit}>
          <div className={styles.logoCircle}>
            <Image
              src="/indica.png"
              alt="INDICA - SERVICOS"
              width={184}
              height={184}
              className={styles.logoImage}
              priority
            />
          </div>
        </div>

        <div className={styles.cardContent}>
          <h1 className={styles.title}>Bem-vindo de volta.</h1>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>Login</span>
              <input
                type="text"
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                placeholder="Digite seu login"
                autoComplete="username"
                required
              />
            </label>

            <label className={styles.field}>
              <span>Senha</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Informe sua senha"
                autoComplete="current-password"
                required
              />
            </label>

            <button
              type="button"
              className={styles.recoveryLink}
              onClick={handleRecoveryClick}
              disabled={recoveryMutation.isPending}
            >
              {recoveryMutation.isPending ? "Enviando recuperacao..." : "Esqueci minha senha"}
            </button>

            {feedback ? <div className={styles.errorBox}>{feedback}</div> : null}

            <button type="submit" className={styles.submitButton} disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className={styles.footerBlock}>
            <p>Registre cada movimentacao. Tenha controle total das informacoes.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
