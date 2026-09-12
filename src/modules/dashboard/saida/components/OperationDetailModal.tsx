"use client";

import styles from "../../entrada/StockTransfersPageView.module.css";
import type { TeamOperationListItem } from "../types";
import {
  formatDate,
  formatDateTime,
  operationDateLabel,
  operationKindLabel,
  resolvePrimaryStockCenterName,
  resolveSupportCenterName,
} from "../utils";

type OperationDetailModalProps = {
  item: TeamOperationListItem | null;
  onClose: () => void;
};

export function OperationDetailModal({ item, onClose }: OperationDetailModalProps) {
  if (!item) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4>Detalhes da Operacao</h4>
            <p className={styles.modalSubtitle}>Transferencia: {item.transferId}</p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.detailGrid}>
            <div><strong>Operacao:</strong> {operationKindLabel(item.operationKind)}</div>
            <div><strong>Equipe:</strong> {item.teamName}</div>
            <div><strong>Encarregado:</strong> {item.foremanName ?? "-"}</div>
            <div><strong>Centro estoque:</strong> {resolvePrimaryStockCenterName(item)}</div>
            <div><strong>Origem apoio:</strong> {resolveSupportCenterName(item)}</div>
            <div><strong>Material:</strong> {item.materialCode}</div>
            <div><strong>Descricao:</strong> {item.description}</div>
            <div><strong>Categoria:</strong> {item.categoryName ?? "-"}</div>
            <div><strong>Subcategoria:</strong> {item.subcategoryName ?? "-"}</div>
            <div><strong>Quantidade:</strong> {item.quantity.toLocaleString("pt-BR")}</div>
            <div><strong>Tipo:</strong> {item.entryType}</div>
            <div><strong>{operationDateLabel(item.operationKind)}:</strong> {formatDate(item.entryDate)}</div>
            <div><strong>Serial:</strong> {item.serialNumber ?? "-"}</div>
            <div><strong>LP:</strong> {item.lotCode ?? "-"}</div>
            <div><strong>Atualizado em:</strong> {formatDateTime(item.updatedAt)}</div>
            <div><strong>Atualizado por:</strong> {item.updatedByName}</div>
            <div><strong>Transferencia original:</strong> {item.originalTransferId ?? "-"}</div>
            <div><strong>Transferencia de estorno:</strong> {item.reversalTransferId ?? "-"}</div>
            <div><strong>Motivo do estorno:</strong> {item.reversalReason ?? "-"}</div>
            <div><strong>Data do estorno:</strong> {formatDateTime(item.reversedAt)}</div>
            <div className={styles.detailWide}><strong>Observacao:</strong> {item.notes ?? "-"}</div>
          </div>
        </div>
      </article>
    </div>
  );
}
