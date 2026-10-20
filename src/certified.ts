/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "88d47514b82e7c44f00f2b2a72ff6dd12158038c",
  pluginPath: "pstack",
  pstackVersion: "0.15.29",
  skillCount: 56,
  agentCount: 2,
} as const;
