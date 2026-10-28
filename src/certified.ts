/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "c742dd61706fbacc1b95f1a20b7b988cf096ce6c",
  pluginPath: "pstack",
  pstackVersion: "0.15.36",
  skillCount: 58,
  agentCount: 2,
} as const;
