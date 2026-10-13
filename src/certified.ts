/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "dbf49813a39c1a5389c5e28cb8e4c1c2379e2454",
  pluginPath: "pstack",
  pstackVersion: "0.15.23",
  skillCount: 53,
  agentCount: 2,
} as const;
