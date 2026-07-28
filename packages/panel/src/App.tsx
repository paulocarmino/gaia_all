import { useState } from "react";
import { Composer } from "@/components/Composer";
import { TokenGate } from "@/components/TokenGate";
import { Transcript } from "@/components/Transcript";
import { clearToken, getToken } from "@/lib/api";
import { useConversation } from "@/lib/useConversation";

const Status = ({
  connected,
  running,
  model,
}: {
  connected: boolean;
  running: boolean;
  model: string | undefined;
}) => {
  const [dot, label] = !connected
    ? ["bg-term-alert", "desconectado"]
    : running
      ? ["bg-term-tool animate-pulse", "trabalhando"]
      : ["bg-term-gaia", "ociosa"];

  return (
    <div className="flex items-center gap-2 text-meta">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-term-dim">{label}</span>
      {model !== undefined ? <span className="text-term-faint">· {model}</span> : null}
    </div>
  );
};

const Shell = ({ onLeave }: { onLeave: () => void }) => {
  const { entries, running, connected, health, error, send } = useConversation();

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col">
      <header className="border-term-line flex items-baseline justify-between border-b px-5 py-3">
        <span className="text-term-gaia text-meta tracking-[0.3em] uppercase">gaia</span>
        <div className="flex items-center gap-4">
          <Status connected={connected} running={running} model={health?.model} />
          <button
            type="button"
            onClick={onLeave}
            className="text-term-faint hover:text-term-dim text-micro tracking-widest uppercase"
          >
            sair
          </button>
        </div>
      </header>

      <main className="term-scroll flex-1 overflow-y-auto">
        <Transcript entries={entries} running={running} />
      </main>

      {error !== null ? (
        <div className="text-term-alert border-term-alert/40 border-t px-5 py-2 text-meta">
          {error}
        </div>
      ) : null}

      <Composer running={running} onSend={send} />
    </div>
  );
};

export default function App() {
  const [open, setOpen] = useState(getToken() !== null);

  if (!open) return <TokenGate onOpen={() => setOpen(true)} />;

  return (
    <Shell
      onLeave={() => {
        clearToken();
        setOpen(false);
      }}
    />
  );
}
