import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function ImeiPage() {
  return (
    <ModulePlaceholder
      title="Imei"
      description="Tela reservada para cadastro base de identificadores IMEI."
      nextSteps={[
        "Listar IMEIs cadastrados por tenant.",
        "Validar formato e unicidade dos identificadores.",
        "Integrar o cadastro com os fluxos operacionais necessarios.",
      ]}
    />
  );
}
