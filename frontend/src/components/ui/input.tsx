"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string }
const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, "aria-describedby": describedBy, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    return <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>}
      <input {...props} id={inputId} ref={ref} aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
        className={cn("min-h-11 w-full rounded-[10px] border border-control-border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-50 md:text-sm", error && "border-destructive", className)} />
      {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
    </div>;
  }
);
Input.displayName = "Input";
export { Input };
