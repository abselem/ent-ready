"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
  id?: string;
}

const PREFIX = "+7 ";

function formatDigits(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 10);
  let result = "";
  if (d.length > 0) result += d.slice(0, 3);
  if (d.length > 3) result += " " + d.slice(3, 6);
  if (d.length > 6) result += " " + d.slice(6, 8);
  if (d.length > 8) result += " " + d.slice(8, 10);
  return result;
}

export function PhoneInput({ value, onChange, className, label, id }: PhoneInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract digits after "+7 " prefix
  const rawDigits = value.startsWith(PREFIX)
    ? value.slice(PREFIX.length).replace(/\D/g, "")
    : value.replace(/\D/g, "").replace(/^7/, "");

  const displayValue = PREFIX + formatDigits(rawDigits);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const input = inputRef.current;
    if (!input) return;
    // Prevent deleting into the "+7 " prefix
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      input.selectionStart !== null &&
      input.selectionStart <= PREFIX.length &&
      input.selectionEnd !== null &&
      input.selectionEnd <= PREFIX.length
    ) {
      e.preventDefault();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Strip prefix and reformat
    const afterPrefix = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw;
    const digits = afterPrefix.replace(/\D/g, "").slice(0, 10);
    const formatted = PREFIX + formatDigits(digits);
    onChange(formatted);
  }

  function handleFocus() {
    // Place cursor after prefix if it's at the start
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input && input.selectionStart !== null && input.selectionStart < PREFIX.length) {
        input.setSelectionRange(PREFIX.length, PREFIX.length);
      }
    });
  }

  function handleClick() {
    const input = inputRef.current;
    if (input && input.selectionStart !== null && input.selectionStart < PREFIX.length) {
      input.setSelectionRange(PREFIX.length, PREFIX.length);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={id}
        type="tel"
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onClick={handleClick}
        className={cn(
          "h-11 w-full rounded-xl border-2 border-white/20 bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors duration-150",
          className
        )}
      />
    </div>
  );
}
