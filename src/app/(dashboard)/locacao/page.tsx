import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function LocacaoPage() {
  return (
    <ModulePlaceholder
      title="Locacao"
      description="Tela reservada para controle de locacao de recursos."
      nextSteps={[
        "Definir origem e destino da locacao.",
        "Controlar periodo, custo e status da locacao.",
        "Integrar o impacto de saldo no estoque.",
      ]}
    />
  );
}
