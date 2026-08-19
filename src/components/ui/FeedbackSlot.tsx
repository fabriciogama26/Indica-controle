import type { ReactNode } from "react";

import styles from "./FeedbackSlot.module.css";

type FeedbackSlotProps = {
  /** Classe do feedback real da tela. Usada tambem no espaco reservado, para a altura bater. */
  className: string;
  /** Mensagem. Ausente/vazia = so o espaco reservado. */
  message?: ReactNode;
  /** Elemento renderizado. A tela ja escolheu <p> ou <div>; manter o mesmo evita mudar o CSS. */
  as?: "p" | "div";
  /** Linhas reservadas quando nao ha mensagem. Subir para 2 em telas com mensagem que quebra. */
  reserveLines?: number;
  onClick?: () => void;
  role?: string;
};

/**
 * Mantem o bloco de feedback sempre ocupando espaco no layout.
 *
 * A altura reservada nao e um `min-height` arbitrario: o slot vazio renderiza o
 * MESMO elemento com a MESMA classe do feedback real, apenas invisivel. A altura
 * e igual por construcao e continua correta se o CSS da tela mudar.
 */
export function FeedbackSlot({
  className,
  message,
  as = "p",
  reserveLines = 1,
  onClick,
  role,
}: FeedbackSlotProps) {
  const Tag = as;
  const hasMessage = message !== null && message !== undefined && message !== "";

  if (!hasMessage) {
    return (
      <Tag className={`${className} ${styles.reserved}`} aria-hidden="true">
        {Array.from({ length: Math.max(1, reserveLines) }, (_, index) => (
          <span key={index} className={styles.reservedLine}>
            &nbsp;
          </span>
        ))}
      </Tag>
    );
  }

  return (
    <Tag className={className} onClick={onClick} role={role}>
      {message}
    </Tag>
  );
}
