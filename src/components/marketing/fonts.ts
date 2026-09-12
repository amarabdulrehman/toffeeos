import { Instrument_Serif } from "next/font/google";

/**
 * The landing page's display face.
 *
 * Loaded here rather than in the root layout so it ships with the marketing page alone and never
 * touches the app's bundle. The product interface keeps Manrope; a serif on a POS screen would be
 * wrong for the same reason it is right here.
 *
 * Instrument Serif specifically: high contrast, a real editorial voice, and — the point — nothing
 * like the geometric sans every generated landing page defaults to. Typography is the fastest way a
 * page tells you whether a person chose anything.
 */
export const displaySerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
