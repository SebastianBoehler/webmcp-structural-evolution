export const TOOL_OUTPUT_LIMIT = 1500;

export const serializeToolFacts = (value: unknown): string => JSON.stringify(value);

export const toolFactsFit = (value: unknown): boolean =>
  serializeToolFacts(value).length <= TOOL_OUTPUT_LIMIT;
