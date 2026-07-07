import { cn } from "@/app/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-1 rounded-full text-xs font-medium", className)}>
      {children}
    </span>
  );
}
