import "server-only";

// Calls OpenRouter for the first pass (ADR-0015). Every request is pinned to one US route with no
// fallback and zero data retention. A reply that was not served by that route is refused.

export const MODELS = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
] as const;

export const ROUTE_TAG = "amazon-bedrock/us-east-1";
const UPSTREAM_PROVIDER = "Amazon Bedrock";

const ROUTING = {
  only: [ROUTE_TAG],
  allow_fallbacks: false,
  zdr: true,
  data_collection: "deny",
  require_parameters: true,
};

export const MODEL_SETTINGS = { temperature: 0, max_tokens: 400, routing: ROUTING };

type Message = { role: "system" | "user"; content: string };

export type ModelReply = {
  content: string;
  generationId: string;
  upstreamProvider: string;
  dataRegionReported: string | null;
};

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in .env.local");
  return key;
}

// The generation record can take a moment to appear. Its data region is kept with the proposal.
async function dataRegionFor(generationId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
      { headers: { Authorization: `Bearer ${apiKey()}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (response.ok) {
      const body = (await response.json()) as { data?: { data_region?: string | null } };
      if (body.data) return body.data.data_region ?? null;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}

export async function askModel(model: string, messages: Message[]): Promise<ModelReply> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...MODEL_SETTINGS, provider: ROUTING }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}`);
  }

  const body = (await response.json()) as {
    id?: string;
    provider?: string;
    choices?: { message?: { content?: string | null } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!body.id || typeof content !== "string") throw new Error("OpenRouter reply had no content");
  if (body.provider !== UPSTREAM_PROVIDER) {
    throw new Error(`Reply was served by ${body.provider ?? "an unknown provider"}, not the pinned route`);
  }

  return {
    content,
    generationId: body.id,
    upstreamProvider: body.provider,
    dataRegionReported: await dataRegionFor(body.id),
  };
}
