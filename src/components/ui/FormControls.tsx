import { forwardRef } from "react";
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const inputClassName = "border border-line bg-paper px-3 py-3 text-xs";

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextInput({ className = "", ...props }, ref) {
  return <input className={`${inputClassName} ${className}`.trim()} ref={ref} {...props} />;
});

export const SelectInput = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function SelectInput({ className = "", ...props }, ref) {
  return <select className={`${inputClassName} ${className}`.trim()} ref={ref} {...props} />;
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className = "", ...props }, ref) {
  return <textarea className={`${inputClassName} ${className}`.trim()} ref={ref} {...props} />;
});
