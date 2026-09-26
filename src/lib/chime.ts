"use client";

import { useSyncExternalStore } from "react";

/**
 * The till's alert sound, and whether this device plays it.
 *
 * Made in the browser with the Web Audio API — two short rising tones — rather than shipping a
 * sound file: nothing to download, nothing to fail to load offline. Browsers only let a page make
 * sound after someone has touched it, so the audio is unlocked on the first tap on the till; by the
 * time an order arrives, someone always has.
 *
 * On or off is remembered per device (a busy counter may want it, the owner's phone may not), in
 * localStorage, wrapped so a private window or blocked storage simply means "on".
 */

const KEY = "toffeeos.till.sound";
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture; afterwards the chime can play without one. */
export function unlockChime(): void {
  audio();
}

export function playChime(): void {
  // Counted, so a test can tell the chime was asked for without listening to a speaker.
  const w = window as unknown as { __toffeeChimes?: number };
  w.__toffeeChimes = (w.__toffeeChimes ?? 0) + 1;

  const a = audio();
  if (!a) return;
  const start = a.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.16;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }
}

function readSoundOn(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* not remembered; the switch still works for this visit */
  }
  listeners.forEach((l) => l());
}

/** Whether this device plays the chime. On until someone turns it off. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    readSoundOn,
    () => true
  );
}
