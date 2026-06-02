import { useToastStore } from "../../stores/toast";

const typeConfig = {
  error: { bg: "bg-error-container", text: "text-on-error-container", icon: "error" },
  success: { bg: "bg-secondary-container", text: "text-on-secondary-container", icon: "check_circle" },
  info: { bg: "glass-panel", text: "text-on-surface", icon: "info" },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const config = typeConfig[toast.type];
        return (
          <div
            key={toast.id}
            className={`px-4 py-2.5 rounded-xl text-sm font-body font-medium animate-[slideIn_0.3s_ease-out] ${config.bg} ${config.text}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base">{config.icon}</span>
                <span>{toast.message}</span>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="opacity-60 hover:opacity-100 shrink-0"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
