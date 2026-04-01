import { type ButtonHTMLAttributes, type ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  children: ReactNode;
}

const variantStyles: Record<string, string> = {
  primary:
    "primary-glow text-on-primary font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:brightness-110 active:brightness-90",
  secondary:
    "bg-transparent border border-outline-variant text-on-surface hover:bg-surface-container-high active:bg-surface-bright",
  danger:
    "bg-error-container text-on-error-container hover:brightness-110 active:brightness-90",
};

function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-label font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
