import styles from "./ModulePlaceholder.module.css";

type ModulePlaceholderProps = {
  title: string;
  description: string;
  nextSteps: string[];
};

export function ModulePlaceholder({ title, description, nextSteps }: ModulePlaceholderProps) {
  return (
    <section className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.badge}>Em construcao</span>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.description}>{description}</p>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Proximos passos do modulo</div>
        <ul className={styles.list}>
          {nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
