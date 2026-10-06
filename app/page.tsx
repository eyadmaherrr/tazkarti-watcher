"use client";

import { useEffect, useState } from "react";
import { AlarmOverlay } from "./_components/alarm-overlay";
import { Onboarding } from "./_components/onboarding";
import { ActivityTab, MatchesTab, SettingsTab } from "./_components/tabs";
import { Brand, LivePill } from "./_components/ui";
import { useWatch, WatchProvider } from "./_lib/watch";

type Tab = "matches" | "activity" | "settings";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "matches", label: "Matches", icon: "/tab-icons/matches.svg" },
  { id: "activity", label: "Activity", icon: "/tab-icons/activity.svg" },
  { id: "settings", label: "Settings", icon: "/tab-icons/settings.svg" },
];
const fromHash = (): Tab => {
  const h = typeof location === "undefined" ? "" : location.hash.slice(1);
  return h === "activity" || h === "settings" ? h : "matches";
};

function Shell() {
  const { ready, onboarded, freshIds } = useWatch();
  const [tab, setTab] = useState<Tab>("matches");

  // Tabs live in the URL hash (#activity, #settings) so back/forward and refresh keep your place.
  useEffect(() => {
    const sync = () => setTab(fromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = (t: Tab) => {
    history.pushState(null, "", t === "matches" ? location.pathname : `#${t}`);
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <div className="bg" aria-hidden>
        <span className="glow g1" />
        <span className="glow g2" />
      </div>

      <Brand right={<LivePill />} />

      <main className="shell">
        {tab === "matches" && <MatchesTab />}
        {tab === "activity" && <ActivityTab />}
        {tab === "settings" && <SettingsTab />}
        <footer className="foot">Unofficial watcher, not affiliated with Tazkarti. Data and team flags come from tazkarti.com.</footer>
      </main>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
            <span className="tab-icon" style={{ WebkitMaskImage: `url(${t.icon})`, maskImage: `url(${t.icon})` }} aria-hidden />
            {t.id === "matches" && freshIds.size > 0 && <span className="tab-badge">{freshIds.size}</span>}
            {t.label}
          </button>
        ))}
      </nav>

      {ready && !onboarded && <Onboarding />}
      <AlarmOverlay />
    </>
  );
}

export default function Home() {
  return (
    <WatchProvider>
      <Shell />
    </WatchProvider>
  );
}
