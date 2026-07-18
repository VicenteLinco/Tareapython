import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "input w-full border-base-300 bg-base-100 focus:border-primary focus:outline-primary/25",
        className,
      )}
      {...props}
    />
  );
}
