import type { NamingRule } from "../types/exportMode";

const RULES: NamingRule[] = ["img", "svg"];

export function getNamingRule(nodeName: string): NamingRule | null {
  const normalized = nodeName.trim().toLowerCase();
  const bracketed = normalized.match(/^\[(img|svg)\]$/);

  if (bracketed) {
    return bracketed[1] as NamingRule;
  }

  for (const rule of RULES) {
    if (
      normalized === rule ||
      normalized.startsWith(`${rule} `) ||
      normalized.startsWith(`${rule}:`) ||
      normalized.startsWith(`${rule}/`)
    ) {
      return rule;
    }
  }

  return null;
}
