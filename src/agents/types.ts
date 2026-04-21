export interface SubAgent {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
}
