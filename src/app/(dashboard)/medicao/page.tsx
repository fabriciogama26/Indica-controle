import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function MedicaoPage() {
  return (
    <ModulePlaceholder
      title="Medicao"
      description="Tela reservada para controle e fechamento das medicoes operacionais."
      nextSteps={[
        "Definir ciclo de medicao por projeto e periodo.",
        "Consolidar apontamentos para aprovacao.",
        "Integrar status da medicao com Programacao e Projetos.",
      ]}
    />
  );
}
