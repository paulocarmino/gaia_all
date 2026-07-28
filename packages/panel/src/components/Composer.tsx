import { useRef, useState } from "react";
import type { Attachment } from "@/lib/api";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGES = 4;

interface Pending extends Attachment {
  name: string;
  preview: string;
}

const toAttachment = (file: File): Promise<Pending> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Não consegui ler ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        mediaType: file.type,
        data: result.slice(result.indexOf(",") + 1),
        name: file.name,
        preview: result,
      });
    };
    reader.readAsDataURL(file);
  });

/**
 * The input never locks while she works. That is the whole point of steering:
 * a correction typed mid-run reaches the turn that is already running.
 */
export const Composer = ({
  running,
  onSend,
}: {
  running: boolean;
  onSend: (text: string, images: Attachment[]) => Promise<void>;
}) => {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const accept = async (files: FileList | File[]): Promise<void> => {
    const usable = [...files].filter((file) => ACCEPTED.includes(file.type));
    if (usable.length === 0) return;
    const loaded = await Promise.all(usable.map(toAttachment));
    setPending((current) => [...current, ...loaded].slice(0, MAX_IMAGES));
  };

  const submit = async (): Promise<void> => {
    const message = text.trim();
    if (message === "" && pending.length === 0) return;
    const images = pending.map(({ mediaType, data }) => ({ mediaType, data }));
    setText("");
    setPending([]);
    await onSend(message === "" ? "(imagem)" : message, images);
  };

  return (
    <div
      className={`border-t px-5 py-3 transition-colors ${
        dragging ? "border-term-user bg-term-panel" : "border-term-line"
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void accept(event.dataTransfer.files);
      }}
    >
      {pending.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((image, index) => (
            <div key={`${image.name}-${index}`} className="group relative">
              <img
                src={image.preview}
                alt={image.name}
                className="border-term-line h-14 w-14 border object-cover"
              />
              <button
                type="button"
                onClick={() => setPending((current) => current.filter((_, i) => i !== index))}
                className="bg-term-bg text-term-dim hover:text-term-alert border-term-line absolute -top-1.5 -right-1.5 h-4 w-4 border text-micro leading-none"
                aria-label={`remover ${image.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-2">
        <span className={`mt-1 select-none ${running ? "text-term-tool" : "text-term-gaia"}`}>
          {running ? "↩" : ">"}
        </span>
        <textarea
          ref={area}
          rows={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const node = event.target;
            node.style.height = "auto";
            node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.items]
              .filter((item) => item.kind === "file")
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);
            if (files.length > 0) {
              event.preventDefault();
              void accept(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={running ? "ela está trabalhando — pode mandar mesmo assim" : "escreva…"}
          className="text-term-fg placeholder:text-term-faint/70 term-scroll max-h-[220px] min-h-6 flex-1 resize-none bg-transparent leading-[1.65] outline-none"
        />
      </div>

      <input
        ref={picker}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files !== null) void accept(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="text-term-faint mt-2 flex items-center gap-4 text-micro">
        <span>enter envia · shift+enter quebra linha</span>
        <button
          type="button"
          onClick={() => picker.current?.click()}
          className="hover:text-term-dim underline decoration-dotted underline-offset-2"
        >
          anexar imagem
        </button>
        <span className="text-term-faint">ou cole / arraste</span>
        {running ? <span className="text-term-tool">o que você mandar entra no turno atual</span> : null}
      </div>
    </div>
  );
};
