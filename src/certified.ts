/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "6ed0f7a9504f577d7529064103cecce9be7dfc5e",
  pluginPath: "pstack",
  pstackVersion: "0.15.2",
  skillCount: 47,
  agentCount: 2,
} as const;
