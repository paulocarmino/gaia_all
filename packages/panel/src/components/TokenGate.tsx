import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setToken, verifyToken } from "@/lib/api";

/**
 * The front door. Single-user and deliberately plain: one token, no OIDC
 * ceremony (ARCHITECTURE, Front door authentication).
 */
export const TokenGate = ({ onOpen }: { onOpen: () => void }) => {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (value.trim() === "") return;
    setChecking(true);
    setRejected(false);
    const ok = await verifyToken(value.trim()).catch(() => false);
    setChecking(false);
    if (!ok) {
      setRejected(true);
      return;
    }
    setToken(value.trim());
    onOpen();
  };

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-md">
        <div className="mb-10">
          <div className="text-term-gaia mb-1 text-[11px] tracking-[0.3em] uppercase">gaia</div>
          <h1 className="text-term-fg text-lg">porta da frente</h1>
          <p className="text-term-dim mt-2 text-xs leading-relaxed">
            Ela executa código, aplica mudanças e guarda memória. Precisa de token.
          </p>
        </div>

        <label className="text-term-dim block text-[11px] tracking-widest uppercase">
          token
        </label>
        <div className="mt-2 flex items-baseline gap-2 border-b border-term-line pb-2 focus-within:border-term-user">
          <span className="text-term-gaia select-none">$</span>
          <input
            autoFocus
            type="password"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setRejected(false);
            }}
            placeholder="GAIA_AUTH_TOKEN"
            className="text-term-fg placeholder:text-term-faint/70 min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>

        <div className="mt-3 h-4">
          {rejected ? (
            <span className="text-term-alert text-xs">token recusado</span>
          ) : null}
        </div>

        <Button
          type="submit"
          disabled={checking || value.trim() === ""}
          className="border-term-line text-term-gaia hover:border-term-gaia hover:bg-term-gaia/8 disabled:text-term-faint mt-4 h-9 w-full rounded-none border bg-transparent font-mono text-[11px] tracking-[0.25em] uppercase shadow-none disabled:border-term-line/60"
        >
          {checking ? "verificando" : "entrar"}
        </Button>
      </form>
    </div>
  );
};
