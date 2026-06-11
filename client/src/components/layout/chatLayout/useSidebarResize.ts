import { useCallback, useEffect, useRef, useState } from "react";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 224;

export interface SidebarResize {
  sidebarWidth: number;
  handleResizeStart: (e: React.MouseEvent) => void;
  SIDEBAR_MIN: number;
  SIDEBAR_MAX: number;
}

/**
 * Resizable channel sidebar (desktop only). Persists the chosen width to
 * localStorage under `concord_sidebar_width`. Extracted verbatim from
 * ChatLayout — same clamp bounds, same drag-handle behavior, same
 * persistence semantics.
 */
export function useSidebarResize(): SidebarResize {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("concord_sidebar_width");
      if (saved) return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved)));
    } catch {}
    return SIDEBAR_DEFAULT;
  });
  const isDragging = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + delta));
        setSidebarWidth(newWidth);
      };

      const onUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          localStorage.setItem("concord_sidebar_width", String(sidebarWidth));
        } catch {}
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  useEffect(() => {
    try {
      localStorage.setItem("concord_sidebar_width", String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);

  return { sidebarWidth, handleResizeStart, SIDEBAR_MIN, SIDEBAR_MAX };
}
