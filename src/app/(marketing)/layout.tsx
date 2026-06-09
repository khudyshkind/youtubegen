// Layout for future marketing pages: /about, /pricing, /blog, etc.
// The root landing page (/) lives at src/app/page.tsx and uses src/app/layout.tsx directly.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
