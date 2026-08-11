/**
 * Model providers for directed rewrites.
 *
 * Keys are server-side only. A key in the browser is a published key, so the
 * client never sees one: it names a model, and this module decides which
 * credential that implies. Same posture as DOCFORGE_GH_TOKEN.
 *
 * Providers are reached over plain fetch rather than an SDK. Two REST calls do
 * not justify two dependencies in the Vercel bundle, and it keeps adding a
 * third provider later a change to this file alone.
 */

export type Provider = "anthropic" | "openai";

export type ModelSpec = {
  id: string;
  label: string;
  provider: Provider;
};

/**
 * The models Studio offers. Andrew asked for everything current from both
 * vendors; ordering is deliberate — the first entry of each provider is the
 * sensible default, not the largest.
 */
export const MODELS: ModelSpec[] = [
  // Anthropic. Verified against GET /v1/models on 2026-08-11.
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "anthropic" },

  // OpenAI. Verified against GET /v1/models on 2026-08-11.
  { id: "gpt-5.5", label: "GPT-5.5", provider: "openai" },
  { id: "gpt-5.5-pro", label: "GPT-5.5 Pro", provider: "openai" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "openai" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai" },
  { id: "o3", label: "o3 (reasoning)", provider: "openai" },
  { id: "o4-mini", label: "o4-mini (reasoning)", provider: "openai" },

  // Additional providers go here — add a ModelSpec entry and a branch in
  // complete(). Nothing else in the app names a model.
];

/**
 * Sonnet: fast and capable enough for iterative editing without Opus pricing
 * on every keystroke-scale rewrite.
 */
export const DEFAULT_MODEL = "claude-sonnet-5";

export function findModel(id: string): ModelSpec | null {
  return MODELS.find((m) => m.id === id) ?? null;
}

function keyFor(provider: Provider): string | null {
  const key =
    provider === "anthropic"
      ? process.env.DOCFORGE_ANTHROPIC_KEY
      : process.env.DOCFORGE_OPENAI_KEY;
  return key && key.trim() ? key.trim() : null;
}

/**
 * Models we can actually call right now.
 *
 * The picker shows only these. Offering a model whose key is missing turns a
 * deploy-time configuration gap into a runtime failure the author discovers
 * mid-edit, which is the wrong place to learn it.
 */
export function availableModels(): ModelSpec[] {
  return MODELS.filter((m) => keyFor(m.provider) !== null);
}

export class ModelError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * One completion. Returns the model's text, nothing else — callers own
 * validation, diffing and staging.
 *
 * Temperature is low and fixed. This is editing under instruction, not
 * ideation: the author asked for a specific change and variance between runs
 * of the same prompt reads as unreliability, not creativity.
 */
export async function complete(opts: {
  model: ModelSpec;
  system: string;
  user: string;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { model, system, user, maxTokens = 8000, signal } = opts;
  const key = keyFor(model.provider);
  if (!key) {
    throw new ModelError(
      `No API key configured for ${model.provider}. Set DOCFORGE_${model.provider.toUpperCase()}_KEY.`,
      503
    );
  }

  if (model.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: maxTokens,
        // No temperature: newer Claude models (5.x) reject it as a settable
        // parameter (400 `temperature is deprecated for this model`), and
        // older models are perfectly usable on their default. Editing under
        // instruction does not need a knob here — low variance is what
        // instruction-following already gives you.
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal,
    });
    if (!res.ok) {
      throw new ModelError(await describeFailure(res, "Anthropic"), res.status);
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b: { type?: string }) => b.type === "text")
      .map((b: { text?: string }) => b.text || "")
      .join("")
      .trim();
    if (!text) throw new ModelError("Anthropic returned an empty response.");
    return text;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model.id,
      max_completion_tokens: maxTokens,
      // No temperature: reasoning models (o3, o4-mini) reject it outright,
      // and the same reasoning as the Anthropic branch applies to the rest —
      // this is instruction-following, not open-ended generation.
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    throw new ModelError(await describeFailure(res, "OpenAI"), res.status);
  }
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new ModelError("OpenAI returned an empty response.");
  return text;
}

/**
 * Provider errors say what happened in the provider's own words where they
 * offer them. A bare status code sends the author to the logs; the message
 * usually names the real problem (bad key, rate limit, context length).
 */
async function describeFailure(res: Response, vendor: string): Promise<string> {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.message || "";
  } catch {
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      detail = "";
    }
  }
  if (res.status === 401 || res.status === 403) {
    return `${vendor} rejected the API key (${res.status}).${detail ? " " + detail : ""}`;
  }
  if (res.status === 429) {
    return `${vendor} rate limit reached. Try again shortly.${detail ? " " + detail : ""}`;
  }
  return `${vendor} request failed (${res.status}).${detail ? " " + detail : ""}`;
}
