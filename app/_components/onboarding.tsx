"use client";

import { useState } from "react";
import type { Team } from "@/lib/types";
import { teamLogoUrls } from "../_lib/client";
import { useWatch } from "../_lib/watch";
import { TeamPicker } from "./team-picker";
import { Logo, TeamLogo } from "./ui";

const STEPS = 3;

/** First visit: welcome → favourite team → alerts (same flow as the app). */
export function Onboarding() {
  const { favorite, setFavorite, completeOnboarding, enableNotifications, permission } = useWatch();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Team | null>(favorite);
  const [busy, setBusy] = useState(false);

  const finishWithAlerts = async () => {
    setBusy(true);
    await enableNotifications(); // also unlocks the alarm sound — this click is the gesture browsers need
    setBusy(false);
    completeOnboarding();
  };

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to Tazkarti Watch">
      <div className="ob-inner">
        <div className="ob-top">
          <Logo height={30} />
          <div className="dots" aria-label={`Step ${step + 1} of ${STEPS}`}>
            {Array.from({ length: STEPS }, (_, i) => (
              <i key={i} className={i === step ? "on" : ""} />
            ))}
          </div>
        </div>

        {step === 0 && (
          <div className="ob-body">
            <div className="ob-hero">
              <Logo height={64} />
              <span className="brand-tag big">Watch</span>
              <h1>Never miss a ticket drop</h1>
              <p>We watch Tazkarti around the clock and alert you the second matches go on sale.</p>
            </div>
            <div className="glass tint-dark ob-points">
              <div>
                <span aria-hidden>🚨</span>
                <p>
                  <b>Wake-up alarm</b>New matches ring a loud alarm until you press STOP.
                </p>
              </div>
              <div>
                <span aria-hidden>🔔</span>
                <p>
                  <b>Every update</b>Get notified whenever the matches list changes.
                </p>
              </div>
              <div>
                <span aria-hidden>⭐</span>
                <p>
                  <b>Your team first</b>Pick a favourite and see it at the top of Matches.
                </p>
              </div>
            </div>
            <button className="btn green xl" onClick={() => setStep(1)}>
              Get started
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="ob-body">
            <h1 className="ob-title">Who do you support?</h1>
            <p className="ob-sub">Your team goes at the top of the Matches tab.</p>
            <div className="glass tint-dark ob-picker">
              <TeamPicker selectedId={picked?.id} onSelect={setPicked} />
            </div>
            <div className="ob-row">
              <button
                className="btn xl"
                onClick={() => {
                  setPicked(null);
                  setFavorite(null);
                  setStep(2);
                }}>
                Skip
              </button>
              <button
                className="btn green xl grow"
                disabled={!picked}
                onClick={() => {
                  setFavorite(picked);
                  setStep(2);
                }}>
                {picked ? `Continue with ${picked.name}` : "Pick a team"}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="ob-body">
            <div className="ob-hero">
              {picked ? (
                <TeamLogo sources={teamLogoUrls(picked.icon)} name={picked.name} size={96} />
              ) : (
                <span className="ob-bell" aria-hidden>
                  🔔
                </span>
              )}
              <h1>Turn on alerts</h1>
              <p>
                You&apos;ll be notified every time the Tazkarti matches list updates — for every team
                {picked ? `, not just ${picked.name}` : ""}. New matches ring the alarm
                {picked ? `, and we'll call out ${picked.name} by name` : ""}. Keep this tab open for the alarm.
              </p>
            </div>
            {permission === "unsupported" ? (
              <button className="btn green xl" onClick={completeOnboarding}>
                Finish
              </button>
            ) : (
              <div className="ob-col">
                <button className="btn green xl" onClick={finishWithAlerts} disabled={busy}>
                  {busy ? "Turning on…" : "Turn on alerts"}
                </button>
                <button className="btn xl" onClick={completeOnboarding}>
                  Maybe later
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
