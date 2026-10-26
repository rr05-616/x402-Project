import OpenAI, { APIError } from "openai";

export interface AIProvider {
  generateJson(systemPrompt: string, userPrompt: string): Promise<unknown>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = "provider_error",
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 45_000;

export function normalizeProviderError(error: unknown): AIProviderError {
  if (error instanceof APIError) {
    if (error.status === 401) {
      return new AIProviderError(
        "OpenAI rejected the server API key. Replace OPENAI_API_KEY with a valid key.",
        503,
        "invalid_api_key",
      );
    }
    if (error.status === 429 && error.code === "insufficient_quota") {
      return new AIProviderError(
        "OpenAI API quota is exhausted. Check the account's billing and usage limits.",
        503,
        "quota_exhausted",
      );
    }
    if (error.status === 429) {
      return new AIProviderError(
        "OpenAI is rate limiting requests. Try again shortly.",
        503,
        "rate_limited",
      );
    }
    if (error.status >= 500) {
      return new AIProviderError(
        "OpenAI is temporarily unavailable. Try again later.",
        503,
        "provider_unavailable",
      );
    }
    return new AIProviderError(
      "OpenAI rejected the generation request. Check the configured model and request limits.",
      502,
      "invalid_request",
    );
  }

  if (error instanceof Error && error.name === "APIConnectionTimeoutError") {
    return new AIProviderError(
      "OpenAI generation timed out. Try again.",
      504,
      "provider_timeout",
    );
  }
  if (error instanceof Error && error.name === "APIConnectionError") {
    return new AIProviderError(
      "Could not connect to OpenAI. Try again later.",
      503,
      "provider_connection_error",
    );
  }
  return new AIProviderError(
    "OpenAI generation failed unexpectedly. Try again later.",
    502,
    "provider_error",
  );
}

interface ProviderConfig {
  apiKey: string;
  model: string;
}

function getProviderConfig(env: NodeJS.ProcessEnv): ProviderConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
  };
}

export function isAIProviderConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getProviderConfig(env) !== null;
}

/** OpenAI credentials stay server-side; the frontend never receives this client. */
export function createAIProvider(
  env: NodeJS.ProcessEnv = process.env,
): AIProvider | null {
  const config = getProviderConfig(env);
  if (!config) return null;

  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  return {
    async generateJson(systemPrompt, userPrompt) {
      let result;
      try {
        result = await client.chat.completions.create({
          model: config.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });
      } catch (error) {
        throw normalizeProviderError(error);
      }

      const content = result.choices[0]?.message?.content;
      if (!content) {
        throw new AIProviderError(
          "OpenAI returned no structured content. Try again.",
          502,
          "empty_response",
        );
      }
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new AIProviderError(
          "OpenAI returned malformed JSON. Try again.",
          502,
          "malformed_response",
        );
      }
    },
  };
}
