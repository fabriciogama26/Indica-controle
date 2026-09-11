"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "../PiTemplatePageView.module.css";

/**
 * Configuracao da PI por contrato.
 *
 * Fica nesta tela, e nao na da PI, porque e ato de administracao do contrato:
 * acontece raramente e vale para todo mundo. Quem emite PI nao precisa nem deve
 * poder trocar o prefixo do codigo ou o Plano de Emergencia.
 */

type JobTitle = { id: string; name: string };

type Configuration = {
  settings: {
    codePrefix: string;
    companyCode: string;
    sequenceDigits: number;
    emergencyPlanText: string | null;
    emergencyPlanVersion: number;
    supervisorRequiredTeamCount: number;
    utilityContactSource: string;
    updatedAt: string | null;
  } | null;
  jobTitles: JobTitle[];
  foremanJobTitleIds: string[];
  supervisorJobTitleIds: string[];
};

type FormState = {
  codePrefix: string;
  companyCode: string;
  sequenceDigits: number;
  emergencyPlanText: string;
  supervisorRequiredTeamCount: number;
  utilityContactSource: string;
  foremanJobTitleIds: string[];
  supervisorJobTitleIds: string[];
};

const EMPTY: FormState = {
  codePrefix: "",
  companyCode: "",
  sequenceDigits: 4,
  emergencyPlanText: "",
  supervisorRequiredTeamCount: 3,
  utilityContactSource: "RESPONSIBLE",
  foremanJobTitleIds: [],
  supervisorJobTitleIds: [],
};

function JobTitlePicker({
  label,
  hint,
  jobTitles,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  hint: string;
  jobTitles: JobTitle[];
  selected: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className={styles.configFieldWide}>
      <span className={styles.configLabel}>{label}</span>
      <span className={styles.mutedText}>{hint}</span>
      <div className={styles.checkboxRow}>
        {jobTitles.map((title) => (
          <label key={title.id} className={styles.checkbox}>
            <input type="checkbox" checked={selected.includes(title.id)} disabled={disabled} onChange={() => onToggle(title.id)} />
            <span>{title.name}</span>
          </label>
        ))}
        {jobTitles.length === 0 ? <span className={styles.mutedText}>Nenhum cargo ativo cadastrado.</span> : null}
      </div>
    </div>
  );
}

export function PiConfigurationCard({ accessToken }: { accessToken: string }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [planVersion, setPlanVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/permissao-intervencao/configuracao", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await response.json().catch(() => ({}))) as Configuration & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Falha ao carregar a configuracao.");

      setJobTitles(data.jobTitles ?? []);
      setPlanVersion(data.settings?.emergencyPlanVersion ?? null);
      setExpectedUpdatedAt(data.settings?.updatedAt ?? null);
      setForm({
        codePrefix: data.settings?.codePrefix ?? "",
        companyCode: data.settings?.companyCode ?? "",
        sequenceDigits: data.settings?.sequenceDigits ?? 4,
        emergencyPlanText: data.settings?.emergencyPlanText ?? "",
        supervisorRequiredTeamCount: data.settings?.supervisorRequiredTeamCount ?? 3,
        utilityContactSource: data.settings?.utilityContactSource ?? "RESPONSIBLE",
        foremanJobTitleIds: data.foremanJobTitleIds ?? [],
        supervisorJobTitleIds: data.supervisorJobTitleIds ?? [],
      });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(key: "foremanJobTitleIds" | "supervisorJobTitleIds", id: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id],
    }));
  }

  async function handleSave() {
    if (isSaving) return;
    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/permissao-intervencao/configuracao", {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          emergencyPlanText: form.emergencyPlanText.trim() || null,
          expectedUpdatedAt,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Falha ao salvar a configuracao.");
      await load();
      setFeedback({ type: "success", message: data.message ?? "Configuracao salva." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao salvar." });
    } finally {
      setIsSaving(false);
    }
  }

  const disabled = isLoading || isSaving;

  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>Configuracao da PI</h3>
      <p className={styles.intro}>
        Vale para todo o contrato. O codigo da PI e montado como
        <strong> {form.codePrefix || "PREFIXO"}-[TENSAO]-[AREA]-{form.companyCode || "EMPRESA"}-{"0".repeat(Math.max(1, form.sequenceDigits))}</strong>.
      </p>

      <div className={styles.configGrid}>
        <label className={styles.configField}>
          <span>Prefixo do codigo</span>
          <input className={styles.input} value={form.codePrefix} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, codePrefix: e.target.value }))} />
        </label>
        <label className={styles.configField}>
          <span>Codigo da empresa</span>
          <input className={styles.input} value={form.companyCode} disabled={disabled} onChange={(e) => setForm((c) => ({ ...c, companyCode: e.target.value }))} />
        </label>
        <label className={styles.configField}>
          <span>Digitos do sequencial</span>
          <input
            type="number"
            min={1}
            max={8}
            className={styles.input}
            value={form.sequenceDigits}
            disabled={disabled}
            onChange={(e) => setForm((c) => ({ ...c, sequenceDigits: Number(e.target.value) || 1 }))}
          />
        </label>

        <label className={styles.configField}>
          <span>Contato da distribuidora vem de</span>
          <select
            className={styles.input}
            value={form.utilityContactSource}
            disabled={disabled}
            onChange={(e) => setForm((c) => ({ ...c, utilityContactSource: e.target.value }))}
          >
            <option value="RESPONSIBLE">Responsavel da Distribuidora</option>
            <option value="FIELD_MANAGER">Gestor de Campo da Distribuidora</option>
          </select>
        </label>

        <label className={styles.configField}>
          <span>Supervisor obrigatorio acima de</span>
          <input
            type="number"
            min={1}
            max={50}
            className={styles.input}
            value={form.supervisorRequiredTeamCount}
            disabled={disabled}
            onChange={(e) => setForm((c) => ({ ...c, supervisorRequiredTeamCount: Number(e.target.value) || 1 }))}
          />
          <span className={styles.mutedText}>
            equipes na etapa vinculada. PI sem Programacao nao tem etapa e nunca cai nesta regra.
          </span>
        </label>

        <div className={styles.configFieldWide}>
          <span className={styles.configLabel}>
            Plano de Emergencia em Caso de Acidentes
            {planVersion ? <span className={styles.badgeIdle}>versao {planVersion}</span> : null}
          </span>
          <textarea
            className={styles.textarea}
            rows={6}
            value={form.emergencyPlanText}
            disabled={disabled}
            onChange={(e) => setForm((c) => ({ ...c, emergencyPlanText: e.target.value }))}
          />
          <span className={styles.mutedText}>
            Nao e editavel dentro da PI. Cada PI emitida guarda o texto usado, entao mudar aqui nao altera documento ja
            emitido — so sobe a versao para os proximos.
          </span>
        </div>

        <JobTitlePicker
          label="Cargos que podem ser Encarregado de Trabalhos"
          hint="Vale tambem para o Suplente do Encarregado."
          jobTitles={jobTitles}
          selected={form.foremanJobTitleIds}
          disabled={disabled}
          onToggle={(id) => toggle("foremanJobTitleIds", id)}
        />

        <JobTitlePicker
          label="Cargos que podem ser Responsavel pela Intervencao"
          hint="Vale tambem para o Suplente do Supervisor. Costuma incluir os cargos de encarregado."
          jobTitles={jobTitles}
          selected={form.supervisorJobTitleIds}
          disabled={disabled}
          onToggle={(id) => toggle("supervisorJobTitleIds", id)}
        />
      </div>

      {feedback ? (
        <p className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} disabled={disabled} onClick={() => void handleSave()}>
          {isSaving ? "Salvando..." : "Salvar configuracao"}
        </button>
      </div>
    </section>
  );
}
