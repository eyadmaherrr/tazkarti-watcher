// Wake-you-up alarm built entirely from Web Audio oscillators.
// Every modulation runs on the audio thread (LFOs, not JS timers), so it keeps
// blaring at full speed even when the tab is in the background.
// It loops until stopAlarm(): a watchdog restarts it if the browser suspends audio,
// and if it was requested before sound was unlocked it starts the moment you click the page.

let ctx: AudioContext | null = null;
let nodes: AudioNode[] = [];
let sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
let vibrateTimer: ReturnType<typeof setInterval> | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let wanted = false; // true from startAlarm() until stopAlarm()

/** Must be called from a click/keypress at least once — browsers block audio until then. */
export async function armAudio(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== "running") await ctx.resume();
    if (wanted) play(); // an alarm was already waiting for sound to be allowed
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

/** Ring until stopAlarm(). Safe to call repeatedly. */
export function startAlarm() {
  wanted = true;
  play();
  if ("vibrate" in navigator && !vibrateTimer) {
    navigator.vibrate([600, 200, 600, 200, 600]);
    vibrateTimer = setInterval(() => navigator.vibrate([600, 200, 600, 200, 600]), 2600);
  }
  // Keep it going no matter what: resume suspended audio, rebuild the siren if it was torn down.
  watchdog ??= setInterval(() => {
    if (!wanted || !ctx) return;
    if (ctx.state !== "running") ctx.resume().then(play, () => {});
    else play();
  }, 1000);
}

function play() {
  if (!ctx || ctx.state !== "running" || isRinging()) return;
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
}

export function stopAlarm() {
  wanted = false;
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
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
