"use client";

import { useState, type ReactNode } from "react";
import { initials } from "../_lib/client";
import { useWatch } from "../_lib/watch";

export function Logo({ height = 34 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo/tazkarti.webp" alt="tazkarti" height={height} width={Math.round((height * 1200) / 376)} className="logo-img" />;
}

/** Header bar: Tazkarti logo + WATCH tag + live status, like the app's brand row. */
export function Brand({ right }: { right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <Logo />
          <span className="brand-tag">Watch</span>
        </div>
        {right}
      </div>
    </header>
  );
}

export function LivePill() {
  const { error, status, checking } = useWatch();
  const down = !!error || !status;
  return (
    <div className={`live ${down ? "down" : ""}`} role="status">
      <i />
      {!status ? "Connecting…" : error ? "Tazkarti unreachable" : checking ? "Checking…" : "Live"}
    </div>
  );
}

/** Round club crest: tries each URL in turn, then falls back to initials. Failures are tracked per URL set. */
export function TeamLogo({ sources, name, size = 52 }: { sources: (string | null)[]; name: string; size?: number }) {
  const urls = sources.filter((s): s is string => !!s);
  const key = urls.join("|");
  const [failed, setFailed] = useState({ key, count: 0 });
  const attempt = failed.key === key ? failed.count : 0;
  const src = urls[attempt];
  return (
    <div className="crest" style={{ width: size, height: size, borderWidth: size > 40 ? 3 : 2 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          onError={() => setFailed((f) => ({ key, count: (f.key === key ? f.count : 0) + 1 }))}
        />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.32) }}>{initials(name)}</span>
      )}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>;
}
