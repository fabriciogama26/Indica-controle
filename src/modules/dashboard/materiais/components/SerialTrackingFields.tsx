"use client";

import { allowsPendingSerialIdentification, SerialTrackingType } from "@/lib/materialSerialTracking";
import styles from "../MaterialsPageView.module.css";

type SerialTrackingFieldsProps = {
  serialTrackingType: SerialTrackingType;
  allowPendingSerialIdentification: boolean;
  changeBlocked: boolean;
  onSerialTrackingTypeChange: (value: SerialTrackingType, checked: boolean) => void;
  onAllowPendingSerialIdentificationChange: (checked: boolean) => void;
};

const TRACKING_OPTIONS: Array<{ value: SerialTrackingType; label: string }> = [
  { value: "TRAFO", label: "Material TRAFO (exige Serial e LP na movimentacao)" },
  { value: "RELIGADOR", label: "Material RELIGADOR (exige Serial na movimentacao)" },
  { value: "CHAVE", label: "Material CHAVES (exige Serial na movimentacao)" },
];

export function SerialTrackingFields({
  serialTrackingType,
  allowPendingSerialIdentification,
  changeBlocked,
  onSerialTrackingTypeChange,
  onAllowPendingSerialIdentificationChange,
}: SerialTrackingFieldsProps) {
  // TRAFO exige Serial + LP em qualquer movimentacao e nunca aceita pendencia
  // (constraint materials_pending_serial_not_trafo_check).
  const supportsPendingIdentification = allowsPendingSerialIdentification(serialTrackingType, true);

  return (
    <>
      {TRACKING_OPTIONS.map((option) => (
        <label key={option.value} className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={serialTrackingType === option.value}
            disabled={changeBlocked}
            onChange={(event) => onSerialTrackingTypeChange(option.value, event.target.checked)}
          />
          {option.label}
        </label>
      ))}

      {supportsPendingIdentification ? (
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={allowPendingSerialIdentification}
            onChange={(event) => onAllowPendingSerialIdentificationChange(event.target.checked)}
          />
          Aceita entrada e transferencia sem Serial (pendencia de identificacao)
        </label>
      ) : null}

      {changeBlocked ? (
        <p className={styles.serialTrackingLockNotice}>
          Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.
        </p>
      ) : null}
    </>
  );
}
