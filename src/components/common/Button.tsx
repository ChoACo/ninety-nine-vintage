"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  isLoading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-white shadow-[0_8px_22px_rgba(211,101,83,0.24)] hover:bg-[var(--accent-hover)] focus-visible:ring-[var(--accent)]",
  secondary:
    "border border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info-text)] hover:brightness-[1.04] focus-visible:ring-[var(--info-border)]",
  ghost:
    "border border-[var(--border)] bg-[var(--surface-raised)]/70 text-[var(--foreground)] hover:bg-[var(--surface-raised)] focus-visible:ring-[var(--border-strong)]",
  danger:
    "bg-[var(--danger-text)] text-white hover:brightness-110 focus-visible:ring-[var(--danger-text)]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 py-2 text-[15px]",
  md: "min-h-12 px-5 py-2.5 text-base",
  lg: "min-h-14 px-6 py-3 text-lg",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  isLoading = false,
  className = "",
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
