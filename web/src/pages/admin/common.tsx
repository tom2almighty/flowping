import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // clipboard blocked: the text is still selectable below
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button variant="ghost" size="sm" onClick={copy}>
          {done ? <CheckIcon /> : <CopyIcon />}
          {done ? "已复制" : "复制"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function ErrorText({ text }: { text: string }) {
  return text ? <p className="text-sm text-crit">{text}</p> : null;
}

/**
 * One settings section: what it is on the left, the controls on the right.
 * Below lg the description sits above the controls. Sections stack inside a
 * single card with a rule between them, so uneven heights never leave holes.
 */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className="grid gap-x-8 gap-y-4 border-t px-5 py-5 first:border-t-0 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground lg:max-w-none">
          {description}
        </p>
      </div>
      <div className={cn("flex max-w-lg flex-col gap-4", className)}>{children}</div>
    </section>
  );
}
