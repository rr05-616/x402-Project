# GlassPitch AI — x402 Resource Server

This directory is the **payment backend** for GlassPitch AI. It follows the
structure and middleware pattern of the official x402 Hackathon Starter Kit,
with a custom `POST /generate-deck` use case.

## x402 flow

```text
GlassPitch frontend
      |
      | POST /generate-deck
      v
Hono + @x402/hono
      |
      | provider configured + no payment
      v
HTTP 402 + PAYMENT-REQUIRED
      |
      | wallet signs x402 payment
      v
PAYMENT-SIGNATURE
      |
      v
GoPlausible facilitator
      |
      v
Algorand TestNet / USDC
      |
      v
200 + premium deck generation result
```

The current x402 v2 protocol uses `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and
`PAYMENT-RESPONSE` headers. The official SDK handles those encodings.

Live AI generation uses the official OpenAI Node SDK and requires the
server-only `OPENAI_API_KEY`. `OPENAI_MODEL` is optional and defaults to
`gpt-4.1-mini`. The server validates source quotations, slide count, layouts,
and evidence references before returning content. No provider credentials are
stored in this repository. If a key is not configured, `/generate-deck` is not
payment-protected and returns HTTP 503; the frontend's local source-based
generation remains available.

The unused legacy `handlers/meme-generator.ts` module imports native
`canvas`, but no server route imports or exposes it. The core server TypeScript
build excludes that optional module so deployments do not need native Cairo
build dependencies; wiring that feature into a route requires separately
installing and validating `canvas` for the target platform.

## Endpoints

| Endpoint              |                                  Price | Purpose                                       |
| --------------------- | -------------------------------------: | --------------------------------------------- |
| `POST /generate-deck` | $1.00 USDC when provider is configured | Source-grounded premium pitch-deck generation |
| `GET /weather`        |                            $0.005 USDC | Starter-kit demonstration endpoint            |
| `GET /health`         |                                   Free | Health check                                  |
| `GET /info`           |                                   Free | Service information                           |
| `GET /`               |                                   Free | Service status                                |

## Local setup

```bash
cd x402-demo-server
npm install
copy .env.example .env
```

Set:

```env
AVM_ADDRESS=YOUR_ALGORAND_TESTNET_RECEIVER
FACILITATOR_URL=https://facilitator.goplausible.xyz
PORT=4021
DECK_PRICE_USD=1.00
OPENAI_API_KEY=YOUR_SERVER_SIDE_API_KEY
OPENAI_MODEL=gpt-4.1-mini
```

Keep the API key on the server and never expose it through a frontend `VITE_*`
variable. Requests have a 45-second timeout and do not retry automatically.
Invalid keys, exhausted quota, rate limits, timeouts, and provider outages
return sanitized errors. A 13-slide deck requires an explicit funding amount
in the source; otherwise generation is capped at 12 slides.

Run:

```bash
npm run dev
```

Check:

```bash
curl http://localhost:4021/health
```

A request without payment returns `402` only when the OpenAI key is configured.
Without a key, the endpoint returns `503` and does not request payment.
Include source material in the request:

```bash
curl -i -X POST http://localhost:4021/generate-deck ^
  -H "Content-Type: application/json" ^
  -d "{\"projectName\":\"GlassPitch Demo\",\"description\":\"Describe the project using only facts that should appear in the deck.\"}"
```

## Deployment

This is a long-running Node/Hono server, so deploy it separately from the
Vite frontend. Render or Fly.io can run the included Dockerfile.

After deployment, set the Vercel frontend variable:

```env
VITE_X402_SERVER_URL=https://YOUR-X402-SERVER
```

## Hackathon compliance

The parent repository remains the fork of `marotipatre/x402-Project`. This
server keeps the starter-kit concepts:

- `x402-demo-server/`
- `endpoints.config.ts`
- `handlers/`
- Hono server
- x402 payment middleware
- Algorand TestNet + USDC
- a custom payment-protected endpoint

The custom endpoint is:

```text
POST /generate-deck
```

That is the core GlassPitch AI x402 use case.
