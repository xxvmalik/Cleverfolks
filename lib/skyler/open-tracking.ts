/**
 * Email open tracking for Skyler.
 * Generates a unique tracking pixel URL per email send.
 * The pixel is a 1x1 transparent GIF served by our API route.
 */

import { randomUUID } from "crypto";

export type TrackingPixelParams = {
  pipelineId: string;
  workspaceId: string;
  cadenceStep: number;
};

/**
 * Generate a tracking pixel ID and the corresponding HTML img tag.
 * The pixel ID is stored alongside the email send so opens can be matched.
 */
export function generateTrackingPixel(
  baseUrl: string,
  params: TrackingPixelParams
): { trackingId: string; pixelHtml: string } {
  const trackingId = randomUUID();
  const pixelUrl = `${baseUrl}/api/skyler/track/open?tid=${trackingId}`;
  const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" alt="" />`;
  return { trackingId, pixelHtml };
}

/** The 1x1 transparent GIF as a Buffer (43 bytes). */
export const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);
