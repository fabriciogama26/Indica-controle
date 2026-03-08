"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import {
  requestPasswordRecovery,
  resolvePasswordFlow,
  updatePassword,
} from "@/services/auth/auth.service";
import styles from "./RecoveryPasswordPageView.module.css";

type RecoveryStep = "loading" | "request" | "update";

export function RecoveryPasswordPageView() {
  const router = useRouter();
  const [step, setStep] = useState<RecoveryStep>("loading");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function hydrateFlow() {
      const result = await resolvePasswordFlow();
      if (!active) return;

      if (!result.success) {
        setFeedback(result.message);
      }

      setStep(result.mode);
    }

    hydrateFlow();

    return () => {
      active = false;
    };
  }, []);

  const recoveryMutation = useMutation({
    mutationFn: () => requestPasswordRecovery(loginName),
    onSuccess: (result) => {
      setFeedback(result.message);
    },
    onError: () => {
      setFeedback("Falha ao solicitar a recuperacao de senha.");
    },
  });

  const updatePasswordMutation = useMutation({
    mutationFn: () => updatePassword(password),
    onSuccess: (result) => {
      setFeedback(result.message);
      if (result.success) {
        window.setTimeout(() => {
          router.replace("/login");
        }, 1200);
      }
    },
    onError: () => {
      setFeedback("Falha ao atualizar a senha.");
    },
  });

  function handleRecoverySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    recoveryMutation.mutate();
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (password.length < 8) {
      setFeedback("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setFeedback("As senhas nao conferem.");
      return;
    }

    updatePasswordMutation.mutate();
  }

  const isPending = recoveryMutation.isPending || updatePasswordMutation.isPending;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.cardContent}>
          <div className={styles.header}>
            <span className={styles.eyebrow}>Acesso</span>
            <h1 className={styles.title}>
              {step === "update" ? "Defina sua senha." : "Recupere sua senha."}
            </h1>
            <p className={styles.subtitle}>
              {step === "update"
                ? "Use esta tela para concluir o convite ou redefinir seu acesso."
                : "Informe seu login para receber o link de recuperacao no e-mail cadastrado."}
            </p>
          </div>

          {step === "loading" ? <p className={styles.statusText}>Validando o link de acesso...</p> : null}

          {step === "request" ? (
            <form className={styles.form} onSubmit={handleRecoverySubmit}>
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

              {feedback ? <div className={styles.infoBox}>{feedback}</div> : null}

              <button type="submit" className={styles.submitButton} disabled={isPending}>
                {recoveryMutation.isPending ? "Enviando..." : "Enviar link"}
              </button>
            </form>
          ) : null}

          {step === "update" ? (
            <form className={styles.form} onSubmit={handlePasswordSubmit}>
              <label className={styles.field}>
                <span>Nova senha</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Informe sua nova senha"
                  autoComplete="new-password"
                  required
                />
              </label>

              <label className={styles.field}>
                <span>Confirmar senha</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repita a senha"
                  autoComplete="new-password"
                  required
                />
              </label>

              {feedback ? <div className={styles.infoBox}>{feedback}</div> : null}

              <button type="submit" className={styles.submitButton} disabled={isPending}>
                {updatePasswordMutation.isPending ? "Salvando..." : "Salvar senha"}
              </button>
            </form>
          ) : null}

          <div className={styles.footer}>
            <Link href="/login" className={styles.backLink}>
              Voltar para o login
            </Link>
            <p>Registre cada movimentacao. Tenha controle total das informacoes.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
