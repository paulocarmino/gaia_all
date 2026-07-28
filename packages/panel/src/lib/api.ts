/**
 * In production Fastify serves this build, so the core is at the root of the
 * same origin. In dev Vite proxies /api to it. Either way the client never
 * hardcodes a host.
 */
const BASE = import.meta.env.DEV ? "/api" : "";

const TOKEN_KEY = "gaia.token";

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export interface Attachment {
  mediaType: string;
  data: string;
}

export interface StoredImage {
  id: string;
  mediaType: string;
}

export interface ChatResponse {
  mode: "started" | "steered";
  reply: string;
  images?: StoredImage[];
}

export interface Health {
  status: string;
  model: string;
  busy: boolean;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const authHeaders = (): HeadersInit => {
  const token = getToken();
  return token === null ? {} : { authorization: `Bearer ${token}` };
};

export const health = async (): Promise<Health> => {
  const response = await fetch(`${BASE}/health`);
  if (!response.ok) throw new ApiError("Core unreachable", response.status);
  return (await response.json()) as Health;
};

/** Cheapest possible probe that the token is accepted, used by the gate. */
export const verifyToken = async (token: string): Promise<boolean> => {
  const response = await fetch(`${BASE}/images/00000000-0000-0000-0000-000000000000`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return response.status !== 401;
};

export const sendMessage = async (
  message: string,
  images: Attachment[],
  signal?: AbortSignal,
): Promise<ChatResponse> => {
  const response = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(images.length === 0 ? { message } : { message, images }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new ApiError(body.detail ?? body.error ?? `Request failed`, response.status);
  }
  return (await response.json()) as ChatResponse;
};

export const imageUrl = (image: StoredImage): string => `${BASE}/images/${image.id}`;

export interface TranscriptMessage {
  kind: "user" | "gaia";
  text: string;
  at: number;
  visionReading?: string;
  images?: StoredImage[];
}

/** The conversation as the core knows it, so a reload does not lose the thread. */
export const fetchTranscript = async (): Promise<{
  messages: TranscriptMessage[];
  busy: boolean;
  model: string;
}> => {
  const response = await fetch(`${BASE}/messages`, { headers: authHeaders() });
  if (!response.ok) throw new ApiError("Could not load the conversation", response.status);
  return (await response.json()) as { messages: TranscriptMessage[]; busy: boolean; model: string };
};

/** Fetches an image with the bearer token and returns a blob URL for <img>. */
export const authenticatedImage = async (url: string): Promise<string> => {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new ApiError("Image unavailable", response.status);
  return URL.createObjectURL(await response.blob());
};

/**
 * EventSource cannot send an Authorization header, so the stream is read as a
 * fetch body. Same endpoint, same events, no second auth mechanism.
 */
export const openStream = (
  onEvent: (type: string, data: unknown) => void,
  onStatus: (connected: boolean) => void,
): (() => void) => {
  const controller = new AbortController();
  let stopped = false;

  const run = async (): Promise<void> => {
    while (!stopped) {
      try {
        const response = await fetch(`${BASE}/stream`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        if (!response.ok || response.body === null) throw new Error(`stream ${response.status}`);

        onStatus(true);
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            let type = "message";
            const payload: string[] = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event: ")) type = line.slice(7).trim();
              else if (line.startsWith("data: ")) payload.push(line.slice(6));
            }
            if (payload.length === 0) continue;
            try {
              onEvent(type, JSON.parse(payload.join("\n")));
            } catch {
              // A malformed frame is not worth tearing the stream down for.
            }
          }
        }
      } catch {
        if (stopped) return;
        onStatus(false);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  };

  void run();

  return () => {
    stopped = true;
    controller.abort();
  };
};
