import grammarJson from "../kumiki.tmLanguage.json" with { type: "json" };

export interface TextMateGrammar {
  name: string;
  scopeName: string;
  displayName?: string;
  fileTypes?: string[];
  patterns: unknown[];
  repository?: Record<string, unknown>;
  [key: string]: unknown;
}

export const kumikiGrammar: TextMateGrammar = grammarJson;

export default kumikiGrammar;
