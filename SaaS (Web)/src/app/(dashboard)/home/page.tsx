import styles from "./page.module.css";

const cards = [
  {
    title: "Cadastro Base",
    description: "Entrada para pessoas, materiais e cadastros de apoio.",
  },
  {
    title: "Operacao de Estoque",
    description: "Entrada, saida e consulta do estoque fisico.",
  },
  {
    title: "Preparado para multi-tenant",
    description: "Tenant e perfil resolvidos no login web e mantidos no shell principal.",
  },
];

export default function HomePage() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.hero}>
        <div>
          <span className={styles.badge}>Home</span>
          <h2 className={styles.title}>Painel inicial do SaaS</h2>
          <p className={styles.description}>
            Esta etapa entrega o shell principal, o fluxo de login e a base para evoluir os modulos de cadastro e estoque.
          </p>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Escopo atual</div>
          <div className={styles.summaryValue}>Login + shell + home</div>
          <div className={styles.summaryHint}>Proximas telas: Cadastro Base, Pessoas, Materiais, Entrada, Saida e Estoque.</div>
        </div>
      </div>

      <div className={styles.cardGrid}>
        {cards.map((card) => (
          <article key={card.title} className={styles.card}>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
