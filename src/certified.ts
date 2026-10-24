/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "9580c23696ac8d7abed0c166f2f9918800afb819",
  pluginPath: "pstack",
  pstackVersion: "0.15.32",
  skillCount: 58,
  agentCount: 2,
} as const;
