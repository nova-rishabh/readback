import type { ReactNode } from "react";

export function PageHeader({ title, lede, actions }: { title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-[1.1] tracking-[-0.01em]">{title}</h1>
        {lede && <p className="mt-2 max-w-[68ch] text-[14.5px] leading-relaxed text-muted">{lede}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "px-6 py-8 lg:px-8" : "mx-auto max-w-[1180px] px-6 py-10 lg:px-8"}>{children}</div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-rule-strong px-6 py-12 text-center">
      <p className="font-display text-[20px]">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-[56ch] text-[14px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="alert" className="rounded-md border border-proof/40 bg-proof-tint px-4 py-3 text-[14px]">
      <p className="font-medium text-proof">{title}</p>
      {detail && <p className="mt-1 font-mono text-[12px] text-ink/80">{detail}</p>}
    </div>
  );
}
