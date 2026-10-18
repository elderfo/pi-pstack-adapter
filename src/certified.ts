/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "0b8e952052d482ee6de06deebf14d590d77b1b34",
  pluginPath: "pstack",
  pstackVersion: "0.15.26",
  skillCount: 55,
  agentCount: 2,
} as const;
