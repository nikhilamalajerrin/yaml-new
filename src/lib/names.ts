// src/lib/names.ts
export const shortName = (full?: string) =>
    (full || "").split(".").pop() || full || "";
  