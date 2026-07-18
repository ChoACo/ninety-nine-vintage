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
    "border border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_6px_18px_rgba(18,18,17,0.14)] hover:bg-[var(--accent-hover)] hover:shadow-[0_10px_26px_rgba(18,18,17,0.2)] focus-visible:ring-[var(--focus-ring)]",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-strong)] shadow-[0_1px_0_rgba(255,255,255,0.38)] hover:border-[var(--text-strong)] hover:bg-[var(--surface)] focus-visible:ring-[var(--focus-ring)]",
  ghost:
    "border border-[var(--border)] bg-transparent text-[var(--text-strong)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] focus-visible:ring-[var(--focus-ring)]",
  danger:
    "border border-transparent bg-[var(--danger-text)] text-white shadow-[0_6px_18px_rgba(126,35,31,0.16)] hover:brightness-95 hover:shadow-[0_10px_24px_rgba(126,35,31,0.22)] focus-visible:ring-[var(--danger-text)]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3.5 py-2 text-sm",
  md: "min-h-11 px-4.5 py-2.5 text-[15px]",
  lg: "min-h-12 px-5 py-3 text-base",
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
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-bold tracking-[-0.015em] transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-45 disabled:hover:scale-100 motion-reduce:transform-none motion-reduce:transition-none ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}
