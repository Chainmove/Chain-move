import type { ComponentType, InputHTMLAttributes, ReactNode } from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  error?: string
  trailing?: ReactNode
  containerClassName?: string
}

export function AuthInput({
  id,
  label,
  icon: Icon,
  error,
  trailing,
  className,
  containerClassName,
  ...props
}: AuthInputProps) {
  const errorId = `${id}-error`

  return (
    <div className={cn("space-y-2", containerClassName)}>
      <label htmlFor={id} className="text-sm font-medium text-[#1F1F1F]">
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#777777]" />
        <Input
          id={id}
          className={cn(
            "h-12 rounded-xl border-[#D9D9D9] bg-white pl-11 text-sm text-[#1F1F1F] placeholder:text-[#9A9A9A] focus-visible:ring-[#F2780E] focus-visible:ring-offset-0",
            trailing ? "pr-11" : "pr-4",
            error ? "border-red-500 focus-visible:ring-red-500" : "",
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...props}
        />
        {trailing ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {trailing}
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
