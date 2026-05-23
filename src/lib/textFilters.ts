import { TextFilterConfig } from "../types";

export const DEFAULT_TEXT_FILTER_CONFIG: TextFilterConfig = {
  skipRoundBrackets: true,
  skipSquareBrackets: true,
  skipCurlyBrackets: true,
  skipUrls: true,
  skipSuperscriptSubscript: true,
  skipVerticalText: true,
};

export function normalizeTextFilterConfig(config?: Partial<TextFilterConfig> | null): TextFilterConfig {
  return {
    ...DEFAULT_TEXT_FILTER_CONFIG,
    ...(config || {}),
  };
}

export function buildTextFilterKey(config?: Partial<TextFilterConfig> | null) {
  const filters = normalizeTextFilterConfig(config);
  return [
    filters.skipRoundBrackets ? "r1" : "r0",
    filters.skipSquareBrackets ? "s1" : "s0",
    filters.skipCurlyBrackets ? "c1" : "c0",
    filters.skipUrls ? "u1" : "u0",
    filters.skipSuperscriptSubscript ? "x1" : "x0",
    filters.skipVerticalText ? "v1" : "v0",
  ].join("-");
}

function removeDelimitedSpans(text: string, openChar: string, closeChar: string) {
  let output = "";
  let hiddenSpan = "";
  let depth = 0;

  for (const character of text) {
    if (depth === 0) {
      if (character === openChar) {
        depth = 1;
        hiddenSpan = character;
        continue;
      }

      output += character;
      continue;
    }

    hiddenSpan += character;

    if (character === openChar) {
      depth += 1;
    } else if (character === closeChar) {
      depth -= 1;
      if (depth === 0) {
        hiddenSpan = "";
      }
    }
  }

  return depth > 0 ? `${output}${hiddenSpan}` : output;
}

function removeVerticalArtifacts(text: string) {
  return text
    .split("\n")
    .filter((line) => {
      const compact = line.replace(/\s+/g, "");
      return compact.length !== 1 || !/[\p{L}\p{N}]/u.test(compact);
    })
    .join("\n");
}

export function filterReadableText(rawText: string, config?: Partial<TextFilterConfig> | null) {
  const filters = normalizeTextFilterConfig(config);
  let text = rawText;

  if (filters.skipUrls) {
    text = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>(){}[\]"']+/gi, "");
  }

  if (filters.skipRoundBrackets) {
    text = removeDelimitedSpans(text, "(", ")");
  }

  if (filters.skipSquareBrackets) {
    text = removeDelimitedSpans(text, "[", "]");
  }

  if (filters.skipCurlyBrackets) {
    text = removeDelimitedSpans(text, "{", "}");
  }

  if (filters.skipSuperscriptSubscript) {
    text = text.replace(/[\u00B2\u00B3\u00B9\u2070-\u209F]+/g, "");
  }

  if (filters.skipVerticalText) {
    text = removeVerticalArtifacts(text);
  }

  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}