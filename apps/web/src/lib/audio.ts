import type { Settings } from "./settings.ts";
import { audible, type Sound } from "./sound.ts";

/**
 * Every sound is synthesised here at runtime with the Web Audio API: nothing is sampled or
 * downloaded, so there is no third-party audio and no licence to track. Paper and felt, not wood.
 */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return ctx;
}

type Out = { ac: AudioContext; out: AudioNode; at: number };

function envelope(ac: AudioContext, at: number, peak: number, attack: number, decay: number) {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return gain;
}

/** A filtered burst of noise: a felt base touching the board, or the scratch of a pen. */
function burst(
  { ac, out, at }: Out,
  {
    type,
    freq,
    q = 0.8,
    peak,
    decay,
    sweepTo,
  }: {
    type: BiquadFilterType;
    freq: number;
    q?: number;
    peak: number;
    decay: number;
    sweepTo?: number;
  },
) {
  const source = ac.createBufferSource();
  source.buffer = noise;
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, at);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + decay);
  filter.Q.value = q;
  const gain = envelope(ac, at, peak, 0.003, decay);
  source.connect(filter).connect(gain).connect(out);
  source.start(at, Math.random() * 0.5, decay + 0.05);
}

function tone(
  { ac, out, at }: Out,
  freq: number,
  peak: number,
  decay: number,
  type: OscillatorType = "sine",
) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.82, at + decay);
  const gain = envelope(ac, at, peak, 0.004, decay);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + decay + 0.05);
}

const put = (o: Out, weight = 1) => {
  burst(o, {
    type: "lowpass",
    freq: 900 + 300 * weight,
    peak: 0.55 * weight,
    decay: 0.07 * weight,
  });
  tone(o, 150 / weight, 0.35 * weight, 0.06 * weight);
};

const VOICES: Record<Sound, (o: Out) => void> = {
  move: (o) => put(o),
  capture: (o) => {
    put(o, 1.35);
    burst(
      { ...o, at: o.at + 0.012 },
      { type: "bandpass", freq: 2400, q: 2, peak: 0.12, decay: 0.04 },
    );
  },
  castle: (o) => {
    put(o);
    put({ ...o, at: o.at + 0.11 }, 0.9);
  },
  check: (o) => {
    put(o, 1.1);
    tone({ ...o, at: o.at + 0.03 }, 1180, 0.09, 0.22, "triangle");
  },
  low: (o) => burst(o, { type: "highpass", freq: 3800, peak: 0.3, decay: 0.018 }),
  end: (o) => {
    burst(o, { type: "bandpass", freq: 1500, sweepTo: 3600, q: 3, peak: 0.22, decay: 0.55 });
    tone({ ...o, at: o.at + 0.08 }, 523, 0.07, 0.9, "triangle");
    tone({ ...o, at: o.at + 0.16 }, 784, 0.05, 0.9, "triangle");
  },
};

export function play(sound: Sound, settings: Pick<Settings, "sound" | "volume">) {
  if (!audible(settings)) return;
  const ac = context();
  if (!ac) return;
  const out = ac.createGain();
  out.gain.value = settings.volume;
  out.connect(ac.destination);
  VOICES[sound]({ ac, out, at: ac.currentTime + 0.005 });
}

/**
 * Ambient music, off by default: three slow pieces of soft chords, generated, each a loop of four
 * chords. It plays only while `music` is on, and fades in and out.
 */
const PIECES = [
  [
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [48, 52, 55, 59],
    [55, 59, 62, 64],
  ],
  [
    [50, 57, 60, 65],
    [46, 53, 57, 62],
    [48, 55, 58, 64],
    [45, 52, 57, 60],
  ],
  [
    [52, 59, 62, 66],
    [48, 55, 59, 64],
    [45, 52, 55, 60],
    [47, 54, 57, 62],
  ],
];
const CHORD_S = 8;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
let music: { gain: GainNode; timer: ReturnType<typeof setTimeout> } | null = null;

export function setMusic({ music: on, musicVolume }: Pick<Settings, "music" | "musicVolume">) {
  if (!on || musicVolume <= 0) {
    if (!music || !ctx) return;
    const { gain, timer } = music;
    clearTimeout(timer);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    setTimeout(() => gain.disconnect(), 3000);
    music = null;
    return;
  }
  const ac = context();
  if (!ac) return;
  if (music) {
    music.gain.gain.setTargetAtTime(musicVolume * 0.18, ac.currentTime, 0.4);
    return;
  }
  const gain = ac.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(musicVolume * 0.18, ac.currentTime, 1.5);
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1400;
  filter.connect(gain).connect(ac.destination);
  let step = 0;
  const piece = PIECES[Math.floor(Math.random() * PIECES.length)];
  const next = () => {
    const at = ac.currentTime + 0.05;
    for (const [i, note] of piece[step % piece.length].entries()) {
      const osc = ac.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = hz(note);
      osc.detune.value = (Math.random() - 0.5) * 8;
      const voice = ac.createGain();
      voice.gain.setValueAtTime(0, at);
      voice.gain.linearRampToValueAtTime(i === 0 ? 0.5 : 0.22, at + 2.5);
      voice.gain.linearRampToValueAtTime(0, at + CHORD_S + 1.5);
      osc.connect(voice).connect(filter);
      osc.start(at);
      osc.stop(at + CHORD_S + 2);
    }
    step++;
    music!.timer = setTimeout(next, CHORD_S * 1000);
  };
  music = { gain, timer: setTimeout(() => {}) };
  next();
}
