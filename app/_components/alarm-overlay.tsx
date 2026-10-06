"use client";

import { TAZKARTI_MATCHES_URL } from "../_lib/client";
import { useWatch } from "../_lib/watch";

/** Full-screen wake-up alarm. Flashes ≤ 3×/s (photosensitivity-safe); only STOP silences it. */
export function AlarmOverlay() {
  const { alarm, silence, armed } = useWatch();
  if (!alarm) return null;
  return (
    <div className="alarm" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div className="alarm-box">
        <div className="alarm-icon" aria-hidden>
          🚨
        </div>
        <h2 id="alarm-title">{alarm.title}</h2>
        {!armed && (
          <p className="alarm-muted" role="status">
            🔇 Your browser blocked the sound — tap anywhere here to turn the siren on.
          </p>
        )}
        <ul>
          {alarm.lines.slice(0, 5).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <button className="alarm-stop" onClick={silence} autoFocus aria-label="Stop alarm">
          STOP
        </button>
        <a className="alarm-book" href={TAZKARTI_MATCHES_URL} target="_blank" rel="noreferrer" onClick={silence}>
          Stop &amp; open Tazkarti
        </a>
      </div>
    </div>
  );
}
