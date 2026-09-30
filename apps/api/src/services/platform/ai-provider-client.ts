import OpenAI from "openai";
import { readSelectedAiProvider } from "@meowbert/shared";
import { query } from "../../lib/db.js";

export async function getPlatformAiClient(): Promise<OpenAI | null> {
  const provider = await readSelectedAiProvider(query);
  return provider ? new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl }) : null;
}
