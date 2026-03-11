import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function TipoServicoPage() {
  return (
    <ModulePlaceholder
      title="Tipo de Servico"
      description="Tela reservada para cadastro base de tipos de servico."
      nextSteps={[
        "Listar tipos de servico por tenant.",
        "Permitir cadastro e ajuste de descricao.",
        "Integrar com Programacao e Medicao.",
      ]}
    />
  );
}
