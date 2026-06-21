'use client';

import { useEffect, useState } from 'react';
import {
  useAgency,
  useCreateAgency,
  useInstalls,
  useInvitations,
  useInvite,
  useMyAgencies,
  useStoreCredential,
  useUpsertInstall,
} from '../../lib/api/hooks';

const ALL_CAPS = [
  'get_tx_by_hash',
  'get_address_neighbors',
  'get_address_attribution',
  'get_sanctions_status',
  'get_price_at_timestamp',
  'llm_narrative',
  'llm_narrative_stream',
] as const;

export function AgencyAdminClient() {
  const myAgencies = useMyAgencies();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const list = myAgencies.data?.agencies ?? [];
    if (!activeId && list.length > 0) {
      const first = list[0];
      if (first) setActiveId(first.id);
    }
  }, [myAgencies.data, activeId]);

  const detail = useAgency(activeId);
  const invitations = useInvitations(activeId);
  const installs = useInstalls(activeId);

  return (
    <main className="min-h-screen px-6 py-8 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-context-900">Agency admin</h1>
        <p className="text-sm text-context-500">SaaS Blind onboarding: create your agency, invite teammates, plug in your BYOK providers.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* ── Left rail: agency picker + create ─────────────────── */}
        <aside className="lg:col-span-1 space-y-4">
          <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-context-700 mb-2">My agencies</h2>
            <ul className="space-y-1 text-sm">
              {(myAgencies.data?.agencies ?? []).map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setActiveId(a.id)}
                    className={`block w-full text-left px-2 py-1 rounded ${activeId === a.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-context-100'}`}
                  >
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-context-500">{a.slug} · {a.tier}{a.role ? ` · ${a.role}` : ''}</div>
                  </button>
                </li>
              ))}
              {(myAgencies.data?.agencies ?? []).length === 0 && (
                <li className="text-context-500 text-xs">No agencies yet — create one below.</li>
              )}
            </ul>
          </div>
          <CreateAgencyForm onCreated={setActiveId} />
        </aside>

        {/* ── Right: detail ──────────────────────────────────────── */}
        <section className="lg:col-span-3 space-y-6">
          {!activeId && (
            <div className="border border-context-300 bg-white rounded-lg p-6 text-context-500 text-sm">
              Select or create an agency to manage.
            </div>
          )}

          {activeId && (
            <>
              <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
                <h2 className="text-lg font-semibold mb-3">Members</h2>
                <ul className="divide-y divide-context-200 text-sm">
                  {(detail.data?.members ?? []).map((m) => (
                    <li key={m.user_id} className="py-1.5 flex items-center justify-between">
                      <code className="text-xs text-context-700">{m.user_id.slice(0, 8)}…{m.user_id.slice(-4)}</code>
                      <span className="text-xs text-context-600">{m.role} · joined {new Date(m.added_at).toLocaleDateString()}</span>
                    </li>
                  ))}
                  {(detail.data?.members ?? []).length === 0 && <li className="text-context-500 text-xs py-2">No members yet.</li>}
                </ul>
              </div>

              <InvitePanel agency_id={activeId} pending={invitations.data?.invitations ?? []} />
              <InstallsPanel agency_id={activeId} installs={installs.data?.installs ?? []} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function CreateAgencyForm({ onCreated }: { onCreated: (id: string) => void }) {
  const create = useCreateAgency();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tier, setTier] = useState<'investigator' | 'team' | 'enterprise'>('investigator');

  return (
    <form
      className="border border-context-300 bg-white rounded-lg p-4 shadow-sm space-y-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await create.mutateAsync({ name, slug, tier });
        onCreated(r.agency_id);
        setName(''); setSlug('');
      }}
    >
      <h2 className="text-sm font-semibold text-context-700">Create agency</h2>
      <label className="block">
        <span className="text-context-600">Name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1" />
      </label>
      <label className="block">
        <span className="text-context-600">Slug</span>
        <input required pattern="[a-z0-9][a-z0-9-]+[a-z0-9]" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs" />
      </label>
      <label className="block">
        <span className="text-context-600">Tier</span>
        <select value={tier} onChange={(e) => setTier(e.target.value as 'investigator' | 'team' | 'enterprise')} className="mt-1 w-full border border-context-300 rounded px-2 py-1">
          <option value="investigator">Investigator ($49/mo)</option>
          <option value="team">Team ($98/mo min)</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </label>
      <button type="submit" disabled={create.isPending} className="w-full py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300">
        {create.isPending ? 'Creating…' : 'Create agency'}
      </button>
      {create.error && <p className="text-xs text-red-700">{(create.error as Error).message}</p>}
    </form>
  );
}

function InvitePanel({ agency_id, pending }: { agency_id: string; pending: Array<{ id: string; email: string; role: string; invited_at: string; accepted_at?: string | null; revoked_at?: string | null }> }) {
  const invite = useInvite(agency_id);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'supervisor' | 'investigator'>('investigator');

  return (
    <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-lg font-semibold mb-3">Invitations</h2>
      <form
        className="flex flex-wrap items-end gap-2 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          await invite.mutateAsync({ email, role });
          setEmail('');
        }}
      >
        <label className="flex-1 min-w-[200px]">
          <span className="text-context-600">Email</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1" />
        </label>
        <label>
          <span className="text-context-600">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'supervisor' | 'investigator')} className="mt-1 border border-context-300 rounded px-2 py-1">
            <option value="investigator">investigator</option>
            <option value="supervisor">supervisor</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit" disabled={invite.isPending} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300">
          {invite.isPending ? 'Sending…' : 'Invite'}
        </button>
      </form>
      <ul className="mt-3 divide-y divide-context-200 text-sm">
        {pending.map((p) => (
          <li key={p.id} className="py-1.5 flex items-center justify-between">
            <span>{p.email} <span className="text-xs text-context-500">({p.role})</span></span>
            <span className="text-xs text-context-500">{p.accepted_at ? 'accepted' : p.revoked_at ? 'revoked' : 'pending'} · {new Date(p.invited_at).toLocaleDateString()}</span>
          </li>
        ))}
        {pending.length === 0 && <li className="text-context-500 text-xs py-2">No invitations.</li>}
      </ul>
    </div>
  );
}

function InstallsPanel({ agency_id, installs }: { agency_id: string; installs: Array<{ id: string; provider_id: string; enabled_capabilities: string[]; priority: number; credential_ref: string | null; enabled: boolean; budget_usd_per_month: number | null }> }) {
  const upsert = useUpsertInstall(agency_id);
  const storeCred = useStoreCredential(agency_id);
  const [providerId, setProviderId] = useState('etherscan');
  const [capabilities, setCapabilities] = useState<string[]>(['get_tx_by_hash']);
  const [priority, setPriority] = useState(100);
  const [secret, setSecret] = useState('');
  const [label, setLabel] = useState('default');

  const toggleCap = (cap: string) => {
    setCapabilities((cur) => (cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap]));
  };

  return (
    <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
      <h2 className="text-lg font-semibold mb-3">Provider installs (BYOK)</h2>

      <form
        className="space-y-3 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          let credential_ref: string | null = null;
          if (secret) {
            const cred = await storeCred.mutateAsync({ provider_id: providerId, label, secret });
            credential_ref = `vault:${cred.credential.id}`;
          }
          await upsert.mutateAsync({ provider_id: providerId, enabled_capabilities: capabilities, priority, credential_ref });
          setSecret('');
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-context-600">Provider id</span>
            <input required value={providerId} onChange={(e) => setProviderId(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs" />
          </label>
          <label className="block">
            <span className="text-context-600">Priority (low wins)</span>
            <input type="number" min={1} max={1000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="mt-1 w-full border border-context-300 rounded px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-context-600">Credential label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1" />
          </label>
        </div>

        <div>
          <span className="text-context-600 text-xs">Capabilities</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {ALL_CAPS.map((c) => (
              <label key={c} className={`text-xs px-2 py-1 rounded border cursor-pointer ${capabilities.includes(c) ? 'bg-blue-50 border-blue-400 text-blue-800' : 'border-context-300 text-context-700'}`}>
                <input type="checkbox" checked={capabilities.includes(c)} onChange={() => toggleCap(c)} className="hidden" />
                {c}
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-context-600">API key / secret (stored encrypted, never leaves your install)</span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="leave empty if provider is keyless" className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs" />
        </label>

        <button type="submit" disabled={upsert.isPending || storeCred.isPending} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300">
          {upsert.isPending || storeCred.isPending ? 'Saving…' : 'Save install'}
        </button>
      </form>

      <ul className="mt-4 divide-y divide-context-200 text-sm">
        {installs.map((i) => (
          <li key={i.id} className="py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono">{i.provider_id}</span>
              <span className="text-xs text-context-500">priority {i.priority}{i.enabled ? '' : ' · disabled'}</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {i.enabled_capabilities.map((c) => (
                <span key={c} className="text-[10px] bg-context-200 px-1.5 py-0.5 rounded">{c}</span>
              ))}
            </div>
            {i.credential_ref && (
              <div className="text-xs text-context-500 mt-1">credential <code>{i.credential_ref.slice(0, 16)}…</code></div>
            )}
          </li>
        ))}
        {installs.length === 0 && <li className="text-context-500 text-xs py-2">No installs yet.</li>}
      </ul>
    </div>
  );
}
