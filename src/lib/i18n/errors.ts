import { t } from "$lib/i18n";

/**
 * Rust commands reject with short codes (`io`, `not_found`, `mcp_config_failed`).
 * Map the code to localized copy, falling back to the generic message so a raw
 * code never reaches the user.
 */
export function errorMessage(e: unknown): string {
  const raw = String(e ?? "");
  const code = raw.split(" ").pop() ?? raw;
  return t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : t("errors.generic");
}

/**
 * Import warnings arrive from Rust as codes, not prose, because Rust must not
 * hold UI strings. An unknown code still shows something: a format added later
 * should degrade to its raw code rather than to silence.
 */
export function warningMessage(code: string): string {
  const key = `errors.${code}`;
  const copy = t(key);
  return copy === key ? code : copy;
}
