import type { RefObject } from "react";
import { useTheme } from "../theme";

/**
 * The tool surface (boundary "C"): a distinct shade from the host chrome, with
 * the menu-bar divider above doing the separating — the lightest possible cue.
 * The bundle's sandboxed iframe is mounted into `stageRef` by the host.
 */
export function Sandbox({ stageRef }: { stageRef: RefObject<HTMLDivElement | null> }) {
  const t = useTheme();
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        background: t.toolBg,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: t.toolTop,
      }}
    >
      <div ref={stageRef} style={{ flex: 1, minHeight: 0, display: "flex" }} />
    </div>
  );
}
