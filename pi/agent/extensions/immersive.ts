/**
 * Clear Scrollback Extension
 *
 * Clears the terminal scrollback buffer on startup.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CLEAR_SEQUENCE = "\x1b[2J\x1b[H\x1b[3J";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      process.stdout.write(CLEAR_SEQUENCE);
    }
  });
}
