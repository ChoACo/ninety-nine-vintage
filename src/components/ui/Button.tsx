import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
type ButtonSize = "compact" | "regular";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper shadow-lg shadow-black/10 hover:bg-zinc-800",
  secondary: "border border-line bg-paper hover:border-zinc-400",
  outline: "border border-ink bg-paper",
  danger: "border border-red-300 bg-paper text-red-700 hover:bg-red-50",
  ghost: "underline underline-offset-4 hover:bg-surface",
};

const sizeClasses: Record<ButtonSize, string> = {
  compact: "px-3 py-2 text-[10px]",
  regular: "px-4 py-3 text-xs",
};

export function Button({
  className = "",
  size = "regular",
  variant = "secondary",
  ...props
}: Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: ButtonSize;
    variant?: ButtonVariant;
  }
>) {
  return (
    <button
      className={`${variantClasses[variant]} ${sizeClasses[size]} rounded-xl font-bold transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-40 ${className}`.trim()}
      {...props}
    />
  );
}
