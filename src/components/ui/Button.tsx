import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
type ButtonSize = "compact" | "regular";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper",
  secondary: "border border-line",
  outline: "border border-ink",
  danger: "border border-red-300 text-red-700",
  ghost: "underline",
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
      className={`${variantClasses[variant]} ${sizeClasses[size]} font-bold disabled:opacity-40 ${className}`.trim()}
      {...props}
    />
  );
}
