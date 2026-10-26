/**
 * Smoke tests for the GlassPitch x402 resource server.
 *
 * These tests deliberately avoid fabricating a successful payment. The
 * facilitator must be used for a real paid-flow test.
 */
import {
  AIProviderError,
  createAIProvider,
  DEFAULT_OPENAI_MODEL,
  isAIProviderConfigured,
  normalizeProviderError,
} from "./handlers/ai-provider.js";
import { handleDeckGenerationRequest } from "./handlers/deck-generation.js";
import createPaymentConfig from "./endpoints.config.js";

process.env.AVM_ADDRESS =
  process.env.AVM_ADDRESS ||
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
process.env.FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";
process.env.PORT = "0";
const originalOpenAIKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "test-key";

const { default: app, server } = await import("./index.js");

const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(`✗ ${name}`);
  console.log(`✓ ${name}`);
};

const testOpenAIProviderDefaults = async () => {
  const originalFetch = globalThis.fetch;
  let requestedModel: string | undefined;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    requestedModel = body.model;
    return Response.json({
      choices: [{ message: { content: '{"ok":true}' } }],
    });
  };
  try {
    const provider = createAIProvider({ OPENAI_API_KEY: "test-key" });
    if (!provider) throw new Error("Test provider failed to initialize.");
    const result = await provider.generateJson("system", "user");
    check(
      "OpenAI adapter parses structured JSON and sends the default model",
      (result as { ok?: boolean }).ok === true &&
        requestedModel === DEFAULT_OPENAI_MODEL,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const testOpenAIProviderSanitizesAuthErrors = async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: "raw provider error details",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      { status: 401 },
    );
  try {
    const provider = createAIProvider({ OPENAI_API_KEY: "test-key" });
    if (!provider) throw new Error("Test provider failed to initialize.");
    try {
      await provider.generateJson("system", "user");
      check("OpenAI authentication failures are surfaced", false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      check(
        "OpenAI authentication failures use sanitized messages",
        message.includes("OPENAI_API_KEY") &&
          !message.includes("raw provider error details"),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const testOpenAIProviderRateLimit = async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: "raw rate-limit details",
          type: "rate_limit_error",
          code: "rate_limit_exceeded",
        },
      },
      { status: 429 },
    );
  try {
    const provider = createAIProvider({ OPENAI_API_KEY: "test-key" });
    if (!provider) throw new Error("Test provider failed to initialize.");
    try {
      await provider.generateJson("system", "user");
      check("OpenAI rate limits are surfaced", false);
    } catch (error) {
      check(
        "OpenAI rate limits are mapped to a retryable sanitized response",
        error instanceof AIProviderError &&
          error.status === 503 &&
          error.code === "rate_limited" &&
          !error.message.includes("raw rate-limit details"),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const testOpenAIProviderQuota = async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: "raw quota details",
          type: "insufficient_quota",
          code: "insufficient_quota",
        },
      },
      { status: 429 },
    );
  try {
    const provider = createAIProvider({ OPENAI_API_KEY: "test-key" });
    if (!provider) throw new Error("Test provider failed to initialize.");
    try {
      await provider.generateJson("system", "user");
      check("OpenAI quota errors are surfaced", false);
    } catch (error) {
      check(
        "OpenAI quota exhaustion is reported without provider details",
        error instanceof AIProviderError &&
          error.status === 503 &&
          error.code === "quota_exhausted" &&
          !error.message.includes("raw quota details"),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const testOpenAIProviderTimeout = async () => {
  const timeout = new Error("raw timeout details");
  timeout.name = "APIConnectionTimeoutError";
  const normalized = normalizeProviderError(timeout);
  check(
    "OpenAI timeouts map to a bounded sanitized response",
    normalized.status === 504 &&
      normalized.code === "provider_timeout" &&
      !normalized.message.includes("raw timeout details"),
  );
};

const testOpenAIProviderMalformedResponse = async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ choices: [{ message: { content: "not-json" } }] });
  try {
    const provider = createAIProvider({ OPENAI_API_KEY: "test-key" });
    if (!provider) throw new Error("Test provider failed to initialize.");
    try {
      await provider.generateJson("system", "user");
      check("Malformed OpenAI JSON is rejected", false);
    } catch (error) {
      check(
        "Malformed OpenAI JSON has a sanitized error",
        error instanceof AIProviderError &&
          error.code === "malformed_response" &&
          !error.message.includes("not-json"),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const testOpenAIProviderEmptyResponse = async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [] });
  try {
    const provider = createAIProvider({ OPENAI_API_KEY: "test-key" });
    if (!provider) throw new Error("Test provider failed to initialize.");
    try {
      await provider.generateJson("system", "user");
      check("Empty OpenAI responses are surfaced", false);
    } catch (error) {
      check(
        "Empty OpenAI responses return a sanitized error",
        error instanceof AIProviderError && error.code === "empty_response",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const generateWithMockProvider = async (
  slideCount: 12 | 13,
  fabricateSourceQuote = false,
) => {
  const source =
    slideCount === 13
      ? "Acme is building a shipping toolkit.\nWe are raising $1,000,000 to expand."
      : "Acme is building a shipping toolkit.";
  const facts = [
    {
      id: "project",
      statement: "Acme is building a shipping toolkit.",
      sourceQuote: fabricateSourceQuote
        ? "Acme has 10 million customers."
        : "Acme is building a shipping toolkit.",
    },
  ];
  if (slideCount === 13) {
    facts.push({
      id: "funding",
      statement: "Acme is raising $1,000,000 to expand.",
      sourceQuote: "We are raising $1,000,000 to expand.",
    });
  }
  const outline = Array.from({ length: slideCount }, (_, index) => {
    const fundingSlide = slideCount === 13 && index === 12;
    return {
      id: `slide-${index + 1}`,
      title: fundingSlide ? "Funding Ask" : `Source slide ${index + 1}`,
      purpose: fundingSlide
        ? "State the requested capital."
        : "Present project facts.",
      layout: "summary",
      evidenceFactIds: [fundingSlide ? "funding" : "project"],
    };
  });
  const responses = [
    {
      facts,
      unknowns: [
        "Market size is not stated in the source.",
        "Financial details are not stated in the source.",
      ],
    },
    { slides: outline },
    {
      slides: outline.map((slide) => ({
        id: slide.id,
        layout: slide.layout,
        evidenceFactIds: slide.evidenceFactIds,
        body: [slide.purpose],
      })),
    },
  ];
  const originalFetch = globalThis.fetch;
  const previousEnvironment = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
  };
  let responseIndex = 0;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        { message: { content: JSON.stringify(responses[responseIndex++]) } },
      ],
    });
  try {
    return await handleDeckGenerationRequest(
      new Request("http://localhost/generate-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: "Acme",
          sourceText: source,
          slideCount,
        }),
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnvironment.key === undefined)
      delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousEnvironment.key;
    if (previousEnvironment.model === undefined)
      delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousEnvironment.model;
  }
};

const run = async () => {
  check(
    "OpenAI provider stays disabled without a server key",
    !isAIProviderConfigured({}),
  );
  check(
    "Missing OpenAI key omits the paid generation endpoint",
    !("POST /generate-deck" in createPaymentConfig("test-receiver", false)),
  );
  check(
    "OpenAI provider defaults to the balanced model",
    createAIProvider({ OPENAI_API_KEY: "test-key" }) !== null &&
      DEFAULT_OPENAI_MODEL === "gpt-4.1-mini",
  );
  await testOpenAIProviderDefaults();
  await testOpenAIProviderSanitizesAuthErrors();
  await testOpenAIProviderRateLimit();
  await testOpenAIProviderQuota();
  await testOpenAIProviderTimeout();
  await testOpenAIProviderMalformedResponse();
  await testOpenAIProviderEmptyResponse();

  const fundingRequired = await handleDeckGenerationRequest(
    new Request("http://localhost/generate-deck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceText: "A source-grounded project brief without a funding amount.",
        slideCount: 13,
      }),
    }),
  );
  check(
    "13-slide generation requires an explicit funding amount",
    fundingRequired.status === 400,
  );
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const unavailable = await handleDeckGenerationRequest(
    new Request("http://localhost/generate-deck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceText:
          "A valid source description that is more than twenty characters.",
      }),
    }),
  );
  if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey;
  const unavailableResult = (await unavailable.json()) as { error?: string };
  check(
    "Missing OpenAI key returns 503 before generation",
    unavailable.status === 503 &&
      unavailableResult.error?.includes("OPENAI_API_KEY") === true,
  );

  for (const slideCount of [12, 13] as const) {
    const generated = await generateWithMockProvider(slideCount);
    const result = (await generated.json()) as {
      slideCount?: number;
      slides?: unknown[];
      brief?: { unknowns?: string[] };
    };
    check(
      `${slideCount}-slide provider output passes validation`,
      generated.status === 200 &&
        result.slideCount === slideCount &&
        result.slides?.length === slideCount,
    );
    const unknowns = result.brief?.unknowns ?? [];
    check(
      `${slideCount}-slide brief preserves missing source information`,
      unknowns.some((unknown) => unknown.includes("Market size")) &&
        unknowns.some((unknown) => unknown.includes("Financial")),
    );
  }
  const unsupportedEvidence = await generateWithMockProvider(12, true);
  check(
    "Unsupported source quotations are rejected",
    unsupportedEvidence.status === 502,
  );

  const health = await app.request("/health");
  check("GET /health returns 200", health.status === 200);

  const info = await app.request("/info");
  check("GET /info returns 200", info.status === 200);

  const unpaid = await app.request("/generate-deck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectName: "Smoke Test",
      description:
        "A smoke test project description with source-grounded context.",
    }),
  });
  check("Configured generation requires x402 payment", unpaid.status === 402);
  check(
    "Configured endpoint exposes PAYMENT-REQUIRED",
    Boolean(unpaid.headers.get("PAYMENT-REQUIRED")),
  );

  const invalidBeforePayment = await app.request("/generate-deck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceText: "too short" }),
  });
  check(
    "Invalid generation input is rejected before x402 payment",
    invalidBeforePayment.status === 400 &&
      !invalidBeforePayment.headers.get("PAYMENT-REQUIRED"),
  );
  const malformedBeforePayment = await app.request("/generate-deck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  check(
    "Malformed JSON is rejected before x402 payment",
    malformedBeforePayment.status === 400 &&
      !malformedBeforePayment.headers.get("PAYMENT-REQUIRED"),
  );
  const oversizedBeforePayment = await app.request("/generate-deck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceText: "x".repeat(100_001) }),
  });
  check(
    "Oversized source is rejected before x402 payment",
    oversizedBeforePayment.status === 413 &&
      !oversizedBeforePayment.headers.get("PAYMENT-REQUIRED"),
  );

  const missing = await app.request("/does-not-exist");
  check("Unknown endpoint returns 404", missing.status === 404);

  console.log("\n✓ GlassPitch x402 smoke tests passed\n");
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.close();
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
  });
