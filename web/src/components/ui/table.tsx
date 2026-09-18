import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The classic ServerStatus table: a header rule, then each server as its own
 * rounded stripe with air between rows. Cells are centred, which is what keeps
 * the meter columns lined up. Type and padding step down one notch on phones so
 * the table fits a narrow screen without turning into a different layout.
 */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn(
          "w-full border-separate border-spacing-x-0 border-spacing-y-1 px-2 pb-2 text-[13px] sm:text-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn(className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn(className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("group", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-8 border-b border-border px-1 text-center align-middle text-xs font-semibold whitespace-nowrap sm:h-9 sm:px-3 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "bg-row px-1 py-1.5 text-center align-middle whitespace-nowrap transition-colors group-hover:bg-row-hover first:rounded-l-md last:rounded-r-md sm:px-3 sm:py-2",
        className,
      )}
      {...props}
    />
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <fieldset className="inline-flex h-8 min-w-0 items-center rounded-md bg-muted p-0.5 text-xs ring-1 ring-border">
      <legend className="sr-only">{ariaLabel}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[5px] px-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground",
            value === o.value && "bg-card font-semibold text-foreground shadow-xs",
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}
