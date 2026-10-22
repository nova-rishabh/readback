export default function Loading() {
  return (
    <div className="mx-auto max-w-[1180px] px-6 py-10 lg:px-8" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading</p>
      <div className="h-8 w-64 rounded bg-rule/70" />
      <div className="mt-3 h-4 w-96 max-w-full rounded bg-rule/50" />
      <div className="mt-8 space-y-px overflow-hidden rounded-md border border-rule">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-11 bg-sheet" />
        ))}
      </div>
    </div>
  );
}
