import { PiFormPageView } from "@/modules/dashboard/permissao-intervencao";

export default async function PermissaoIntervencaoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PiFormPageView piId={id} />;
}
