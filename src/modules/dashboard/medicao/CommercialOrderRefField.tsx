"use client";

// Campo `Incidencia` da Medicao Comercial.
//
// `Incidencia` e o rotulo visivel; a coluna no banco continua
// `project_measurement_orders.commercial_order_ref`, e por isso os nomes internos
// deste arquivo (`orderRef`, `CommercialOrderRefField`) seguem o contrato do
// servidor, e nao o texto da tela.
//
// Vive fora do `MeasurementPageView` por dois motivos: o PageView e legado e
// esta no ratchet de tamanho (guia_frontend.md, regra 15), e a checagem de
// duplicidade e busca de dados -- que a regra 12 manda tirar do PageView.
//
// A checagem aqui e AVISO, nao barreira: entre ela e o submit existe janela para
// outro usuario gravar a mesma Incidencia. Quem garante e o UNIQUE INDEX parcial
// `uq_project_measurement_orders_commercial_ref_team_date` (migration 419), cujo
// conflito volta como 409 no salvamento.
import { useEffect, useState } from "react";

export type CommercialOrderRefCheck = {
  status: "idle" | "checking" | "free" | "duplicate" | "error";
  orderNumber: string | null;
};

export const IDLE_COMMERCIAL_ORDER_REF_CHECK: CommercialOrderRefCheck = {
  status: "idle",
  orderNumber: null,
};

export function duplicateCommercialOrderRefMessage(orderNumber: string | null) {
  return orderNumber
    ? `Ja existe a ordem ${orderNumber} para esta Incidencia + Equipe + Data de execucao.`
    : "Ja existe ordem de medicao para esta Incidencia + Equipe + Data de execucao.";
}

// Obrigatoriedade + aviso da checagem, juntos, para o PageView decidir o submit
// numa linha so. O aviso NAO substitui o 409 do servidor: a barreira e o indice
// unico da migration 419.
export function validateCommercialOrderRef(value: string, check: CommercialOrderRefCheck) {
  if (!value.trim()) {
    return "Informe a Incidencia da medicao comercial.";
  }
  if (check.status === "duplicate") {
    return duplicateCommercialOrderRefMessage(check.orderNumber);
  }
  return null;
}

type CommercialOrderRefFieldProps = {
  value: string;
  onChange: (next: string) => void;
  fieldClassName: string;
  apiBase: string;
  accessToken: string | null;
  teamId: string;
  executionDate: string;
  /** Ordem de medicao em edicao: ela nao pode se acusar de duplicada. */
  excludeOrderId: string | null;
  check: CommercialOrderRefCheck;
  onCheckChange: (next: CommercialOrderRefCheck) => void;
  disabled?: boolean;
};

export function CommercialOrderRefField({
  value,
  onChange,
  fieldClassName,
  apiBase,
  accessToken,
  teamId,
  executionDate,
  excludeOrderId,
  check,
  onCheckChange,
  disabled,
}: CommercialOrderRefFieldProps) {
  // A consulta dispara ao SAIR do campo, e nao a cada tecla: o usuario digita a
  // incidencia inteira, entao checar no meio da digitacao so produziria
  // "duplicada" falso e request desperdicado.
  const [committedRef, setCommittedRef] = useState("");

  // Trocar Equipe ou Data muda a chave da unicidade, entao o aviso anterior
  // deixa de valer mesmo sem ninguem mexer no campo.
  useEffect(() => {
    const orderRef = committedRef.trim();
    // O aviso pertence ao texto que esta AGORA no campo. Se o usuario voltou a
    // digitar, se o formulario foi resetado depois de salvar, ou se a tela
    // carregou outra ordem para edicao, o que foi conferido antes nao vale mais
    // -- e o proprio componente derruba o aviso, sem o PageView precisar saber.
    if (!orderRef || orderRef !== value.trim() || !teamId || !executionDate || !accessToken) {
      onCheckChange(IDLE_COMMERCIAL_ORDER_REF_CHECK);
      return;
    }

    let active = true;
    onCheckChange({ status: "checking", orderNumber: null });

    const params = new URLSearchParams({ orderRef, teamId, executionDate });
    if (excludeOrderId) {
      params.set("excludeOrderId", excludeOrderId);
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiBase}/order-ref-check?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = (await response.json().catch(() => null)) as
          | { duplicate?: boolean; orderNumber?: string | null }
          | null;

        if (!active) return;

        if (!response.ok) {
          onCheckChange({ status: "error", orderNumber: null });
          return;
        }

        onCheckChange({
          status: data?.duplicate ? "duplicate" : "free",
          orderNumber: data?.orderNumber ?? null,
        });
      } catch {
        if (active) {
          onCheckChange({ status: "error", orderNumber: null });
        }
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
    // `onCheckChange` fica fora de proposito. O chamador de hoje passa o setState
    // do `useState`, que e estavel, mas o tipo da prop aceita qualquer callback:
    // uma arrow inline no JSX mudaria de identidade a cada render do pai e
    // recriaria o efeito em loop. Fora das deps, o componente fica imune a isso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, apiBase, committedRef, excludeOrderId, executionDate, teamId, value]);

  return (
    <label className={fieldClassName}>
      <span>
        Incidencia <span className="requiredMark">*</span>
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => setCommittedRef(event.target.value)}
        placeholder="Referencia da incidencia"
        maxLength={120}
        disabled={disabled}
      />
      {check.status === "checking" ? <small>Verificando a Incidencia...</small> : null}
      {check.status === "duplicate" ? (
        <small role="alert">{duplicateCommercialOrderRefMessage(check.orderNumber)}</small>
      ) : null}
      {check.status === "error" ? <small>Nao foi possivel verificar a Incidencia agora.</small> : null}
    </label>
  );
}
