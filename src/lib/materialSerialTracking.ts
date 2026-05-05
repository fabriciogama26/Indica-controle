export type SerialTrackingType = "NONE" | "TRAFO" | "RELIGADOR" | "CHAVE";

export function normalizeSerialTrackingType(value: unknown): SerialTrackingType {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "TRAFO" || normalized === "RELIGADOR" || normalized === "CHAVE") {
    return normalized;
  }

  return "NONE";
}

export function isSerialTrackedMaterial(value: unknown) {
  return normalizeSerialTrackingType(value) !== "NONE";
}

export function requiresLotCode(value: unknown) {
  return normalizeSerialTrackingType(value) === "TRAFO";
}

export function serialTrackingLabel(value: unknown) {
  const normalized = normalizeSerialTrackingType(value);
  if (normalized === "TRAFO") return "TRAFO";
  if (normalized === "RELIGADOR") return "Religador";
  if (normalized === "CHAVE") return "Chave";
  return "Nao";
}
