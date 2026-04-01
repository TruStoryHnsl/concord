import { useState, useEffect } from "react";

export type SizeTier = "widget" | "compact" | "mobile" | "desktop";

interface WindowSize {
  width: number;
  height: number;
  tier: SizeTier;
}

function getTier(width: number, height: number): SizeTier {
  if (width < 200 || height < 200) return "widget";
  if (width < 500) return "compact";
  if (width < 768) return "mobile";
  return "desktop";
}

export function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return { width: w, height: h, tier: getTier(w, h) };
  });

  useEffect(() => {
    const handler = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setSize({ width: w, height: h, tier: getTier(w, h) });
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return size;
}
