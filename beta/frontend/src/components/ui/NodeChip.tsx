interface NodeChipProps {
  status: "active" | "inactive" | "backbone";
  label: string;
}

const statusStyles: Record<NodeChipProps["status"], { dot: string; text: string; bg: string }> = {
  active: {
    dot: "bg-secondary",
    text: "text-secondary",
    bg: "bg-secondary/10 border-secondary/20",
  },
  inactive: {
    dot: "bg-on-surface-variant",
    text: "text-on-surface-variant",
    bg: "bg-surface-container-high border-outline-variant/20",
  },
  backbone: {
    dot: "bg-primary node-pulse",
    text: "text-primary",
    bg: "bg-primary/10 border-primary/20",
  },
};

function NodeChip({ status, label }: NodeChipProps) {
  const styles = statusStyles[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-label font-medium ${styles.bg} ${styles.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
      {label}
    </span>
  );
}

export default NodeChip;
