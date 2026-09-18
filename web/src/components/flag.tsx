import { GlobeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Flag({
  code,
  title,
  className,
}: {
  code: string;
  title?: string;
  className?: string;
}) {
  const cc = code.toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) {
    return <GlobeIcon className={cn("size-4 text-muted-foreground", className)} aria-hidden />;
  }
  return (
    <img
      src={`/flags/${cc}.svg`}
      alt={cc.toUpperCase()}
      title={title ?? cc.toUpperCase()}
      width={20}
      height={15}
      loading="lazy"
      className={cn(
        "h-3 w-4 rounded-[2px] object-cover ring-1 ring-black/10 sm:h-[15px] sm:w-5",
        className,
      )}
    />
  );
}
