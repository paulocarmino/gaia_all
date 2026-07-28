import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ANSWER_TOKENS = 900;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const SUPPORTED_MEDIA_TYPES = Object.keys(EXTENSIONS);

export interface IncomingImage {
  mediaType: string;
  /** Base64, without the data: prefix. */
  data: string;
}

export interface StoredImage {
  id: string;
  mediaType: string;
}

export interface VisionOptions {
  modelId: string;
  baseUrl: string;
  apiKey: string;
  /** Single known directory for durable state, per the standing constraint. */
  imageDir: string;
}

interface CompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * GAIA's eye.
 *
 * Her brain cannot take images, so it does not: the eye reads them for her and
 * only text enters the transcript. Keeping the image out of the brain's history
 * is not an optimisation, it is required. A text-only model rejects the whole
 * request the moment an image appears in the conversation, so a single upload
 * would break every following turn.
 *
 * A one-shot call, so it talks to the API directly instead of standing up an
 * agent loop that would have no tools and one turn.
 */
export const createVision = (options: VisionOptions) => {
  const dir = resolve(options.imageDir);

  const pathFor = (id: string, mediaType: string): string =>
    resolve(dir, `${id}.${EXTENSIONS[mediaType] ?? "bin"}`);

  const ask = async (
    images: readonly StoredImage[],
    question: string,
    signal?: AbortSignal,
  ): Promise<string> => {
    const parts = await Promise.all(
      images.map(async (image) => {
        const bytes = await readFile(pathFor(image.id, image.mediaType));
        return {
          type: "image_url" as const,
          image_url: { url: `data:${image.mediaType};base64,${bytes.toString("base64")}` },
        };
      }),
    );

    const response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.modelId,
        max_tokens: MAX_ANSWER_TOKENS,
        messages: [
          {
            role: "system",
            content:
              "You are the visual system of an assistant that cannot see. Describe what is " +
              "actually in the image, answering the question you are given. Be concrete and " +
              "specific: exact text you can read, layout, colours, numbers, error messages. " +
              "Never speculate about what is not visible, and say so when something is unclear.",
          },
          { role: "user", content: [{ type: "text", text: question }, ...parts] },
        ],
      }),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Vision model failed: ${response.status} ${detail.slice(0, 300)}`.trim());
    }

    const body = (await response.json()) as CompletionResponse;
    const answer = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (answer === "") throw new Error("Vision model returned an empty reading");
    return answer;
  };

  return {
    supports: (mediaType: string): boolean => mediaType in EXTENSIONS,

    store: async (image: IncomingImage): Promise<StoredImage> => {
      if (!(image.mediaType in EXTENSIONS)) {
        throw new Error(`Unsupported image type: ${image.mediaType}`);
      }
      await mkdir(dir, { recursive: true });
      const id = randomUUID();
      await writeFile(pathFor(id, image.mediaType), Buffer.from(image.data, "base64"));
      return { id, mediaType: image.mediaType };
    },

    read: async (id: string, mediaType: string): Promise<Buffer> =>
      readFile(pathFor(id, mediaType)),

    ask,
  };
};

export type Vision = ReturnType<typeof createVision>;

const lookParams = Type.Object({
  image_id: Type.String({ description: "Id of an image Paulo attached earlier in this conversation." }),
  media_type: Type.String({ description: "Media type of that image, for example image/png." }),
  question: Type.String({
    description: "What you want to know about it. Be specific; a precise question gets a precise reading.",
  }),
});

/**
 * Lets her look again. The image stays on disk, so a second question about it
 * costs a re-read rather than asking Paulo to upload it twice.
 */
export const createLookAtImageTool = (vision: Vision): AgentTool<typeof lookParams> => ({
  name: "look_at_image",
  label: "Look at image",
  description:
    "Look again at an image Paulo attached earlier, asking a specific question about it. " +
    "Use this when you need a detail that the first reading did not cover.",
  parameters: lookParams,
  execute: async (_id, params, signal) => {
    const reading = await vision.ask(
      [{ id: params.image_id, mediaType: params.media_type }],
      params.question,
      signal,
    );
    return {
      content: [{ type: "text", text: reading }],
      details: { imageId: params.image_id },
    };
  },
});
