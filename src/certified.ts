/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "519d36aa98955bf680db01bcde5fdfba686dc901",
  pluginPath: "pstack",
  pstackVersion: "0.15.34",
  skillCount: 58,
  agentCount: 2,
} as const;
