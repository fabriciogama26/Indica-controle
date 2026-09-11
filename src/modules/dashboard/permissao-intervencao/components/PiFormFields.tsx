"use client";

import type { ReactNode } from "react";

import styles from "../PermissionInterventionPageView.module.css";
import type { PiCatalogOption, PiFormState, PiPersonOption } from "../types";

/**
 * Campos do formulario da PI, secoes 1 a 6 e 8.
 *
 * A secao 7 (Plano de Execucao) tem edicao propria e vive em
 * `PiExecutionPlan.tsx`.
 *
 * Nenhum campo trazido da Programacao e bloqueado: a PI e independente e o
 * usuario pode alterar tudo. A divergencia vira aviso no painel de comparacao,
 * nunca impedimento.
 */

type Props = {
  form: PiFormState;
  operationAreas: PiCatalogOption[];
  voltageLevels: PiCatalogOption[];
  people: PiPersonOption[];
  disabled: boolean;
  emergencyPlan: string | null;
  onField: <K extends keyof PiFormState>(key: K, value: PiFormState[K]) => void;
  onToggle: (
    key: "operationAreas" | "contactOperationAreas" | "voltageLevels" | "interferingVoltageLevels",
    code: string,
  ) => void;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>{title}</h3>
      {hint ? <p className={styles.intro}>{hint}</p> : null}
      <div className={styles.formGrid}>{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? styles.fieldWide : styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Grupo de caixas. O rotulo de cada uma vem do catalogo por contrato. */
function CheckboxGroup({
  label,
  options,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  options: PiCatalogOption[];
  selected: string[];
  disabled: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <div className={styles.fieldWide}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.checkboxRow}>
        {options.map((option) => (
          <label key={option.code} className={styles.checkbox}>
            <input
              type="checkbox"
              checked={selected.includes(option.code)}
              disabled={disabled}
              onChange={() => onToggle(option.code)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {options.length === 0 ? <span className={styles.mutedText}>Catalogo vazio.</span> : null}
      </div>
    </div>
  );
}

function PersonSelect({
  label,
  value,
  people,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  people: PiPersonOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <select className={styles.input} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Nao informado</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.registration ? `${person.name} (${person.registration})` : person.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function PiFormFields({
  form,
  operationAreas,
  voltageLevels,
  people,
  disabled,
  emergencyPlan,
  onField,
  onToggle,
}: Props) {
  const needsPrimaryArea = form.operationAreas.length > 1;
  const needsPrimaryVoltage = form.voltageLevels.length > 1;

  return (
    <>
      <Section
        title="1. Identificacao"
        hint="Os dados do gestor e do contrato nascem preenchidos pela configuracao do contrato e continuam editaveis aqui."
      >
        <CheckboxGroup
          label="Area de Atuacao"
          options={operationAreas}
          selected={form.operationAreas}
          disabled={disabled}
          onToggle={(code) => onToggle("operationAreas", code)}
        />

        {needsPrimaryArea ? (
          <Field label="Area que compoe o codigo da PI">
            <select
              className={styles.input}
              value={form.primaryOperationAreaCode}
              disabled={disabled}
              onChange={(event) => onField("primaryOperationAreaCode", event.target.value)}
            >
              <option value="">Escolha</option>
              {operationAreas
                .filter((area) => form.operationAreas.includes(area.code))
                .map((area) => (
                  <option key={area.code} value={area.code}>
                    {area.label}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}

        <CheckboxGroup
          label="Nivel de Tensao"
          options={voltageLevels}
          selected={form.voltageLevels}
          disabled={disabled}
          onToggle={(code) => onToggle("voltageLevels", code)}
        />

        {needsPrimaryVoltage ? (
          <Field label="Tensao que compoe o codigo da PI">
            <select
              className={styles.input}
              value={form.primaryVoltageLevelCode}
              disabled={disabled}
              onChange={(event) => onField("primaryVoltageLevelCode", event.target.value)}
            >
              <option value="">Escolha</option>
              {voltageLevels
                .filter((level) => form.voltageLevels.includes(level.code))
                .map((level) => (
                  <option key={level.code} value={level.code}>
                    {level.label}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}

        <Field label="Nome do Gestor">
          <input className={styles.input} value={form.managerName} disabled={disabled} onChange={(e) => onField("managerName", e.target.value)} />
        </Field>
        <Field label="Empresa">
          <input className={styles.input} value={form.companyName} disabled={disabled} onChange={(e) => onField("companyName", e.target.value)} />
        </Field>
        <Field label="N. Contrato">
          <input className={styles.input} value={form.contractNumber} disabled={disabled} onChange={(e) => onField("contractNumber", e.target.value)} />
        </Field>
        <Field label="Telefone Corporativo">
          <input className={styles.input} value={form.managerPhone} disabled={disabled} onChange={(e) => onField("managerPhone", e.target.value)} />
        </Field>
        <Field label="E-mail">
          <input className={styles.input} value={form.managerEmail} disabled={disabled} onChange={(e) => onField("managerEmail", e.target.value)} />
        </Field>
      </Section>

      <Section
        title="Contato da distribuidora"
        hint="A area de atuacao deste contato e independente da que compoe o codigo da PI."
      >
        <Field label="Nome">
          <input className={styles.input} value={form.utilityContactName} disabled={disabled} onChange={(e) => onField("utilityContactName", e.target.value)} />
        </Field>
        <Field label="Telefone Corporativo">
          <input className={styles.input} value={form.utilityContactPhone} disabled={disabled} onChange={(e) => onField("utilityContactPhone", e.target.value)} />
        </Field>
        <Field label="E-mail">
          <input className={styles.input} value={form.utilityContactEmail} disabled={disabled} onChange={(e) => onField("utilityContactEmail", e.target.value)} />
        </Field>
        <CheckboxGroup
          label="Area de Atuacao do contato"
          options={operationAreas}
          selected={form.contactOperationAreas}
          disabled={disabled}
          onToggle={(code) => onToggle("contactOperationAreas", code)}
        />
      </Section>

      <Section
        title="2. Atividade e autorizacoes"
        hint="Plano de Trabalho, Autorizacao de Trabalho e PRE-APR sao sempre preenchidos aqui; nao vem da Programacao."
      >
        <Field label="Descricao das atividades" wide>
          <textarea
            className={styles.textarea}
            rows={5}
            value={form.activityDescription}
            disabled={disabled}
            onChange={(e) => onField("activityDescription", e.target.value)}
          />
        </Field>
        <Field label="Plano de Trabalho (Rede Desenergizada)">
          <input className={styles.input} value={form.workPlan} disabled={disabled} onChange={(e) => onField("workPlan", e.target.value)} />
        </Field>
        <Field label="Autorizacao de Trabalho (Em Tensao)">
          <input className={styles.input} value={form.liveWorkAuthorization} disabled={disabled} onChange={(e) => onField("liveWorkAuthorization", e.target.value)} />
        </Field>
        <Field label="Identificacao PRE-APR">
          <input className={styles.input} value={form.preApr} disabled={disabled} onChange={(e) => onField("preApr", e.target.value)} />
        </Field>
        <Field label="N. Autorizacao Emergencial AT">
          <input className={styles.input} value={form.emergencyAuthorization} disabled={disabled} onChange={(e) => onField("emergencyAuthorization", e.target.value)} />
        </Field>
      </Section>

      <Section title="3. Datas e horarios" hint="A data da etapa e definida na criacao e participa do vinculo com a Programacao.">
        <Field label="Hora de inicio">
          <input type="time" className={styles.input} value={form.startTime} disabled={disabled} onChange={(e) => onField("startTime", e.target.value)} />
        </Field>
        <Field label="Data de termino">
          <input type="date" className={styles.input} value={form.endDate} disabled={disabled} onChange={(e) => onField("endDate", e.target.value)} />
        </Field>
        <Field label="Hora de termino">
          <input type="time" className={styles.input} value={form.endTime} disabled={disabled} onChange={(e) => onField("endTime", e.target.value)} />
        </Field>
      </Section>

      <Section title="4. Local e rede">
        <Field label="Instalacao solicitada / descricao do local" wide>
          <textarea
            className={styles.textarea}
            rows={3}
            value={form.installationDescription}
            disabled={disabled}
            onChange={(e) => onField("installationDescription", e.target.value)}
          />
        </Field>
        <Field label="Alimentador">
          <input className={styles.input} value={form.feeder} disabled={disabled} onChange={(e) => onField("feeder", e.target.value)} />
        </Field>
        <Field label="Endereco">
          <input className={styles.input} value={form.address} disabled={disabled} onChange={(e) => onField("address", e.target.value)} />
        </Field>
        <Field label="Coordenada X">
          <input className={styles.input} value={form.coordX} disabled={disabled} onChange={(e) => onField("coordX", e.target.value)} />
        </Field>
        <Field label="Coordenada Y">
          <input className={styles.input} value={form.coordY} disabled={disabled} onChange={(e) => onField("coordY", e.target.value)} />
        </Field>
        <Field label="Elementos bloqueados" wide>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.blockedElements}
            disabled={disabled}
            onChange={(e) => onField("blockedElements", e.target.value)}
          />
        </Field>
        <Field label="Elementos de corte" wide>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.cutElements}
            disabled={disabled}
            onChange={(e) => onField("cutElements", e.target.value)}
          />
        </Field>

        <div className={styles.fieldWide}>
          <span className={styles.fieldLabel}>Instalacao eletrica interferente</span>
          <div className={styles.checkboxRow}>
            {/* Nulo e um estado real: deixa as duas caixas vazias no documento. */}
            <label className={styles.checkbox}>
              <input
                type="radio"
                name="interfering"
                checked={form.hasInterferingInstallation === true}
                disabled={disabled}
                onChange={() => onField("hasInterferingInstallation", true)}
              />
              <span>Sim</span>
            </label>
            <label className={styles.checkbox}>
              <input
                type="radio"
                name="interfering"
                checked={form.hasInterferingInstallation === false}
                disabled={disabled}
                onChange={() => onField("hasInterferingInstallation", false)}
              />
              <span>Nao</span>
            </label>
            <button
              type="button"
              className={styles.linkButton}
              disabled={disabled || form.hasInterferingInstallation === null}
              onClick={() => onField("hasInterferingInstallation", null)}
            >
              Limpar
            </button>
          </div>
        </div>

        <CheckboxGroup
          label="Nivel de tensao da instalacao interferente (nao compoe o codigo)"
          options={voltageLevels}
          selected={form.interferingVoltageLevels}
          disabled={disabled}
          onToggle={(code) => onToggle("interferingVoltageLevels", code)}
        />

        <Field label="Descricao da instalacao em proximidade" wide>
          <textarea
            className={styles.textarea}
            rows={2}
            value={form.interferingDescription}
            disabled={disabled}
            onChange={(e) => onField("interferingDescription", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="5. Seguranca">
        <Field label="Orientacao de transito e sinalizacao" wide>
          <textarea
            className={styles.textarea}
            rows={3}
            value={form.trafficInstructions}
            disabled={disabled}
            onChange={(e) => onField("trafficInstructions", e.target.value)}
          />
        </Field>

        <div className={styles.fieldWide}>
          <span className={styles.fieldLabel}>Plano de Emergencia em Caso de Acidentes</span>
          {/* Nao e editavel na PI: e configuracao do contrato. A PI guarda o
              snapshot do texto no momento da emissao. */}
          <p className={styles.readOnlyBox}>
            {emergencyPlan ?? "Nao configurado para este contrato. A emissao ficara bloqueada ate ser definido."}
          </p>
          <span className={styles.mutedText}>
            Definido na configuracao do contrato, nao aqui. A PI guarda o texto usado no momento da emissao.
          </span>
        </div>
      </Section>

      <Section
        title="6. Responsaveis"
        hint="A etapa pode ter varias equipes, logo varios encarregados. Escolher um diferente do programado gera aviso, nunca bloqueio."
      >
        <PersonSelect
          label="Responsavel pela Intervencao (Supervisor)"
          value={form.supervisorPersonId}
          people={people}
          disabled={disabled}
          onChange={(value) => onField("supervisorPersonId", value)}
        />
        <PersonSelect
          label="Suplente do Supervisor"
          value={form.supervisorAlternatePersonId}
          people={people}
          disabled={disabled}
          onChange={(value) => onField("supervisorAlternatePersonId", value)}
        />
        <PersonSelect
          label="Encarregado de Trabalhos"
          value={form.foremanPersonId}
          people={people}
          disabled={disabled}
          onChange={(value) => onField("foremanPersonId", value)}
        />
        <PersonSelect
          label="Suplente do Encarregado"
          value={form.foremanAlternatePersonId}
          people={people}
          disabled={disabled}
          onChange={(value) => onField("foremanAlternatePersonId", value)}
        />
      </Section>

      <Section title="8. Elaboracao e validacao">
        <PersonSelect
          label="Responsavel Tecnico Elaborador"
          value={form.authorPersonId}
          people={people}
          disabled={disabled}
          onChange={(value) => onField("authorPersonId", value)}
        />
        <PersonSelect
          label="Validador / Aprovador"
          value={form.validatorPersonId}
          people={people}
          disabled={disabled}
          onChange={(value) => onField("validatorPersonId", value)}
        />
        <Field label="Observacoes" wide>
          <textarea
            className={styles.textarea}
            rows={4}
            value={form.observations}
            disabled={disabled}
            onChange={(e) => onField("observations", e.target.value)}
          />
        </Field>
      </Section>
    </>
  );
}
