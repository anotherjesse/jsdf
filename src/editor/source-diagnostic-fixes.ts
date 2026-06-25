export const SDF_API_TYPO_MARKER_CODE = "sdf-api-typo";
export const SDF_DANGLING_MEMBER_MARKER_CODE = "sdf-dangling-member";

export const SDF_DANGLING_MEMBER_FIX_TITLE = "Remove dangling dot";

export function apiSuggestionTargetFromDiagnosticMessage(message: string): string | null {
  return message.match(/(?:^|\s)Did you mean ([^?\s]+)\?$/)?.[1] ?? null;
}

export function replacementTextForSuggestionTarget(target: string): string {
  const dotIndex = target.lastIndexOf(".");
  return dotIndex >= 0 ? target.slice(dotIndex + 1) : target;
}

export function titleForSuggestionTarget(target: string): string {
  return `Change to ${target}`;
}

export function markerCodeValue(code: unknown): string | null {
  if (typeof code === "string") return code;
  if (code && typeof code === "object" && "value" in code && typeof code.value === "string") {
    return code.value;
  }
  return null;
}
