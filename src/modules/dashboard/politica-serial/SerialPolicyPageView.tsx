"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_STOCK_SERIAL_POLICY, type StockSerialPolicy } from "@/lib/stockSerialPolicy";
import styles from "./SerialPolicyPageView.module.css";

type PolicyResponse = {
  policy?: StockSerialPolicy & { updatedAt?: string | null };
  message?: string;
};

type MovementOption = {
  key: keyof StockSerialPolicy;
  label: string;
  hint: string;
};

const MOVEMENT_OPTIONS: MovementOption[] = [
  {
    key: "allowPendingOnEntry",
    label: "Entrada",
    hint: "O material chegou ao estoque e o Serial pode ser informado depois. A pendencia fica registrada por centro e continua cobravel.",
  },
  {
    key: "allowPendingOnTransfer",
    label: "Transferencia",
    hint: "Move a pendencia do centro de origem para o de destino, sem identificar a unidade. O saldo continua no seu estoque.",
  },
  {
    key: "allowPendingOnExit",
    label: "Saida",
    hint: "Atencao: na saida a unidade deixa o estoque. Liberar aqui significa aceitar que o equipamento saia sem nunca ter tido o Serial vinculado -- a rastreabilidade daquela unidade se perde de forma definitiva.",
  },
];

export function SerialPolicyPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;

  const [policy, setPolicy] = useState<StockSerialPolicy>(DEFAULT_STOCK_SERIAL_POLICY);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadPolicy = useCallback(async () => {
    if (!accessToken) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/stock-serial-policy", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const data = (await response.json().catch(() => ({}))) as PolicyResponse;
      if (!response.ok || !data.policy) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar a politica de serial." });
        return;
      }

      setPolicy({
        allowPendingOnEntry: data.policy.allowPendingOnEntry,
        allowPendingOnTransfer: data.policy.allowPendingOnTransfer,
        allowPendingOnExit: data.policy.allowPendingOnExit,
      });
      setUpdatedAt(data.policy.updatedAt ?? null);
    } catch {
      setFeedback({ type: "error", message: "Falha ao carregar a politica de serial." });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || isSaving) return;

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/stock-serial-policy", {
        method: "PUT",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ ...policy, expectedUpdatedAt: updatedAt }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string; updatedAt?: string | null };
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao salvar a politica de serial." });
        return;
      }

      setUpdatedAt(data.updatedAt ?? updatedAt);
      setFeedback({ type: "success", message: data.message ?? "Politica de serial atualizada." });
      await loadPolicy();
    } catch {
      setFeedback({ type: "error", message: "Falha ao salvar a politica de serial." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Politica de Serial</h3>
        <p className={styles.intro}>
          Define, para este contrato, em quais movimentos um material rastreado por serial pode
          ser lancado sem o Serial informado, ficando pendente de identificacao.
        </p>
        <p className={styles.intro}>
          Esta regra vale em conjunto com o cadastro do material: a pendencia so e aceita quando o
          material permite <strong>e</strong> o movimento esta liberado aqui. Material TRAFO exige
          Serial e LP em qualquer movimento e nao e afetado por esta tela. Operacoes de Equipe e
          Requisicao continuam exigindo Serial sempre.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {MOVEMENT_OPTIONS.map((option) => (
            <label key={option.key} className={styles.option}>
              <span className={styles.optionHeader}>
                <input
                  type="checkbox"
                  checked={policy[option.key]}
                  disabled={isLoading || isSaving}
                  onChange={(event) => setPolicy((current) => ({ ...current, [option.key]: event.target.checked }))}
                />
                <strong>{option.label}</strong>
              </span>
              <small className={styles.optionHint}>{option.hint}</small>
            </label>
          ))}

          <p className={styles.warning}>
            Desligar um movimento nao apaga pendencia ja registrada, e a identificacao do saldo
            existente continua liberada. A regra vale apenas para novos lancamentos.
          </p>

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={isLoading || isSaving}>
              {isSaving ? "Salvando..." : "Salvar politica"}
            </button>
          </div>
        </form>

        {feedback ? (
          <p className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
            {feedback.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
