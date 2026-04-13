export const DEBUG = false;

export function debugLog(label, details) {
  if (!DEBUG) return;
  if (typeof details === "undefined") {
    console.log(`[debug] ${label}`);
    return;
  }
  console.log(`[debug] ${label}`, details);
}
