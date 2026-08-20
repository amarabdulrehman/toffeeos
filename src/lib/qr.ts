"use client";

import QRCode from "qrcode";

/** Renders a URL as a PNG data URL, client-side — used for the printable/downloadable per-table
 * QR codes on the floor management screen (src/app/app/tables/page.tsx). */
export function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { width: 320, margin: 2 });
}
