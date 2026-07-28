import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AuthImage } from "@/components/AuthImage";
import { imageUrl } from "@/lib/api";
import { type Entry, toolLabel } from "@/lib/transcript";

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const Speaker = ({ who, at, note }: { who: string; at: number; note?: string }) => (
  <div className="mb-1.5 flex items-baseline gap-2 text-meta">
    <span className={who === "voce" ? "text-term-user" : "text-term-gaia"}>{who}</span>
    <span className="text-term-faint">{clock(at)}</span>
    {note ? <span className="text-term-tool">{note}</span> : null}
  </div>
);

/** Markdown, styled to stay inside the monospace world instead of fighting it. */
const Prose = ({ text }: { text: string }) => (
  <div
    className="text-term-fg max-w-none text-body leading-[1.65]
      [&_a]:text-term-user [&_a]:underline [&_a]:underline-offset-2
      [&_blockquote]:border-l-2 [&_blockquote]:border-term-line [&_blockquote]:pl-3 [&_blockquote]:text-term-dim
      [&_code]:bg-term-panel [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-term-tool [&_code]:text-code
      [&_em]:text-term-dim [&_em]:not-italic
      [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-body [&_h1]:tracking-widest [&_h1]:uppercase [&_h1]:text-term-dim
      [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-body [&_h2]:tracking-widest [&_h2]:uppercase [&_h2]:text-term-dim
      [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-body [&_h3]:text-term-fg
      [&_li]:my-0.5 [&_li::marker]:text-term-faint
      [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5
      [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
      [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:border-l-2 [&_pre]:border-term-line [&_pre]:bg-term-panel [&_pre]:p-3
      [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-term-fg
      [&_strong]:text-white [&_strong]:font-semibold
      [&_table]:my-2 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-code
      [&_td]:border-t [&_td]:border-term-line [&_td]:py-1 [&_td]:pr-4 [&_td]:align-top
      [&_th]:pr-4 [&_th]:pb-1 [&_th]:text-left [&_th]:font-normal [&_th]:text-term-dim
      [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
  >
    <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
  </div>
);

/**
 * She cannot see, so an image is read for her. Showing that reading is honest
 * about the mechanism, and it is also how you catch the eye getting it wrong.
 */
const EyeReading = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const body = text.replace(/^\[[^\]]*\]\s*/s, "").trim();

  return (
    <div className="border-term-line/70 mt-2 border-l-2 pl-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-term-tool hover:text-term-fg flex items-baseline gap-2 text-meta"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>o olho leu a imagem</span>
        <span className="text-term-faint">{open ? "" : "mostrar"}</span>
      </button>
      {open ? (
        <div className="text-term-dim mt-1.5 whitespace-pre-wrap text-meta leading-[1.6]">
          {body}
        </div>
      ) : null}
    </div>
  );
};

const ToolLine = ({ entry }: { entry: Extract<Entry, { kind: "tool" }> }) => {
  const target =
    typeof entry.args["repo"] === "string"
      ? String(entry.args["repo"])
      : typeof entry.args["content"] === "string"
        ? String(entry.args["content"]).slice(0, 48)
        : undefined;

  const mark =
    entry.status === "running" ? (
      <span className="text-term-tool animate-pulse">▸</span>
    ) : entry.status === "error" ? (
      <span className="text-term-alert">✕</span>
    ) : (
      <span className="text-term-gaia">✓</span>
    );

  return (
    <div className="border-term-line/70 my-2 flex flex-wrap items-baseline gap-x-2 border-l-2 pl-3 text-meta">
      {mark}
      <span className="text-term-tool">{toolLabel(entry.name)}</span>
      {target ? <span className="text-term-dim truncate">{target}</span> : null}
      {entry.summary ? <span className="text-term-dim">via {entry.summary}</span> : null}
      {entry.durationMs !== undefined ? (
        <span className="text-term-faint">{(entry.durationMs / 1000).toFixed(1)}s</span>
      ) : null}
      {entry.status === "running" ? <span className="text-term-faint">trabalhando…</span> : null}
    </div>
  );
};

export const Transcript = ({ entries, running }: { entries: Entry[]; running: boolean }) => {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, running]);

  if (entries.length === 0) {
    return (
      <div className="text-term-dim px-5 py-10 text-meta">
        <span className="text-term-gaia">gaia</span> está de pé e lembra do que você contou antes.
        Escreva abaixo.
      </div>
    );
  }

  return (
    <div className="px-5 py-6">
      {entries.map((entry) => {
        if (entry.kind === "tool") return <ToolLine key={entry.id} entry={entry} />;

        if (entry.kind === "note") {
          return (
            <div
              key={entry.id}
              className={`my-2 text-meta ${
                entry.tone === "error" ? "text-term-alert" : "text-term-dim"
              }`}
            >
              {entry.text}
            </div>
          );
        }

        if (entry.kind === "user") {
          return (
            <div key={entry.id} className="mb-5">
              <Speaker
                who="voce"
                at={entry.at}
                {...(entry.steered ? { note: "↩ no meio do trabalho" } : {})}
              />
              <div className="text-term-fg whitespace-pre-wrap text-body leading-[1.65]">
                {entry.text}
              </div>
              {entry.images.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {entry.images.map((image, index) => (
                    <AuthImage
                      key={image.id}
                      src={imageUrl(image)}
                      {...(entry.previews?.[index] === undefined
                        ? {}
                        : { local: entry.previews[index] })}
                      alt="anexo"
                      className="border-term-line max-h-40 border"
                    />
                  ))}
                </div>
              ) : null}
              {entry.visionReading !== undefined ? <EyeReading text={entry.visionReading} /> : null}
            </div>
          );
        }

        return (
          <div key={entry.id} className="mb-5">
            <Speaker who="gaia" at={entry.at} />
            <Prose text={entry.text} />
            {entry.streaming ? <span className="text-term-gaia animate-pulse">▊</span> : null}
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
};
