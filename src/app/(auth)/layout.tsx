export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="font-serif text-[32px] font-semibold tracking-wide text-ink">Castellan</div>
          <p className="mt-1 text-meta text-ink-muted">Every great estate had a castellan.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
