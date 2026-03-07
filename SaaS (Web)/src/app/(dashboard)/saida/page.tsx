import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function SaidaPage() {
  return (
    <ModulePlaceholder
      title="Saida"
      description="Tela reservada para lancamentos de saida do estoque fisico."
      nextSteps={[
        "Definir destino da saida.",
        "Registrar motivo e movimento.",
        "Conectar ao saldo fisico consolidado.",
      ]}
    />
  );
}
