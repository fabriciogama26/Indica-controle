"use client";

import { useState } from "react";

import { AccessTab } from "./AccessTab";
import styles from "./AuditPageView.module.css";
import { ChangesTab } from "./ChangesTab";
import { ErrorsTab } from "./ErrorsTab";

type AuditTab = "changes" | "access" | "errors";

export function AuditPageView() {
  const [activeTab, setActiveTab] = useState<AuditTab>("changes");

  return (
    <div className={styles.wrapper}>
      <article className={styles.card}>
        <div className={styles.tabHeader}>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "changes" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("changes")}
          >
            Alteracoes
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "access" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("access")}
          >
            Acessos
          </button>
          <button
            type="button"
            className={`${styles.tabButton} ${activeTab === "errors" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("errors")}
          >
            Erros
          </button>
        </div>
      </article>

      {activeTab === "changes" ? <ChangesTab /> : null}
      {activeTab === "access" ? <AccessTab /> : null}
      {activeTab === "errors" ? <ErrorsTab /> : null}
    </div>
  );
}
