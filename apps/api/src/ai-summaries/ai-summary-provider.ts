export const AI_SUMMARY_PROVIDER = Symbol("AI_SUMMARY_PROVIDER");

export type AiSummarySourceChange = {
  id: string;
  title: string;
  category: string;
  publicDescription: string;
};

export type AiSummaryProviderInput = {
  changes: AiSummarySourceChange[];
};

export type AiSummaryProviderOutput = {
  summary: string;
  model: string;
};

export interface AiSummaryProvider {
  readonly providerName: string;
  generate(input: AiSummaryProviderInput): Promise<AiSummaryProviderOutput>;
}
