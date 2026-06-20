/**
 * Phase 0 Week 1 landing page. Placeholder until the real canvas ships.
 */
export default function HomePage() {
  return (
    <main className="container mx-auto px-6 py-16 max-w-3xl">
      <h1 className="text-4xl font-semibold tracking-tight text-context-700 mb-4">ChainSight</h1>
      <p className="text-lg text-context-500 mb-8">
        Autonomous, court-defensible blockchain investigation platform.
      </p>
      <div className="bg-white border border-context-100 rounded-lg p-6 mb-6">
        <p className="text-sm text-context-500 mb-2 uppercase tracking-wide">Phase 0 — Week 1</p>
        <h2 className="text-xl font-semibold mb-3">Foundations</h2>
        <ul className="space-y-2 text-context-700">
          <li>✓ Monorepo (Turborepo)</li>
          <li>✓ Next.js 15 (App Router, React 19)</li>
          <li>✓ Fastify API skeleton with JWKS-generic auth</li>
          <li>✓ Supabase project provisioned</li>
          <li>✓ GitHub Actions CI</li>
          <li>✓ Fly.io app definitions</li>
          <li className="text-context-500">→ Week 2: Belief State Service v0 + encryption layer</li>
        </ul>
      </div>

      <div className="bg-white border border-context-100 rounded-lg p-6 mb-6">
        <p className="text-sm text-context-500 mb-2 uppercase tracking-wide">Live mockups</p>
        <h2 className="text-xl font-semibold mb-3">UI surfaces</h2>
        <ul className="space-y-2 text-context-700">
          <li>
            <a
              href="/inspector-demo"
              className="text-markup-700 underline hover:text-markup-500"
            >
              Surface 1 — Transaction Inspector
            </a>{' '}
            <span className="text-xs text-context-500">
              · click a tx node, watch 8 sections stream in
            </span>
          </li>
          <li className="text-context-500">→ Surface 2: Canvas (Sigma.js, Week 4-5)</li>
          <li className="text-context-500">→ Surface 3: Court Mode (Week 6)</li>
        </ul>
      </div>

      <p className="text-xs text-context-500">
        The vendor is never a counterparty to your investigation.
      </p>
    </main>
  );
}
