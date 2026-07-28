import { useEffect, useState } from "react";
import { authenticatedImage } from "@/lib/api";

/**
 * An <img> tag cannot carry an Authorization header, and every core endpoint
 * needs one. So the bytes are fetched with the token and handed to the tag as a
 * blob URL. Putting the token in the query string would have worked too, and
 * would have leaked it into history and logs.
 */
export const AuthImage = ({
  src,
  local,
  alt,
  className,
}: {
  src: string;
  /** Data URL available before the core has stored the file. */
  local?: string;
  alt: string;
  className?: string;
}) => {
  const [resolved, setResolved] = useState<string | undefined>(local);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (local !== undefined) {
      setResolved(local);
      return;
    }

    let revoked = false;
    let url: string | undefined;

    void authenticatedImage(src)
      .then((objectUrl) => {
        if (revoked) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        url = objectUrl;
        setResolved(objectUrl);
      })
      .catch(() => setFailed(true));

    return () => {
      revoked = true;
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [src, local]);

  if (failed) {
    return <span className="text-term-alert text-meta">[imagem indisponível]</span>;
  }
  if (resolved === undefined) {
    return <span className="text-term-faint text-meta">carregando imagem…</span>;
  }
  return <img src={resolved} alt={alt} className={className} />;
};
