import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function EntradaPage() {
  return (
    <ModulePlaceholder
      title="Entrada"
      description="Tela reservada para lancamentos de entrada no estoque fisico."
      nextSteps={[
        "Definir formulario de entrada por centro de estoque.",
        "Preparar auditoria e aprovacao, se exigido.",
        "Conectar aos movimentos de estoque fisico.",
      ]}
    />
  );
}
