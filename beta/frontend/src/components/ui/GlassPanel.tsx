import { type ReactNode } from "react";

interface GlassPanelProps {
  className?: string;
  children: ReactNode;
}

function GlassPanel({ className = "", children }: GlassPanelProps) {
  return (
    <div className={`glass-panel rounded-xl ${className}`}>
      {children}
    </div>
  );
}

export default GlassPanel;
