import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function NivelTensaoPage() {
  return (
    <ModulePlaceholder
      title="Nivel de Tensao"
      description="Tela reservada para cadastro base de niveis de tensao."
      nextSteps={[
        "Listar niveis de tensao por tenant.",
        "Padronizar nomenclatura e ordenacao tecnica.",
        "Integrar o dominio com Projetos e Programacao.",
      ]}
    />
  );
}
