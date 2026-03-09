import { useToastStore } from "../../stores/toast";

const typeStyles = {
  error: "bg-red-600/90 text-white",
  success: "bg-emerald-600/90 text-white",
  info: "bg-zinc-700/90 text-zinc-200",
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-[slideIn_0.2s_ease-out] ${typeStyles[toast.type]}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-white/60 hover:text-white text-xs shrink-0"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
