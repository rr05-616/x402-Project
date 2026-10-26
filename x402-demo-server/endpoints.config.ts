/**
 * GlassPitch AI x402 endpoint configuration.
 *
 * This follows the x402 Hackathon Starter Kit pattern:
 * endpoint -> payment requirement -> handler -> paid response.
 */
import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from "@x402/avm";
import { declareDiscoveryExtension } from "@x402-avm/extensions";

export interface EndpointConfig {
  [key: string]: {
    accepts: Array<{
      scheme: "exact";
      price: string;
      network: string;
      payTo: string;
      extra: { asset: number };
    }>;
    description: string;
    mimeType?: string;
    extensions?: Record<string, unknown>;
  };
}

export default function createPaymentConfig(
  avmAddress: string,
  enableDeckGeneration: boolean,
): EndpointConfig {
  const deckPrice = Number(process.env.DECK_PRICE_USD || "1.00");
  const price =
    Number.isFinite(deckPrice) && deckPrice > 0
      ? deckPrice.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")
      : "1";

  return {
    ...(enableDeckGeneration
      ? {
          "POST /generate-deck": {
            accepts: [
              {
                scheme: "exact",
                price: `$${price}`,
                network: ALGORAND_TESTNET_CAIP2,
                payTo: avmAddress,
                extra: { asset: Number(USDC_TESTNET_ASA_ID) },
              },
            ],
            description:
              "Source-grounded AI investor pitch deck generation — pay per premium deck with USDC on Algorand TestNet.",
            mimeType: "application/json",
            extensions: declareDiscoveryExtension({
              bodyType: "json",
              input: {
                projectName: "My Startup",
                sourceText: "Project source material",
                slideCount: 12,
              },
              inputSchema: {
                type: "object",
                properties: {
                  projectName: { type: "string" },
                  description: { type: "string" },
                  sourceText: { type: "string" },
                  slideCount: { type: "integer", enum: [12, 13] },
                  deckId: { type: "string" },
                },
                anyOf: [
                  { required: ["description"] },
                  { required: ["sourceText"] },
                ],
              },
              output: {
                example: {
                  success: true,
                  projectName: "My Startup",
                  slideCount: 12,
                  slides: [{ id: "slide-1", evidenceFactIds: ["fact-1"] }],
                },
              },
            }),
          },
        }
      : {}),

    // Keep one template endpoint enabled so the fork visibly retains the
    // original starter-kit pattern.
    "GET /weather": {
      accepts: [
        {
          scheme: "exact",
          price: "$0.005",
          network: ALGORAND_TESTNET_CAIP2,
          payTo: avmAddress,
          extra: { asset: Number(USDC_TESTNET_ASA_ID) },
        },
      ],
      description: "Template premium weather endpoint — $0.005 USDC.",
    },
  };
}
