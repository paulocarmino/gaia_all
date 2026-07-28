import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Attachment,
  type Health,
  type StoredImage,
  fetchTranscript,
  health as fetchHealth,
  openStream,
  sendMessage,
} from "./api.ts";
import { type Entry, reduceEvent } from "./transcript.ts";

export const useConversation = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const setRun = useCallback((value: boolean) => {
    runningRef.current = value;
    setRunning(value);
  }, []);

  // The conversation lives in the core, so a reload reads it back.
  useEffect(() => {
    void (async () => {
      try {
        const body = await fetchTranscript();
        setEntries(
          body.messages.map((message, index) =>
            message.kind === "user"
              ? {
                  kind: "user" as const,
                  id: `h-${index}`,
                  at: message.at,
                  text: message.text,
                  images: message.images ?? [],
                  steered: false,
                  ...(message.visionReading === undefined
                    ? {}
                    : { visionReading: message.visionReading }),
                }
              : {
                  kind: "gaia" as const,
                  id: `h-${index}`,
                  at: message.at,
                  text: message.text,
                  streaming: false,
                },
          ),
        );
        setRun(body.busy);
      } catch {
        // The gate handles an unreachable core; nothing useful to do here.
      }
    })();
  }, [setRun]);

  useEffect(() => {
    const close = openStream(
      (type, data) => {
        setEntries((current) => {
          const next = reduceEvent(current, type, data, { running: runningRef.current });
          if (next.running !== runningRef.current) setRun(next.running);
          return next.entries;
        });
      },
      (isConnected) => setConnected(isConnected),
    );
    return close;
  }, [setRun]);

  useEffect(() => {
    const tick = () => {
      void fetchHealth()
        .then(setHealth)
        .catch(() => setHealth(null));
    };
    tick();
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, []);

  const send = useCallback(
    async (text: string, attachments: Attachment[]): Promise<void> => {
      setError(null);
      // Optimistic: the stream echoes the real message, but the input should
      // never feel like it swallowed what was typed.
      const optimisticId = `local-${Date.now()}`;
      const images: StoredImage[] = attachments.map((attachment, index) => ({
        id: `${optimisticId}-${index}`,
        mediaType: attachment.mediaType,
      }));
      setEntries((current) => [
        ...current,
        {
          kind: "user",
          id: optimisticId,
          at: Date.now(),
          text,
          images,
          steered: runningRef.current,
          pending: true,
          previews: attachments.map(
            (attachment) => `data:${attachment.mediaType};base64,${attachment.data}`,
          ),
        },
      ]);

      try {
        const response = await sendMessage(text, attachments);
        if (response.images !== undefined && response.images.length > 0) {
          const stored = response.images;
          // Real ids now exist, so drop the heavy data URLs and serve from disk.
          setEntries((current) =>
            current.map((entry) =>
              entry.id === optimisticId && entry.kind === "user"
                ? { ...entry, images: stored, previews: undefined }
                : entry,
            ),
          );
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falha ao enviar");
      }
    },
    [],
  );

  return { entries, running, connected, health, error, send, clearError: () => setError(null) };
};
