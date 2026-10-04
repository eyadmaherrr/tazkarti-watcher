// Wake-you-up alarm built entirely from Web Audio oscillators.
// Every modulation runs on the audio thread (LFOs, not JS timers), so it keeps
// blaring at full speed even when the tab is in the background.

let ctx: AudioContext | null = null;
let nodes: AudioNode[] = [];
let sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
let vibrateTimer: ReturnType<typeof setInterval> | null = null;

/** Must be called from a click/keypress at least once — browsers block audio until then. */
export async function armAudio(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== "running") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export const isAudioArmed = () => ctx?.state === "running";
export const isRinging = () => sources.length > 0;

function osc(c: AudioContext, type: OscillatorType, freq: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  sources.push(o);
  return o;
}

function gain(c: AudioContext, value: number) {
  const g = c.createGain();
  g.gain.value = value;
  nodes.push(g);
  return g;
}

/** LFO wired into an AudioParam: param oscillates around its value by ±depth at `rate` Hz. */
function modulate(c: AudioContext, param: AudioParam, type: OscillatorType, rate: number, depth: number) {
  const lfo = osc(c, type, rate);
  const amt = gain(c, depth);
  lfo.connect(amt).connect(param);
}

export function startAlarm() {
  if (!ctx || isRinging()) return;
  const c = ctx;

  // Hard limiter-ish chain so the stacked layers are as loud as possible without clipping to mush.
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.001;
  comp.release.value = 0.05;
  nodes.push(comp);
  const master = gain(c, 1);
  master.connect(comp).connect(c.destination);

  // Layer 1 — fast hi/lo siren (square LFO flips pitch 5×/s), sawtooth for maximum harshness.
  const hiLo = osc(c, "sawtooth", 1600);
  modulate(c, hiLo.frequency, "square", 5, 650);
  hiLo.connect(gain(c, 0.35)).connect(master);

  // Layer 2 — rising/falling "whoop" sweep, slightly detuned against layer 1 so it beats unpleasantly.
  const whoop = osc(c, "square", 2200);
  modulate(c, whoop.frequency, "sawtooth", 0.8, 900);
  whoop.connect(gain(c, 0.22)).connect(master);

  // Layer 3 — 3 kHz piercing beeper (the frequency ears are most sensitive to), gated on/off 8×/s.
  const beep = osc(c, "square", 3100);
  const beepGate = gain(c, 0.5);
  modulate(c, beepGate.gain, "square", 8, 0.5);
  beep.connect(beepGate).connect(master);

  // Layer 4 — low buzzer underneath so it still cuts through on laptop speakers.
  const buzz = osc(c, "square", 140);
  buzz.connect(gain(c, 0.25)).connect(master);

  // Whole thing pulses hard ~2×/s so it never settles into background noise.
  modulate(c, master.gain, "square", 2, 0.35);

  const t = c.currentTime;
  sources.forEach((s) => s.start(t));

  if ("vibrate" in navigator) {
    navigator.vibrate([600, 200, 600, 200, 600]);
    vibrateTimer = setInterval(() => navigator.vibrate([600, 200, 600, 200, 600]), 2600);
  }
}

export function stopAlarm() {
  sources.forEach((s) => {
    try {
      s.stop();
      s.disconnect();
    } catch {}
  });
  nodes.forEach((n) => {
    try {
      n.disconnect();
    } catch {}
  });
  sources = [];
  nodes = [];
  if (vibrateTimer) clearInterval(vibrateTimer);
  vibrateTimer = null;
  if ("vibrate" in navigator) navigator.vibrate(0);
}
