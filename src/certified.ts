/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "101b274dd991f694e1f7024be2157e5f3adf07de",
  pluginPath: "pstack",
  pstackVersion: "0.15.25",
  skillCount: 54,
  agentCount: 2,
} as const;
