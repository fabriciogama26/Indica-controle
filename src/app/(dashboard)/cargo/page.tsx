import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function CargoPage() {
  return (
    <ModulePlaceholder
      title="Cargo"
      description="Tela reservada para cadastro e manutencao dos cargos do tenant."
      nextSteps={[
        "Listar cargos ativos e inativos por tenant.",
        "Permitir cadastro e edicao com validacao de duplicidade.",
        "Integrar o cadastro de cargos com o modulo de Pessoas.",
      ]}
    />
  );
}
