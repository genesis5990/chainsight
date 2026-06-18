# ChainSight v1.0 — Frontend UX Architecture

> **Document type:** Discipline-agent deep-pass design output  
> **Audience:** Solo developer + AI agents building ChainSight  
> **Stack:** Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui + Zustand + React Query + Yjs (Phase 2+) + Sigma.js v3 + Recharts + D3 (Sankey) + Supabase (Auth + Postgres + Storage + Realtime)  
> **Principle (locked):** "So Easy a Caveman Can Do It" on the surface. Uncompromising sophistication beneath.

---

## Section 1 — Next.js Application Structure

### 1.1 App Router layout

The application is a single Turborepo workspace at `apps/web`. The App Router drives the entire URL structure. Every route is a deeply nested server-component tree; only the components that require browser state (`"use client"`) drop into the client boundary.

```
apps/web/app/
├── layout.tsx                    # Root layout — fonts, theme provider, analytics
├── (auth)/
│   ├── login/page.tsx            # Supabase Auth sign-in
│   ├── onboarding/page.tsx       # First-run API key entry
│   └── layout.tsx                # Auth shell (no sidebar)
├── (app)/
│   ├── layout.tsx                # Authenticated shell — sidebar + top bar
│   ├── cases/
│   │   ├── page.tsx              # Case list / dashboard
│   │   ├── new/page.tsx          # New case wizard
│   │   └── [caseId]/
│   │       ├── layout.tsx        # Case frame (tabs, header, active case context)
│   │       ├── page.tsx          # Redirect → canvas
│   │       ├── canvas/page.tsx   # Main investigation canvas (Sigma.js)
│   │       ├── evidence/page.tsx # Marks + memos + important sidebar
│   │       ├── paths/
│   │       │   ├── page.tsx      # Path list
│   │       │   └── [pathId]/page.tsx  # Path detail + PSR report
│   │       ├── wallets/
│   │       │   ├── page.tsx      # Wallet list
│   │       │   └── [walletId]/page.tsx  # Wallet analysis results
│   │       ├── documents/page.tsx  # Document ingest + viewer
│   │       ├── deconfliction/page.tsx  # Deconfliction tab
│   │       ├── reports/
│   │       │   ├── page.tsx      # Report list
│   │       │   └── [reportId]/page.tsx  # Report editor
│   │       └── court/page.tsx    # Court Mode (full-screen on enter)
│   ├── marketplace/
│   │   ├── page.tsx              # Provider catalog
│   │   ├── installed/page.tsx    # Installed providers + cost telemetry
│   │   └── models/page.tsx       # Model configuration matrix
│   ├── attributions/page.tsx     # Personal attribution library
│   ├── supervisor/page.tsx       # Supervisor dashboard (role-gated)
│   └── settings/
│       ├── profile/page.tsx      # Expert witness profile
│       ├── agency/page.tsx       # Agency settings (admin-only)
│       └── appearance/page.tsx   # Theme, keyboard shortcuts
├── api/
│   └── [...trpc]/route.ts        # tRPC handler (all internal API calls)
└── court-viewer/
    └── [packHash]/page.tsx       # Reproducibility Pack viewer (no auth required)
```

### 1.2 Route organization decisions

**The canvas is the primary surface.** Every case loads directly to `/cases/[caseId]/canvas`. The URL never changes while the investigator pans and zooms — the graph state is not URL-encoded (too large). Deep-linking to a specific entity is done via query params (`?focus=tx:0xabc` or `?open=inspector:0xabc`), which the canvas reads on mount to snap focus.

**Court Mode lives at a distinct URL** (`/cases/[caseId]/court`) and loads as a full-screen overlay that hides the shell. The presenter never accidentally exits Court Mode by clicking the browser chrome because the URL is different from the canvas URL and the shell layout renders nothing in Court Mode.

**The standalone court viewer** (`/court-viewer/[packHash]`) is unauthenticated and reads only a Reproducibility Pack from content-addressed storage. This is the artifact distributed to courtrooms, prosecutors, and opposing counsel. It shares the same canvas rendering code but has zero write capabilities.

### 1.3 Server vs. client components

**Server components own:**
- Case list rendering (RSC fetches from Postgres via tRPC server action, streams to client)
- Report rendering (markdown body, static data, citation tables)
- Document viewer PDF embedding
- Marketplace catalog (static content with dynamic install status overlaid from Suspense)
- User profile and settings forms

**Client components own (always `"use client"`):**
- The entire canvas container (`<CanvasRoot>`) — Sigma.js requires the DOM and WebGL
- Transaction Inspector popup (real-time streaming state)
- Path selection toolbar (local interaction state machine)
- Refresh button + last-refresh badge (polling every 60s for TTL display)
- Any modal, drawer, or popover that requires portal rendering
- Keyboard shortcut handler (global `useEffect` on `keydown`)

**The key rule:** A server component renders the case shell, the tab bar, the sidebar widgets, and static data. The canvas URL segment swaps in a client boundary that owns everything inside the graph viewport. This means the initial page load is fast (server-rendered chrome), and the canvas hydrates independently without blocking layout.



### 1.4 Authentication boundary (Supabase Auth)

**Stack change from original design:** SaaS Blind v1 uses Supabase Auth instead of Clerk. The auth primitives are `@supabase/auth-helpers-nextjs` and `@supabase/ssr`. The On-Prem Sovereign deployment uses a self-hosted Supabase instance (or Ory Kratos as an alternative) — the same code paths work unchanged because the Supabase client is injected via environment variables.

#### SSR-friendly client setup

Two Supabase client factories are required for Next.js 15 App Router: a **server client** (for Server Components and Route Handlers) and a **browser client** (for Client Components). Both share the same `NEXT_PUBLIC_SUPABASE_URL` and key; the difference is how they read/write cookies.

```typescript
// lib/supabase/server.ts — for Server Components + Route Handlers
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/supabase-generated';

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}

// lib/supabase/client.ts — for Client Components (singleton)
import { createBrowserClient } from '@supabase/ssr';

export const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

#### Auth boundary in the App Router

The `(app)/layout.tsx` server component reads the session via the server Supabase client. No `auth()` middleware call — instead, Supabase session cookies are refreshed on every server-render via a middleware shim.

```typescript
// middleware.ts — runs on every request in the (app) route group
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh session — this is what keeps auth tokens alive across RSC renders
  const { data: { user } } = await supabase.auth.getUser();

  // Protect (app) routes
  const isAppRoute = request.nextUrl.pathname.startsWith('/cases') ||
    request.nextUrl.pathname.startsWith('/marketplace') ||
    request.nextUrl.pathname.startsWith('/attributions') ||
    request.nextUrl.pathname.startsWith('/supervisor');

  if (!user && isAppRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|court-viewer).*)'],
};
```

```typescript
// (app)/layout.tsx — server component
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function AppLayout({ children }) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // agency_id stored in user's app_metadata (set by our API at registration)
  const agencyId = user.app_metadata?.agency_id as string;
  if (!agencyId) redirect('/onboarding'); // first-run: no agency yet

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, name, settings')
    .eq('id', agencyId)
    .single();

  return (
    <AgencyProvider agency={agency}>
      <ShellLayout>{children}</ShellLayout>
    </AgencyProvider>
  );
}
```

#### Login page

```typescript
// (auth)/login/page.tsx
'use client';
import { supabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); return; }
    router.push('/cases');
  }

  // MFA challenge fires automatically if the user has TOTP enrolled;
  // Supabase returns an MFA_REQUIRED factor challenge that we handle
  // in a second step (see §1.6 — MFA for high-impact actions).
  
  return (
    <AuthForm onSubmit={handleSignIn}>
      <Input type="email" value={email} onChange={...} label="Email" />
      <Input type="password" value={password} onChange={...} label="Password" />
      <Button type="submit">Sign in</Button>
    </AuthForm>
  );
}
```

#### Auth state in client components

Client components that need the current user read it from a `useSession()` hook backed by a React Context that wraps Supabase's `onAuthStateChange` listener. This avoids prop-drilling the user object and provides a reactive auth state that updates on token refresh.

```typescript
// providers/SessionProvider.tsx
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

const SessionContext = createContext<{ user: User | null }>({ user: null });

export function SessionProvider({ initialUser, children }) {
  const [user, setUser] = useState<User | null>(initialUser);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_, session) => setUser(session?.user ?? null)
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={{ user }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
```

The `initialUser` is injected by the server component via `HydrationBoundary` pattern — the server reads the user from the cookie, passes it as a prop to the `SessionProvider`, so the initial client render has the user without an extra round-trip.

### 1.5 MFA for high-impact actions

Supabase Auth's TOTP and WebAuthn factors are used to gate high-impact actions: finalizing a path, freezing funds, generating a court-grade report, approving a supervisor checkpoint.

The MFA challenge flow is a client-side modal that wraps any high-impact mutation:

```typescript
// hooks/useMFAGate.ts
export function useMFAGate() {
  const [challengeState, setChallengeState] = useState<'idle' | 'needed' | 'verifying' | 'passed'>();

  async function requestMFA(): Promise<boolean> {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    if (!factors.totp?.length && !factors.webAuthn?.length) {
      // No MFA enrolled — surface enrollment prompt (not a hard block in Phase 0,
      // becomes mandatory for agency-tier in Phase 2)
      return true;
    }

    setChallengeState('needed'); // opens the MFA modal
    return new Promise((resolve) => {
      mfaResolveRef.current = resolve;
    });
  }

  async function verifyTOTP(code: string) {
    const { data: challenge } = await supabase.auth.mfa.challenge({
      factorId: totpFactorId,
    });
    const { error } = await supabase.auth.mfa.verify({
      factorId: totpFactorId,
      challengeId: challenge.id,
      code,
    });
    if (error) { setError('Invalid code'); return; }
    setChallengeState('passed');
    mfaResolveRef.current?.(true);
  }

  return { requestMFA, verifyTOTP, challengeState };
}

// Usage in a high-impact mutation:
async function finalizePathWithMFA(pathId: string) {
  const passed = await requestMFA();
  if (!passed) return;
  await trpc.paths.finalize.mutate({ pathId });
}
```

WebAuthn (hardware security key) support follows the same pattern via Supabase's `supabase.auth.mfa.enroll({ factorType: 'webauthn' })` flow.

### 1.6 Multi-tenancy in routing

Each agency maps to a `agency_id` UUID stored in the Supabase user's `app_metadata`. The URL never contains an agency slug — the agency is inferred from the auth session. Row-Level Security (RLS) on every Postgres table enforces the agency boundary: every RLS policy checks `auth.jwt()->'app_metadata'->>'agency_id'` matches the row's `agency_id` column.

```sql
-- Example RLS policy on the cases table
CREATE POLICY "Investigators access their agency's cases"
  ON cases
  FOR ALL
  USING (agency_id = (auth.jwt()->'app_metadata'->>'agency_id')::uuid);

-- Supervisors can also see cases in their span of control
CREATE POLICY "Supervisors see cases in scope"
  ON cases
  FOR SELECT
  USING (
    agency_id = (auth.jwt()->'app_metadata'->>'agency_id')::uuid
    AND (
      -- Line investigator sees their own cases
      created_by = auth.uid()
      OR
      -- Supervisor sees all cases in their scope
      EXISTS (
        SELECT 1 FROM supervisory_roles sr
        WHERE sr.investigator_id = auth.uid()
          AND sr.scope = 'agency'
      )
    )
  );
```

**The RLS-as-security-layer principle:** Even if the frontend has a bug and sends the wrong `agency_id` in a query, the RLS policy rejects unauthorized reads at the database layer. RLS is the security guarantee; the application code is a UX convenience on top of it.

For cross-agency case sharing (Phase 3+), a `case_access_grants` table tracks temporary cross-agency permissions. RLS policies check this table as a secondary allow path.

---

## Section 2 — State Management Architecture

### 2.1 The three layers

```
┌──────────────────────────────────────────────────────────────────────┐
│                         ZUSTAND (UI State)                           │
│  What's selected on canvas, which inspector is open, active PSR     │
│  mode, keyboard shortcut overrides, theme, panel layouts            │
│  Rule: never holds server data; never survives page refresh         │
├──────────────────────────────────────────────────────────────────────┤
│              REACT QUERY wrapping SUPABASE (Server Cache)            │
│  Case data, graph nodes/edges, belief atoms, provider installs,     │
│  personal attributions, wallet analyses, deconfliction alerts       │
│  Rule: all case-touching reads route through the API (audit log)    │
│  Exception: non-sensitive reads may hit Supabase directly (RLS)     │
├──────────────────────────────────────────────────────────────────────┤
│              SUPABASE REALTIME (Push notifications only)             │
│  Deconfliction alerts, watcher fires, supervisor review queue,      │
│  presence indicators ("J. Doe is viewing this case")               │
│  Rule: Supabase Realtime is NOT used for canvas CRDT                │
├──────────────────────────────────────────────────────────────────────┤
│                         YJS (CRDT, Phase 2+)                         │
│  Real-time collaborative canvas positions, shared path selections,  │
│  real-time memo co-authoring, shared investigator marks             │
│  Rule: Yjs over y-websocket; Supabase Realtime not appropriate here │
└──────────────────────────────────────────────────────────────────────┘
```

**The hard boundary:** Supabase Realtime uses Postgres logical replication (Postgres Changes) or Broadcast channels — both are excellent for push notifications but are not designed for operational transformation or CRDT merging. OT/CRDT for the canvas requires Yjs over a WebSocket server (Phase 2+). The two systems have entirely different roles and must not be conflated.

### 2.2 Zustand store design

One top-level store with slices. Unchanged from initial design — Supabase replaces the data source but not the UI state shape.

```typescript
// stores/canvas.ts
interface CanvasUIStore {
  // Selection
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  hoveredNodeId: string | null;
  selectionMode: 'default' | 'path-click' | 'path-lasso' | 'path-nl';
  
  // Path building
  activePathId: string | null;
  pathBuildSteps: PathStep[];
  
  // Inspector
  openInspectors: InspectorState[];  // multiple can be open (compare mode)
  
  // Overlay
  moneyFlowOverlayActive: boolean;
  activeMethodology: Methodology;
  
  // LOD
  zoomLevel: number;
  
  // Actions
  selectNode: (id: string, extend?: boolean) => void;
  openInspector: (txId: string) => void;
  setMethodology: (m: Methodology) => void;
}

// stores/ui.ts  
interface UIStore {
  importantSidebarOpen: boolean;
  activeTab: CaseTab;
  courtModeActive: boolean;
  apiKeyModalOpen: boolean;
  refreshDropdownOpen: boolean;
  notifications: Notification[];
  shortcutBindings: Record<string, string>;
}

// stores/realtime.ts — tracks live presence
interface RealtimeStore {
  casePresence: Map<string, PresenceEntry[]>; // caseId → [who's here]
  unreadAlerts: DeconflictionAlert[];
  supervisorQueueCount: number;
}
```

**Rule:** Zustand never holds server data. If something needs to survive a page refresh, it belongs in React Query or Supabase Realtime state.

### 2.3 React Query wrapping Supabase

React Query is the caching and invalidation layer over both the tRPC API and direct Supabase reads. Every Supabase query goes through a React Query `useQuery` or `useMutation`. Raw `supabase.from(...)` calls are never made directly in components — always via a hook that wraps React Query.

```typescript
// lib/query-keys.ts — canonical key factory
export const queryKeys = {
  case:          (id: string) => ['case', id] as const,
  caseList:      (agencyId: string) => ['cases', agencyId] as const,
  caseGraph:     (caseId: string, viewport?: Viewport) =>
                   ['case', caseId, 'graph', viewport] as const,
  caseInspector: (caseId: string, txId: string) =>
                   ['case', caseId, 'inspector', txId] as const,
  providers:     () => ['providers'] as const,
  attributions:  (userId: string) => ['attributions', userId] as const,
  refreshStatus: (caseId: string) => ['refresh-status', caseId] as const,
  walletAnalysis:(caseId: string, walletId: string) =>
                   ['wallet', caseId, walletId] as const,
};
```

#### Direct Supabase reads (non-sensitive, RLS-gated)

The following reads bypass the tRPC API and hit Supabase directly, because they are high-frequency reads with no write side-effects and are fully protected by RLS:

```typescript
// hooks/useCaseList.ts — direct Supabase read (no audit log entry needed for list)
export function useCaseList() {
  const { user } = useSession();
  return useQuery({
    queryKey: queryKeys.caseList(user!.app_metadata.agency_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cases')
        .select('id, codename, status, classification, created_by, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,    // 1 minute
  });
}

// hooks/usePersonalAttributions.ts — direct Supabase read
export function usePersonalAttributions() {
  const { user } = useSession();
  return useQuery({
    queryKey: queryKeys.attributions(user!.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('personal_attributions')
        .select('*')
        .eq('attributor_id', user!.id);
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

#### Audit-logged writes (always through tRPC API)

Any write that touches case data must go through the API so the audit log entry is created:

```typescript
// hooks/useCreateMark.ts — write through tRPC (not direct Supabase)
export function useCreateMark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mark: CreateMarkInput) =>
      trpc.marks.create.mutate(mark),  // API writes mark + BeliefAtom + audit entry
    onMutate: async (mark) => {
      // Optimistic update: glow ring appears immediately on canvas
      sigmaRef.current?.graph.setNodeAttribute(
        mark.targetRef,
        'isImportant',
        true
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.caseGraph(variables.caseId),
      });
    },
    onError: (_, variables) => {
      // Rollback optimistic update
      sigmaRef.current?.graph.setNodeAttribute(
        variables.targetRef,
        'isImportant',
        false
      );
    },
  });
}
```

#### Graph data — always through tRPC

Graph data (nodes, edges, path steps, edge annotations) always routes through the API. Rationale: graph queries require the Memgraph graph store, not just Postgres, and the API handles the fan-out between Postgres and Memgraph. Additionally, every graph read for a case is an audit event — the investigator's exploration pattern is part of the chain of custody.

```typescript
// hooks/useGraphViewport.ts
export function useGraphViewport(caseId: string, viewport: Viewport) {
  return useQuery({
    queryKey: queryKeys.caseGraph(caseId, viewport),
    queryFn: () => trpc.case.getGraphViewport.query({ caseId, viewport }),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,  // no flash when panning
  });
}
```

### 2.4 Supabase Realtime subscriptions

Supabase Realtime handles **push notifications only** — not data sync. The pattern: a Realtime subscription triggers React Query invalidations, which then re-fetch fresh data via the normal query path.

```typescript
// hooks/useDeconflictionAlerts.ts
export function useDeconflictionAlerts(caseId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Subscribe to new alerts for this case
    const channel = supabase
      .channel(`deconfliction:${caseId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'deconfliction_alerts',
          filter: `case_id=eq.${caseId}`,
        },
        (payload) => {
          // New alert arrived — update Zustand (unread count) and invalidate
          realtimeStore.getState().addUnreadAlert(payload.new as DeconflictionAlert);
          queryClient.invalidateQueries({
            queryKey: ['deconfliction-alerts', caseId],
          });
          // Toast notification with action buttons
          toast.info(`Overlap detected with another case — review in Deconfliction tab`, {
            action: { label: 'Review', onClick: () => router.push(`/cases/${caseId}/deconfliction`) },
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [caseId, queryClient]);
}
```

#### All Realtime subscriptions and their purposes

| Channel pattern | Table/event | Purpose | React Query invalidation |
|---|---|---|---|
| `deconfliction:{caseId}` | `deconfliction_alerts` INSERT | New overlap alert | `['deconfliction-alerts', caseId]` |
| `supervisor-queue:{supervisorId}` | `review_checkpoints` INSERT/UPDATE | New item in review queue | `['supervisor-queue', supervisorId]` |
| `watcher:{caseId}` | `watcher_fires` INSERT | Watcher triggered | `['watcher-fires', caseId]`, toast |
| `wallet-analysis:{walletId}` | `wallet_addresses` UPDATE | Per-address analysis complete | `['wallet', caseId, walletId]` |
| `case-presence:{caseId}` | Broadcast (not Postgres Changes) | Presence indicators | Zustand `realtimeStore.casePresence` |
| `inspector-complete:{analysisId}` | `transaction_analyses` UPDATE | Inspector streaming done | `['inspector', caseId, txId]` |

#### Presence indicators

Presence uses Supabase Realtime Broadcast (not Postgres Changes — presence is ephemeral, not persisted):

```typescript
// hooks/useCasePresence.ts
export function useCasePresence(caseId: string) {
  const { user } = useSession();

  useEffect(() => {
    const channel = supabase.channel(`presence:${caseId}`, {
      config: { presence: { key: user!.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const present = Object.values(state).flat() as PresenceEntry[];
        realtimeStore.getState().setCasePresence(caseId, present);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: user!.id,
            displayName: user!.user_metadata.display_name,
            avatarUrl: user!.user_metadata.avatar_url,
            joinedAt: new Date().toISOString(),
          });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [caseId, user]);
}
```

Presence renders in the top bar as avatar chips: `[J.D.] [S.P.] +2` — showing who else is currently viewing this case. This is Phase 1 read-only awareness; Phase 2 adds Yjs-backed collaborative editing.

#### Why Supabase Realtime is NOT used for canvas CRDT

Supabase Realtime Broadcast is low-latency pub/sub, not OT/CRDT. For collaborative canvas editing (Phase 2+), the requirements are:
- **Conflict-free merging** of concurrent node position changes from N investigators
- **Offline support** (an investigator temporarily loses connection; their changes merge cleanly on reconnect)
- **Causal ordering** (memo edits must preserve causal history)

These requirements demand Yjs's CRDT algorithm running over a WebSocket server (`y-websocket`). Supabase Realtime has no merge semantics — it's last-write-wins broadcast. Using it for CRDT would produce divergent canvas states between investigators. **This is a clear architectural boundary that must never be crossed.**

### 2.5 Supabase Storage for documents and attachments

Document uploads (case documents, memo attachments) go directly from the browser to Supabase Storage using signed upload URLs. This avoids routing binary data through the API server.

```typescript
// hooks/useDocumentUpload.ts
export function useDocumentUpload(caseId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ file, documentType }: UploadInput) => {
      // Step 1: Request a signed upload URL from the API
      // The API validates permissions, creates the CaseDocument record,
      // and returns the Supabase Storage path + signed URL
      const { uploadUrl, storagePath, documentId } =
        await trpc.documents.requestUploadUrl.mutate({
          caseId,
          filename: file.name,
          mimeType: file.type,
          documentType,
        });

      // Step 2: Upload directly to Supabase Storage (bypasses API; no binary in transit twice)
      const { error: uploadError } = await supabase.storage
        .from('case-documents')
        .uploadToSignedUrl(storagePath, uploadUrl, file, {
          contentType: file.type,
        });
      if (uploadError) throw uploadError;

      // Step 3: Notify API that upload succeeded; API triggers extraction pipeline
      await trpc.documents.confirmUpload.mutate({ documentId });

      return documentId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['case-documents', caseId],
      });
    },
  });
}
```

#### Storage bucket organization

```
case-documents/
  {agencyId}/
    {caseId}/
      {documentId}/{filename}       # encrypted at rest by Supabase Storage + KMS
      
memo-attachments/
  {agencyId}/
    {caseId}/
      {memoId}/{attachmentId}

reproducibility-packs/
  {agencyId}/
    {caseId}/
      {packHash}.zip                # immutable; object lock enabled

court-viewer-packs/
  public/                           # RLS allows unauthenticated reads
    {packHash}.zip                  # only packs explicitly published for court
```

**RLS on storage buckets:**

```sql
-- case-documents bucket: only agency members can read/write
CREATE POLICY "Agency members access their case documents"
  ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'case-documents'
    AND (storage.foldername(name))[1] =
        (auth.jwt()->'app_metadata'->>'agency_id')
  );

-- court-viewer-packs bucket: public read (for courtroom distribution)
CREATE POLICY "Court packs are publicly readable"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'court-viewer-packs');
```

**On-Prem note:** On-Prem Sovereign deployments replace Supabase Storage with the agency's configured storage backend (MinIO, S3, NFS, etc.) per v0.5 F2's `StorageBackend` abstraction. The `useDocumentUpload` hook is backend-agnostic — the API decides which upload URL to issue (Supabase vs. MinIO pre-signed URL vs. API-proxied upload). The component code is identical.

### 2.6 Yjs CRDT layer (Phase 2+)

Yjs connects to a `y-websocket` server keyed by `case_id`. The WebSocket server validates the Supabase JWT on the initial handshake (the client passes its Supabase access token as a query parameter; the server calls `supabase.auth.getUser(token)` to verify agency membership before allowing the Yjs document to be joined).

```typescript
// Phase 2 — canvas collaborative provider
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const doc = new Y.Doc();
const wsProvider = new WebsocketProvider(
  process.env.NEXT_PUBLIC_YJS_WS_URL!,
  `case-${caseId}`,
  doc,
  {
    // Pass Supabase access token for auth on the WS server
    params: { token: session.access_token },
  }
);

// Shared types within the case document
const nodePositions = doc.getMap<{ x: number; y: number }>('nodePositions');
const sharedPathSteps = doc.getArray<PathStep>('pathSteps');
const memoContent = doc.getText(`memo-${memoId}`);

// Yjs awareness for cursor presence (supplements Supabase Realtime presence)
const awareness = wsProvider.awareness;
awareness.setLocalStateField('user', {
  userId: user.id,
  displayName: user.user_metadata.display_name,
  color: getPresenceColor(user.id), // deterministic from userId
});
```

**Phase 2 canvas sync model:**
- Node positions sync via Yjs (`Y.Map`); Sigma reads positions from Yjs on update
- Sigma's camera state is NOT synced — each investigator controls their own viewport
- Path selections in progress sync via Yjs (`Y.Array`) — other investigators see the path being built in real-time as a faint preview overlay
- Memo content syncs via Yjs (`Y.Text`) with real-time collaborative editing (Tiptap's Yjs adapter)
- All other canvas state (marks, tags, evidence) is write-through: written to the API, read from React Query, not synced via Yjs

### 2.7 React Query + Supabase hydration strategy

Server components pre-fetch data and pass it to React Query via `HydrationBoundary`. This eliminates the initial data waterfall for the most common server-rendered surfaces.

```typescript
// (app)/cases/[caseId]/layout.tsx — server component
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';

export default async function CaseLayout({ params, children }) {
  const queryClient = new QueryClient();
  const supabase = createSupabaseServerClient();

  // Pre-fetch case metadata (used by every tab)
  await queryClient.prefetchQuery({
    queryKey: queryKeys.case(params.caseId),
    queryFn: async () => {
      const { data } = await supabase
        .from('cases')
        .select('id, codename, status, classification, settings')
        .eq('id', params.caseId)
        .single();
      return data;
    },
  });

  // Pre-fetch path list (lightweight; needed by Evidence and Reports tabs)
  await queryClient.prefetchQuery({
    queryKey: ['case-paths', params.caseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('trace_paths')
        .select('id, display_name, color, status, is_primary, total_hops')
        .eq('case_id', params.caseId)
        .order('created_at', { ascending: true });
      return data;
    },
  });

  // Canvas graph data is NOT pre-fetched server-side — it's large and
  // requires Memgraph, so it's client-side only with a skeleton on first render

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}
```

**What is and isn't pre-fetched:**

| Data | Pre-fetched RSC? | Rationale |
|---|---|---|
| Case metadata | Yes | Tiny; needed for every tab; fast Postgres query |
| Path list | Yes | Needed for header stats; fast Postgres query |
| Canvas graph | No | Large; requires Memgraph fan-out; skeleton on load |
| Inspector analysis | No | Expensive; on-demand only |
| Provider installs | Yes (marketplace only) | Pre-fetch on marketplace route |
| Personal attributions | No | Client-side; user-scoped direct Supabase read |
| Wallet analysis | No | Large async result; polling pattern |



## Section 3 — The Canvas Rendering Pipeline (Sigma.js v3)

### 3.1 Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                    React Component Tree                  │
│  <CanvasRoot> → <SigmaContainer> → <GraphController>   │
│                                                          │
│  Canvas state read from Zustand. Graph data from        │
│  React Query. Sigma graph mutated via ref, never re-     │
│  rendered by React (WebGL owns the pixels).             │
└────────────────────────┬────────────────────────────────┘
                         │ sigma.graph.* imperative calls
┌────────────────────────▼────────────────────────────────┐
│                   Sigma.js v3 Instance                   │
│  - sigma.graph: graphology Graph object                  │
│  - Camera: zoom, pan, animated transitions               │
│  - Renderers: NodeCircleProgram, NodeImageProgram,       │
│               EdgeLineProgram, EdgeArrowProgram          │
│  - Event bus: clickNode, clickEdge, clickStage,          │
│               doubleClickNode, rightClickNode            │
└────────────────────────┬────────────────────────────────┘
                         │ custom WebGL programs
┌────────────────────────▼────────────────────────────────┐
│               Custom WebGL Programs                      │
│  - DiamondNodeProgram (TransactionNodes)                 │
│  - ClusterNodeProgram (grouped addresses)                │
│  - PercentageLabelProgram (edge inline percentages)     │
│  - PathRingProgram (layered path color rings)            │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Node types and visual encoding

**AddressNode (circle)**

```
Normal state:                Selected state:
    ╭───╮                        ╭───╮
    │ 🏦 │ ← entity icon          │ 🏦 │
    ╰───╯                        ╰───╯  ← glow ring (selection color)
   0xab..                       0xab..
                               
  Circle fill: semantic color   
  Border: 2px, slightly darker  
  Badges: stacked (icon cluster)
  
Diameter: log-scale of value handled (min 12px, max 48px)
```

**TransactionNode (diamond)**

```
Normal state:        Path-colored state:
    ◇                    ◇  ← diamond shape
   / \                  / \
  Path ring surrounds  [A] outer ring = Path A color
  the diamond when     [B] inner ring = Path B color
  in multiple paths        (layered rings per v0.5 F5)
```

**ClusterNode (rounded rectangle)**

```
    ╔══════════════╗
    ║  47 addresses║ ← count badge
    ║   (cluster)  ║ ← entity label if attributed
    ╚══════════════╝
    
Double-click → explodes into individual AddressNodes within cluster boundary
```

### 3.3 Edge types and visual encoding

All edges are directional: address→tx or tx→address. Edge rendering rules:

| Property | Encoding |
|---|---|
| Thickness | log10(absolute_value_native), clipped to [1px, 8px] |
| Color | semantic palette by taint %; desaturates as taint drops |
| Opacity | share_of_parent_tx (0.3 → 1.0) |
| Arrow | always present, size proportional to thickness |
| Label | `{percentage}% / {amount} {token}` — appears at medium zoom |
| Fiat label | `~${fiat_at_tx}` — muted, appears at close zoom |

**Money-flow overlay mode:** When the `moneyFlowOverlayActive` flag is true in Zustand, every edge renders its `cumulative_share_from_source` under the active methodology. Edges with < 1% taint render gray at 30% opacity, creating a natural fade-out of dead ends. Switching methodology triggers a single Zustand action that causes the graph renderer to re-read the `EdgeValueAnnotation` cache and redraw — no re-fetch, because all six methodology values are pre-populated from the Math Service.

### 3.4 Color mapping (semantic palette, locked)

```typescript
// packages/shared-types/src/colors.ts — the canonical palette
export const SemanticColors = {
  // Taint families
  taint_critical:   '#C0392B',  // red family — confirmed criminal / sanctioned
  taint_high:       '#E67E22',  // orange — elevated risk, unconfirmed
  taint_medium:     '#F39C12',  // yellow — caution, pending verification
  taint_low:        '#27AE60',  // green — clean / attributed legitimate
  
  // Investigation families
  investigator_mark: '#2980B9', // blue — marks, paths, notes
  privacy_obfusc:   '#8E44AD', // purple — mixers, privacy chains, obfuscation
  context_only:     '#7F8C8D',  // gray — reference, low confidence
  
  // Path palette (curated, semantic-aware)
  path_cool_1:      '#3498DB',  // blue — investigator-built primary
  path_cool_2:      '#1ABC9C',  // teal — investigator-built secondary
  path_cool_3:      '#9B59B6',  // purple — investigator-built tertiary
  path_warm_1:      '#E74C3C',  // red — adversarial/AI-promoted
  path_warm_2:      '#E67E22',  // orange — adversarial/AI-promoted secondary
  path_accent_gold: '#F1C40F',  // gold — case primary evidentiary path (1 per case)
  path_accent_lime: '#2ECC71',  // lime — reserved accent
  path_neutral:     '#95A5A6',  // gray — archived/reference paths
} as const;
```

Investigators never see hex values. They see named swatches. The system enforces that only one path per case can wear `path_accent_gold` (enforced in the TracePath mutation — setting `is_primary=true` on a new path unsets it on any existing primary path).

### 3.5 LOD (Level-of-Detail) zoom transitions

```
Zoom level   What renders                   Sigma camera range
──────────────────────────────────────────────────────────────
Far out      Clusters only, critical marks   ratio < 0.3
             Edge direction arrows only
             
Medium out   Individual addresses visible   0.3 ≤ ratio < 1.0
             TX nodes visible
             Edge thickness visible
             Entity type icons
             
Medium in    Percentage labels on edges     1.0 ≤ ratio < 2.5
             Memo badges visible
             Attribution chips
             Fiat values visible
             
Close        All edge annotations           2.5 ≤ ratio < 6.0
             Full address text
             UTXO input/output chips
             Internal call sub-nodes
             
Microscope   Single TX expanded             ratio ≥ 6.0
             Full calldata decode preview
             Internal call tree
             All badge details
```

The LOD is implemented as a Sigma camera state change subscription. When `sigma.getCamera().ratio` crosses a threshold, a Zustand action triggers graph attribute updates (hiding/showing labels, resizing nodes, toggling edge label visibility). No re-fetch occurs — all data is loaded; display is filtered.

### 3.6 Selection state machine

```
                    ┌─────────────────────────────────────────────────────┐
              IDLE  │  Click canvas          → single-select node/edge   │
                    │  Drag canvas           → pan                        │
                    │  Scroll               → zoom                        │
                    │  Press P              → enter PATH_CLICK mode       │
                    │  Press lasso icon     → enter LASSO mode            │
                    │  Press NL icon        → enter NL_INPUT mode         │
                    └─────────────────────────────────────────────────────┘
                         ▲
                      Esc│
                         │
                    ┌────┴────────────────────────────────────────────────┐
          PATH_CLICK │  Click node           → add to path steps          │
                    │  Shift+click          → extend / branch            │
                    │  Alt+click            → remove last hop             │
                    │  Enter                → confirm path                │
                    └─────────────────────────────────────────────────────┘
                    
                    ┌─────────────────────────────────────────────────────┐
               LASSO │  Drag to draw region  → capture enclosed nodes     │
                    │  Release              → show "path or sub-paths?"  │
                    └─────────────────────────────────────────────────────┘
                    
                    ┌─────────────────────────────────────────────────────┐
          NL_INPUT   │  Text input           → NL query modal             │
                    │  Submit               → backend proposes candidates │
                    │  Click candidate      → promote to active path      │
                    └─────────────────────────────────────────────────────┘
```

The state machine lives in Zustand (`selectionMode` field). Keyboard shortcuts and toolbar buttons dispatch actions. The Sigma event listener is registered once and reads `selectionMode` from the store to route click events appropriately.

### 3.7 Performance at 10k+ nodes

Sigma.js v3 renders in WebGL, which handles 10k+ nodes without issue at the rendering layer. The bottleneck is graph data management in graphology. Strategies:

**Viewport culling:** Only nodes within the camera viewport (+ 20% padding) are rendered. Off-screen nodes exist in the graphology graph but have `hidden: true`. The camera change handler updates visibility in batches using `requestAnimationFrame`.

**Progressive loading:** The graph does not load all data at once. The initial load fetches nodes within 5 hops of the case's seed IOCs. Expanding a node (`E` key or double-click) fires a targeted fetch for that node's neighborhood. This is the "on-demand expansion" pattern — the investigator controls graph growth.

**LOD clustering:** At `ratio < 0.3`, individual nodes are collapsed into cluster representations. This means an investigation with 5000 nodes renders as ~50 clusters far out. The graphology graph still contains all nodes; only the rendering representation changes.

**Edge label batching:** Edge labels (percentage, amount, fiat) are rendered as WebGL text sprites via a custom program, not as HTML overlays. This keeps all annotation rendering on the GPU thread.

**Sigma graph updates:** When new data arrives (from a trace expansion or refresh), the graph is updated imperatively via `sigma.graph.mergeNode` and `sigma.graph.mergeEdge`. React never re-renders the canvas container for graph mutations — only the overlay components (inspector popup, path toolbar) are React-managed.

---

## Section 4 — The Transaction Inspector Popup

### 4.1 Component architecture

```
<InspectorContainer>                   // Zustand: openInspectors[]
  <InspectorPanel txId={id}           // one per open inspector
    position={draggablePosition}
    pinned={isPinned}>
    
    <InspectorHeader>                  // tx hash, chain, timestamp, status chip
    
    <InspectorBody>
      <StreamingSection               // fills as analysis streams in
        sectionId="summary"
        skeleton={<SummarySkeleton>}> // shown while section is loading
        <PlainLanguageSummary>
      
      <StreamingSection sectionId="facts">
        <StructuredFactsTable>
      
      <StreamingSection sectionId="decoded">
        <DecodedActionPanel>           // swap, UTXO, bridge, contract call variants
      
      <StreamingSection sectionId="counterparties">
        <CounterpartyGrid>             // per-address attribution rows
      
      <StreamingSection sectionId="context">
        <CaseContextList>              // path membership, taint %, related memos
      
      <StreamingSection sectionId="obfuscation">
        <ObfuscationFindings>          // 🪤 findings or ✅ clean
      
      <StreamingSection sectionId="critic">
        <CriticNotes>                  // 🧐 notes or ✅ no challenges
      
      <StreamingSection sectionId="actions">
        <SuggestedActionsPanel>        // one-click next steps
    
    <InspectorFooter>                  // save / export / collapse buttons
```

### 4.2 Streaming UI implementation

The analysis endpoint returns a Server-Sent Event (SSE) stream. Each event carries a `{ section: string, delta: string, complete: boolean }` payload. The `<StreamingSection>` component manages its own loading/streaming/complete state:

```typescript
function StreamingSection({ sectionId, skeleton, children }) {
  const { sectionStates } = useInspectorStore();
  const state = sectionStates[sectionId]; // 'loading' | 'streaming' | 'complete'
  
  if (state === 'loading') return skeleton;
  if (state === 'streaming') return (
    <div className="animate-pulse-subtle">{children}</div>
  );
  return children;
}
```

The investigator sees Section 1 (summary) populate first, usually within 1–2 seconds. Sections 6 and 7 (obfuscation, critic) may take 6–8 seconds. The investigator can start acting on Section 8 (suggested actions) before the analysis is complete because sections are independent.

### 4.3 Draggable, pin-able, multiple open

Dragging is handled by `@dnd-kit/core` (already a shadcn/ui dependency). The inspector has a drag handle in its header bar. Position is stored in Zustand (`openInspectors[n].position`) and survives tab navigation within the same browser session.

**Pin mode:** When pinned, the inspector docks to the right edge of the canvas and resizes with it. Unpinned inspectors are floating. The toggle is a thumbtack icon in the header.

**Multiple inspectors:** The `openInspectors` array in Zustand holds up to 4 simultaneously open inspectors (a design-enforced limit to prevent screen overflow). Opening a 5th closes the oldest unpinned one. This enables the shift-click "compare two transactions" mode naturally: open inspector A (pin), shift-click transaction B (opens inspector B beside it), compare side-by-side.

**Compare mode:** When exactly two inspectors are open with both pinned, a `<CompareMode>` component activates that aligns matching sections horizontally with a divider, making diffing easy.

### 4.4 Keyboard shortcuts

| Key | Action |
|---|---|
| `Enter` | Open inspector for currently selected transaction |
| `Esc` | Close active (most recently focused) inspector |
| `Tab` | Navigate between inspector sections |
| `Ctrl+S` | Save current inspection to case |
| `Ctrl+E` | Export as PDF exhibit |
| `Ctrl+P` | Add to active path from inspector |

---

## Section 5 — PSR (Path Selection → Report) Flows

### 5.1 The path toolbar

A floating toolbar docked to the canvas left edge, always visible, with four mode buttons:

```
┌───────────────┐
│  ┌──┐         │
│  │ ↗│ Click   │  ← keyboard: P
│  └──┘         │
│  ┌──┐         │
│  │⬡ │ Lasso   │  ← keyboard: L (while in path mode)
│  └──┘         │
│  ┌──┐         │
│  │⇄ │ Auto    │  ← A→B pathfind
│  └──┘         │
│  ┌──┐         │
│  │💬│ NL      │  ← natural language
│  └──┘         │
└───────────────┘
```

When a path is active, a path info strip appears at the canvas top:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ● Path A — Victim → Binance   [3 hops] [$423.7K]  [Rename] [Color]│
│  [Add hop] [Branch] [Auto-complete to X]  [Cancel]  [Save path]     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Click-select mode

The investigator presses `P` (or clicks the click-mode button). Sigma's event listener routes to path-building mode. Clicking a node adds it as the next step. The canvas renders an animated bright overlay along the building path.

The underlying algorithm: each new step triggers a backend call to `pathfinder.shortest(from: prevStep, to: clickedNode, maxHops: 10)`. If no path exists within 10 hops, the UI shows a "No direct path found — create manual hop?" prompt. The direct path animates onto the canvas immediately; the shortest-path computation suggests a more efficient route if one exists.

### 5.3 Lasso mode

The investigator draws a freeform region. On release, all nodes inside the lasso are collected. A modal presents:

```
┌─────────────────────────────────────────────────────────┐
│  You selected 23 nodes.                                  │
│                                                          │
│  ○ Treat as a single path (order nodes by time)         │
│  ● Detect sub-paths (let AI find coherent routes)       │
│                                                          │
│  Sub-paths found: 3 candidates  [Preview each]          │
│                                                          │
│  [Cancel]                           [Add selected paths] │
└─────────────────────────────────────────────────────────┘
```

Sub-path detection uses the `pathfinder` backend service (constrained k-shortest-paths on the case subgraph). Candidate paths are previewed as colored overlays the investigator can accept or reject one by one.

### 5.4 Auto-pathfind (A→B)

The investigator selects a start node and an end node, then clicks "Auto." The pathfinder enumerates all paths up to a depth/branching cap (configurable; default depth 20, branching cap 50). Results return as a ranked list:

```
┌─────────────────────────────────────────────────────────────────────┐
│  7 paths found from Wallet A → Binance deposit                       │
├─────────────────────────────────────────────────────────────────────┤
│  ★ Path A (recommended) — 14 hops, $423.7K, 87.3% taint (FIFO)    │
│  Path B — 18 hops, $423.5K, 85.1% taint (via mixer boundary)       │
│  Path C — 12 hops, $421.2K, 84.8% taint (shorter but lower conf)   │
│  [+4 more]                                                           │
│                                                                      │
│  [Add all]  [Add top 3]  [Add selected]                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.5 Natural-language mode

A small NL input appears above the canvas:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Find paths where:  [stablecoins were bridged to Tron before deposit]│
│                                                                      │
│  [Clear]                                          [Search ↵]        │
└─────────────────────────────────────────────────────────────────────┘
```

The input feeds the NL-to-graph-query model. Candidate paths appear in a sidebar drawer as hoverable previews. The Critic Agent reviews every AI-proposed path before it can be promoted. Promoted paths land in the path list as `status: draft` (not `under_review` or `finalized`).

### 5.6 Path styling UI

After creating a path:

```
┌────────────────────────────────────────────┐
│  Name:  [ Path A — Victim → Binance      ] │
│                                             │
│  Color: ● ● ● ● ● ○ ○ ○                   │
│         [cool blues]  [warm]  [accent]     │
│         ↑ selected                         │
│                                             │
│  Style: [Ring ●] [Glow] [Dashed] [Bold]   │
│                                             │
│  Label: [center] [start] [terminus] [cam] │
│                                             │
│  [Set as primary (gold)]   [Cancel] [Save] │
└────────────────────────────────────────────┘
```

The color picker is a curated swatch grid (no free picker). "Suggest next color" automatically selects the least-used color in the current case's active palette.

### 5.7 Multi-path layered rings

When a node participates in multiple paths:

```
         Path A (blue outer ring)
        ╭──────────────────╮
       ╭──────────────────╮╯
      │  AddressNode       │
      │    ╭──────╮        │
      │    │  🏦  │        │
      │    ╰──────╯        │
       ╰──────────────────╯
        ╰──────────────────╯  Path B (teal inner ring)
```

The rings are drawn by a custom Sigma WebGL program (`PathRingProgram`) that takes an array of `{ color, order }` and renders them as concentric semi-transparent circles outside the node border. Maximum 6 path rings per node before falling back to a `+N paths` badge.

---

## Section 6 — Investigator Markup System

### 6.1 Keyboard shortcut handler

A single global `useEffect` in `<CanvasRoot>` registers a `keydown` listener. The handler is a switch statement that dispatches Zustand actions based on the selected entities and the current mode.

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Don't fire when typing in an input/textarea
    if (e.target instanceof HTMLInputElement) return;
    
    const { selectedNodeIds, selectedEdgeIds } = canvasStore.getState();
    const targets = [...selectedNodeIds, ...selectedEdgeIds];
    
    switch(e.key.toUpperCase()) {
      case 'I': openImportantModal(targets); break;
      case 'M': openMemoModal(targets); break;
      case 'T': openTagModal(targets); break;
      case 'P': enterPathClickMode(); break;
      case 'E': expandNeighborhood(targets); break;
      case 'H': hideFromView(targets); break;
      case 'F': focusCameraOnTargets(targets); break;
      case ' ': toggleMoneyFlowOverlay(); e.preventDefault(); break;
      case '?': openShortcutHelp(); break;
      case 'ENTER': {
        if (selectionContainsSingleTx(selectedNodeIds)) {
          openInspector(firstTx(selectedNodeIds));
        }
        break;
      }
      // 1-9: preset filters
      default: {
        if (e.key >= '1' && e.key <= '9') applyPresetFilter(+e.key);
      }
    }
  };
  
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### 6.2 Mark as Important modal

```
┌──────────────────────────────────────────────────────────┐
│  Mark as Important                                   [X] │
├──────────────────────────────────────────────────────────┤
│  Target: Transaction 0xabc...d4e3                        │
│                                                          │
│  Importance:                                             │
│  ○ 🔴 Critical    ● 🟠 High    ○ 🟡 Normal    ○ ⚪ Ref  │
│                                                          │
│  Rationale (why does this matter?):                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ This is the pivot tx where funds split to mixer     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Case role: [Evidence ▼]                                │
│                                                          │
│  Tags: [obfuscation-pattern] [mixer] [+ add tag]       │
│                                                          │
│  Visible to: [Case team ▼]                              │
│                                                          │
│                                       [Cancel] [Mark ⭐] │
└──────────────────────────────────────────────────────────┘
```

This is a shadcn/ui `Dialog` with a `Textarea`, `RadioGroup` (importance level), `Select` (case role, visibility), and a custom `TagInput` component. On submit, an optimistic update adds the glow ring to the canvas node immediately.

### 6.3 Important sidebar

The Important sidebar docks to the right edge of the canvas. It is a `Sheet` (shadcn/ui) with `side="right"` that opens when the investigator clicks the star icon in the top bar or presses `I` without a selection.

```
┌───────────────────────────────────────┐
│  ⭐ Important (24 marks)        [×]   │
├───────────────────────────────────────┤
│  [Filter: All ▼] [Tags ▼] [Author ▼] │
├───────────────────────────────────────┤
│  CRITICAL (2)                         │
│  ─────────────────────────────────   │
│  🔴 Tx 0xabc...  [go to]             │
│     Pivot to mixer — 73.4% value     │
│     Tagged: #obfuscation-pattern     │
│                                       │
│  🔴 Addr 0xdef... [go to]            │
│     Suspect Binance deposit          │
│     Sub: 2024-0184 ✅                │
├───────────────────────────────────────┤
│  HIGH (8) ▼                          │
│  NORMAL (12) ▼                       │
│  REFERENCE (2) ▼                     │
├───────────────────────────────────────┤
│  [↕ Reorder for report narrative]    │
│  [Generate report from marks →]      │
└───────────────────────────────────────┘
```

The "Generate report from marks" button triggers the PSR flow with the marked entities as the path scope. The reorder area uses `@dnd-kit/sortable`.

### 6.4 Memo system

`M` on a selected entity opens a `Sheet` (side drawer, not modal — the investigator can keep it open while exploring).

```
┌──────────────────────────────────────────┐
│  📝 Memo — Transaction 0xabc...     [×] │
├──────────────────────────────────────────┤
│  ┌────────────────────────────────────┐  │
│  │ Markdown editor (Tiptap or        │  │
│  │ @uiw/react-md-editor)             │  │
│  │                                   │  │
│  │ Subpoena #2024-0184 confirmed     │  │
│  │ this is John Doe — see attached  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Attachments:  [📎 attachment_1.pdf]    │
│  [+ Attach file]                        │
│                                          │
│  External links: [+ Add link]           │
│                                          │
│  Cross-refs: [+ Link to case entity]    │
│                                          │
│  Tags: [subpoena] [kyc-confirmed]       │
│                                          │
│  Pin to canvas: [□]                     │
│  Visible to: [Case team ▼]             │
│                                          │
│  [Template: Subpoena Return ▼]          │
│                                          │
│                     [Cancel] [Save 💾]  │
└──────────────────────────────────────────┘
```

### 6.5 Iconography rendering

Icons are SVG sprites rendered as Sigma node images via `NodeImageProgram`. The icon library ships as a single SVG sprite sheet (all entity-type + activity-type + investigator-applied icons). Badge stacking is implemented as a small cluster of miniature icon images arranged around the node at fixed positions (entity-type center, activity-type top-right, investigator-applied bottom-right, severity top-left).

---

## Section 7 — Value-Split / Flow Indicator

### 7.1 Edge annotation rendering

The `PercentageLabelProgram` is a custom Sigma WebGL text program that renders three lines of text per edge, visible at close zoom:

```
Line 1 (white, bold):       73.4%
Line 2 (light gray):        0.734 BTC
Line 3 (muted, small):      ~$47,210
```

These values come from `EdgeValueAnnotation` records pre-fetched with the graph data. The component never computes them; it only renders them.

For UTXO input sides, the same annotation appears on the address-to-tx edge with a label prefix of "in:" to distinguish input contributions from output distributions.

### 7.2 The "Where did the money go?" overlay

Toggle mechanism:
- `Space` key or the overlay toggle button in the top bar
- Zustand: `moneyFlowOverlayActive` + `activeMethodology`

When active, the Sigma renderer swaps to `OverlayEdgeProgram` which reads `cumulative_share_from_source[activeMethodology]` for each edge and maps it to a color:

```typescript
function taintToColor(share: number): string {
  if (share >= 0.8) return SemanticColors.taint_critical;  // red
  if (share >= 0.5) return SemanticColors.taint_high;      // orange  
  if (share >= 0.2) return SemanticColors.taint_medium;    // yellow
  if (share >= 0.01) return SemanticColors.taint_low;      // green
  return SemanticColors.context_only;                       // gray (near-dead end)
}
```

### 7.3 Real-time methodology switching

The methodology selector is in the top bar, always visible when the overlay is active:

```
🔄 Overlay on   [ FIFO ▼ ]   LIFO  LIBR  Pari Passu  Rolling
```

Clicking a methodology fires:
```typescript
setMethodology(method); // Zustand action — instant
// Sigma re-reads EdgeValueAnnotation[method] for every visible edge
// No network call. All six methodology values were pre-computed by Math Service.
```

The re-color happens synchronously in the next animation frame. From the investigator's perspective: instant. The entire graph re-colors in ~16ms.

---

## Section 8 — Court Mode

### 8.1 Entering and exiting

Court Mode at `/cases/[caseId]/court` is a distinct route. The browser fullscreens via the Fullscreen API on route load. The shell layout renders nothing in this route — just the Court Mode shell:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ChainSight Court Mode  ●  Case: Operation Bluebird                  │
│  [A: Timeline] [B: Sankey] [C: Path playback] [D: Entity]   [Exit]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                      PRIMARY CANVAS AREA                             │
│                  (full-width, full-height)                           │
│                                                                      │
│                                                                      │
│                                                                      │
│                                                                      │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  [← Prev] Path A — hop 7 of 14 — 2024-08-12 14:33 UTC  [Next →]   │
└─────────────────────────────────────────────────────────────────────┘
```

All AI background activity is suppressed via a `courtModeActive: true` flag in Zustand. React Query's refetch behavior is suspended. Network calls: disabled (Court Mode renders from the frozen Reproducibility Pack state loaded into memory on route entry).

### 8.2 The four views as React components

Each view is a named component rendered conditionally in the canvas area:

```typescript
function CourtModeCanvas({ activeView, frame }) {
  switch (activeView) {
    case 'A': return <TimelineView frame={frame} />;
    case 'B': return <SankeyView frame={frame} />;   // D3 Sankey
    case 'C': return <PathPlaybackView frame={frame} />;  // Sigma canvas, step-by-step
    case 'D': return <EntityView frame={frame} />;
  }
}
```

**View A (Timeline):** Recharts `AreaChart` with a scrubber. Time axis is the horizontal axis. Value axis shows cumulative taint. The Sigma canvas below the timeline renders the subgraph state as of the playhead time.

**View B (Sankey):** D3 Sankey diagram. Source value enters from the left. Terminal destinations (exchanges, mixers, unattributed) on the right. Width = value. Color = taint under active methodology. Methodology toggle re-renders the Sankey via D3's update pattern (no React re-mount; just data update).

**View C (Path playback):** The Sigma canvas in step-advance mode. Each advance calls `sigma.getCamera().animate()` to move focus to the next node. The path overlay is highlighted. `←` / `→` / `Space` advance/retreat frames.

**View D (Entity view):** A centered entity card with all attributions, all memos, all linked documents, and all transactions involving the entity rendered in a timeline panel below. Useful for cross-examination context.

### 8.3 Accounting-follows-the-frame panel

A fixed panel, typically the right 280px of the court display or a second monitor:

```typescript
function AccountingPanel({ currentFrame }: { currentFrame: CourtFrame }) {
  const accounting = useMemo(() => 
    computeFrameAccounting(currentFrame, caseBaseline),
    [currentFrame]
  );
  
  return (
    <div className="court-accounting-panel">
      <AccountingBlock title="CURRENT FRAME" data={accounting.frame} />
      <AccountingBlock title="VALUE AT THIS HOP" data={accounting.hop} />
      <AccountingBlock title="CASE-LEVEL CONTEXT" data={accounting.case} />
      <AccountingBlock title="NEXT FRAME" data={accounting.next} />
    </div>
  );
}
```

`computeFrameAccounting` is a pure function that takes the current frame and the case-level Math Service output (pre-loaded into memory). No async calls.

### 8.4 Hot keys

| Key | Action |
|---|---|
| `←` / `→` | Previous / next frame |
| `Space` | Next frame (clicker-friendly) |
| `A`, `B`, `C`, `D` | Switch view |
| `M` | Cycle methodology |
| `J {address}` | Jump to entity in View D |
| `C` | Show Critic challenges for current frame |
| `D` | Show linked source document |
| `R` | Highlight "read aloud" next claim |
| `Esc Esc` | Return to opening frame |

### 8.5 Court Export Bundle

The export is triggered by "Export court bundle" button on the Court Mode page. It packages:
1. A snapshot of the React app (static Next.js export of just the court-viewer route)
2. The Reproducibility Pack at its current frozen state
3. A `manifest.json` describing all frames in the presentation
4. The `replay.sh` script

The result is a `.zip` file. The frozen Reproducibility Pack is what makes it self-contained — no network calls required to play it back in the standalone court viewer.

---

## Section 9 — API Key Entry Flow

### 9.1 Onboarding trigger

First-time users are redirected to `/onboarding` after Supabase Auth sign-in. The onboarding wizard has a single key step: add your first provider. This uses the same modal as the ongoing provider management, but with a "welcome" wrapper.

Returning admins reach the same flow via Marketplace → "Add provider" button.

### 9.2 Single-key modal (shadcn/ui Dialog)

```typescript
function SingleKeyModal({ provider, onClose }) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [validationState, setValidationState] = useState<'idle'|'validating'|'ok'|'error'>();
  
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add provider — {provider.display_name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <Label>{provider.display_name} API key</Label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              placeholder="paste your key here"
              value={key}
              onChange={e => setKey(e.target.value)}
              autoFocus
            />
            <Button variant="ghost" size="icon" className="absolute right-2 top-2"
              onClick={() => setShowKey(!showKey)}>
              {showKey ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          
          {provider.signup_url && (
            <Link href={provider.signup_url} target="_blank" className="text-sm text-muted">
              Don't have one yet? → Get an {provider.display_name} key
            </Link>
          )}
          
          {validationState === 'error' && <ValidationError message={validationError} />}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => validateAndSave(key)} disabled={!key}>
            {validationState === 'validating' ? <Spinner /> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 9.3 Bulk paste mode

The bulk textarea uses a custom parser that fires as the user types (debounced 300ms):

```typescript
function parseDotEnvBlock(text: string): ParsedKey[] {
  return text
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=').trim();
      const provider = resolveProvider(key.trim()); // fuzzy match against registry
      return { envKey: key.trim(), value, provider, status: 'pending' };
    })
    .filter(({ value }) => !!value);
}
```

After "Detect & Save" is clicked, all keys are validated in parallel via `Promise.allSettled()`. The results table updates in real-time as each validation completes.

### 9.4 .env file drop

A `<DropZone>` wraps the bulk-paste textarea. On file drop:

```typescript
const onDrop = useCallback((files: File[]) => {
  const envFile = files.find(f => f.name.endsWith('.env') || f.name === '.env');
  if (!envFile) { showError('Please drop a .env file'); return; }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    setBulkText(text); // populates the textarea
    // File content is never persisted; only the textarea state is held in memory
  };
  reader.readAsText(envFile);
}, []);
```

### 9.5 Provider auto-detection

The registry mapping (env var name → provider) is a flat JSON file shipped with the frontend bundle (`packages/shared-types/src/provider-env-map.json`). It includes all the pairs from the v0.4 API key addendum plus fuzzy-match patterns. New aliases the admin uses are sent back to the server as a `mapProviderAlias` mutation.

---

## Section 10 — The Provider Marketplace UI

### 10.1 Catalog view

Route: `/marketplace`

```
┌─────────────────────────────────────────────────────────────────────┐
│  Provider Marketplace         [Bulk add keys] [Add individual key]  │
├──────────────┬──────────────────────────────────────────────────────┤
│  CATEGORIES  │                                                       │
│  ─────────   │  Filter: [All ▼]  [Installed ▼]  [Search...]        │
│  All (42)    │  ─────────────────────────────────────────────────── │
│  Chain data  │  ┌──────────────────┐  ┌──────────────────┐         │
│  Attribution │  │ 🏢 Chainalysis   │  │ 🏢 TRM Labs      │         │
│  Market data │  │ Attribution      │  │ Attribution      │         │
│  LLMs        │  │ 11 capabilities  │  │ 8 capabilities   │         │
│  Documents   │  │ ✅ Installed      │  │ [Add key]        │         │
│  Storage     │  └──────────────────┘  └──────────────────┘         │
│  Bridges     │  ...                                                  │
│  Exchanges   │                                                       │
└──────────────┴──────────────────────────────────────────────────────┘
```

Each provider card is a shadcn/ui `Card` with the provider logo, category, capability count, and installation status. Clicking opens the single-key modal. Installed providers show a green ✅ and a "Manage" link.

### 10.2 Coverage matrix

A toggle switches between card view and matrix view. The matrix is a two-dimensional table: capabilities × providers, with colored cells indicating coverage.

```
Capability          | Etherscan | Blockchair | Alchemy | Chainalysis | TRM  |
─────────────────────────────────────────────────────────────────────────────
get_tx_by_hash      |    ✅     |    ✅      |   ✅    |      ✅     |  ✅  |
get_addr_history    |    ✅     |    ✅      |   ✅    |      -      |  -   |
get_entity_attr     |    -      |    -       |   -     |      ✅     |  ✅  |
get_balance         |    ✅     |    ✅      |   ✅    |      -      |  -   |
...
```

Green cells = installed and active. Blue cells = provider offers capability but key not yet added. Gray = provider doesn't offer. Cells show routing priority (a number badge indicating which provider is selected first for this capability).

### 10.3 Cost telemetry view

Route: `/marketplace/installed`

The cost telemetry panel (from v0.6 F9.8) uses Recharts `BarChart` for monthly spend by provider and a `LineChart` for cache hit rate over time. Raw numbers are shown in a table below the charts. The "by case" breakdown is a sortable `DataTable` (shadcn/ui Table).

### 10.4 Model configuration matrix (v0.9)

Route: `/marketplace/models`

```
                  │ Claude Opus 4.6 │ GPT-5.4 │ Gemini 3.1 │ Phi-4 (self) │
──────────────────┼─────────────────┼──────────┼────────────┼──────────────┤
Orchestrator      │      ● (active) │    ○     │     ○      │      ○       │
Tracer Agent      │      ○          │    ○     │     ●      │      ○       │
Narrative Agent   │      ● (active) │    ○     │     ○      │      ○       │
Verifier Agent    │      ○          │    ●     │     ○      │      ○       │
Critic Agent      │      ● (active) │    ○     │     ○      │      ○       │
Suggestion Agent  │      ○          │    ○     │     ○      │      ● SLM   │
NL Pathfinder     │      ○          │    ○     │     ○      │      ● SLM   │
```

Each cell is a radio button. The active model per role is highlighted. The admin can reassign any role to any installed model. Changes save immediately (no "save all"). This is a plain React table with controlled radio groups, backed by a tRPC mutation that updates `LLMProviderInstall.model_assignments_json`.

---

## Section 11 — Supervisor Dashboard

### 11.1 Route and access control

Route: `/supervisor`

Access gated by `SupervisoryRole` in the session. Non-supervisors see a 403 page. Supervisors see the full dashboard. The route is not listed in the main sidebar nav for non-supervisors.

### 11.2 Cases overview (span of control)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Supervisor Dashboard              5 open cases, 1 awaiting review  │
├──────────────┬──────────────────────────────────────────────────────┤
│  MY TEAM     │  Sort: [Risk ▼]  Filter: [All investigators ▼]      │
│  ─────────   │  ─────────────────────────────────────────────────── │
│  J. Doe  (4) │  ┌───────────────────────────────────────────────┐  │
│  S. Park (2) │  │ 🔴 Operation Bluebird   J. Doe   SLA: 2 days  │  │
│  M. Chen (1) │  │    [Freeze opp open] [Report draft pending]   │  │
│              │  │                        [Review checkpoint →]   │  │
│              │  ├────────────────────────────────────────────────┤  │
│              │  │ 🟡 Operation Stardust   S. Park  Active        │  │
│              │  │    [Tracing in progress]          [View →]    │  │
│              │  └───────────────────────────────────────────────┘  │
│              │                                                       │
│  CASELOAD    │  Cross-case alerts: 2 deconfliction overlaps        │
│  ─────────   │  [Review cross-case patterns]                       │
│  J. Doe  ████│                                                       │
│  S. Park ██  │                                                       │
│  M. Chen █   │                                                       │
└──────────────┴──────────────────────────────────────────────────────┘
```

The caseload bar chart uses Recharts `BarChart` with horizontal bars. Risk-tier indicators are colored dots matching the semantic palette.

### 11.3 Review sidebar

When the supervisor clicks "Review checkpoint →", a non-destructive review sidebar opens as a `Sheet`:

```
┌──────────────────────────────────────────────────────────┐
│  Review — Operation Bluebird — Report Draft         [×]  │
├──────────────────────────────────────────────────────────┤
│  [Comment on this belief atom / mark / path / sentence]  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │ Per section 3, hop 7's taint is cited as 87.3%   │   │
│  │ but the Math Service shows 87.1% under the case  │   │
│  │ methodology. Verify before finalizing.           │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  Thread: J. Doe → [Acknowledged, fixing now]            │
│                                                          │
│                  [Send back] [Escalate] [Approve →]     │
└──────────────────────────────────────────────────────────┘
```

Supervisor comments are stored in a `ReviewerComment` table with `visible_to: [line_investigator, supervisor]` only. They do not pollute the case's belief atoms or audit log with opinion content — only the checkpoint decision (approve/send_back/escalate) is logged as an audit event.

---

## Section 12 — Wallet History Analyzer UI

### 12.1 Wallet creation flow

Route: `/cases/[caseId]/wallets`

```
┌─────────────────────────────────────────────────────────┐
│  Add wallet                                        [×]  │
├─────────────────────────────────────────────────────────┤
│  Name: [ Suspect's Ledger Nano — seized 2026-04-12  ]   │
│                                                          │
│  Source: [ Forensic seizure ▼ ]                         │
│                                                          │
│  Paste addresses (one per line, or CSV):                │
│  ┌─────────────────────────────────────────────────┐    │
│  │ bc1q...8a2                                      │    │
│  │ bc1q...d3f                                      │    │
│  │ 0xabc...d4e3                                    │    │
│  │ ...                                             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  OR drag a file: [📂 Drop CSV / JSON / .txt here]       │
│                                                          │
│  OR paste a seed phrase:                                │
│  [⚠️ Seed phrase mode — in-memory only, never stored]  │
│  [Hide seed phrase entry unless explicitly requested]   │
│                                                          │
│  Chain detection:  [Auto ✅] Detected: BTC (2), ETH (1) │
│                                                          │
│  Analysis config: [Default ●] [Custom ○]               │
│                                                          │
│                                      [Cancel] [Save →]  │
└─────────────────────────────────────────────────────────┘
```

The seed phrase input is hidden behind an explicit "Use seed phrase" toggle with a warning banner. It uses a `<textarea>` that clears on `blur` via `onBlur={() => setSeed('')}` — an additional defense-in-depth layer.

### 12.2 Progress indicator during analysis

After "Analyze" is clicked, the wallet page transitions to an analysis-in-progress view:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Analyzing: Suspect's Ledger Nano                                    │
│                                                                      │
│  Overall: ████████████████░░░░░░░░░  68%  ~4 min remaining         │
│                                                                      │
│  bc1q...8a2   ✅ Complete — 14 txs, 3 counterparties found          │
│  bc1q...d3f   🔄 Tracing (hop 3/5)...                               │
│  0xabc...d4e3  ✅ Complete — 847 txs, Binance deposit detected      │
│  bc1q...9e4   ⏳ Queued                                              │
│  ...                                                                 │
│                                                                      │
│  Completed addresses stream onto canvas as they finish.             │
│  [Go to canvas]                             [Cancel analysis]       │
└─────────────────────────────────────────────────────────────────────┘
```

Each address row is a live-updating React component backed by a React Query subscription to the address's analysis status. Completed addresses are immediately interactive on the canvas (their sub-graph is added to the Sigma graph incrementally).

### 12.3 Results display

After completion, the wallet page shows the `WalletAnalysisSummary`:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Suspect's Ledger Nano                    3 addresses, 2 chains      │
│  Source: Forensic seizure — 2026-04-12                              │
├──────────────────────────────────────────────────────────────────────┤
│  Total inflow:  2.347 BTC + 847 USDT ≈ $163,420   (2020 → 2026)   │
│  Total outflow: 2.340 BTC + 840 USDT ≈ $162,840                    │
│  Current balance: $580 (near-zero)                                  │
├──────────────────────────────────────────────────────────────────────┤
│  ⚠️ 2 addresses flagged for priority review                          │
│  Top counterparties: Binance (2), Tornado Cash (1)                  │
│  Obfuscation: 🪤 Peel chain detected (confidence 0.91)              │
├──────────────────────────────────────────────────────────────────────┤
│  [View on canvas] [Generate wallet report] [Refresh analysis]       │
└─────────────────────────────────────────────────────────────────────┘

Flagged addresses (priority review):
1. bc1q...8a2  — Mixer-adjacent (Tornado Cash input). High risk. [Inspect]
2. 0xabc...d4e3 — Binance deposit, 847 USDT. Subpoena opportunity. [Inspect]
```

---

## Section 13 — Document Ingest UI

### 13.1 Drop targets

The document system has two drop targets:

**Documents tab drop zone:** When the investigator is on the Documents tab, the entire tab area is a `<DropZone>`. Dropping a PDF/image/DOCX immediately starts the ingest flow.

**Canvas drag-to-node:** The investigator can drag a file from their desktop onto a specific canvas node. Sigma fires a `drop` event on the node. The file is attached as a document linked to that entity. A `📎` badge appears on the node within 500ms (optimistic update).

### 13.2 Ingest progress

After dropping a document, a progress drawer slides up from the bottom:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Processing: subpoena_return_2024-0184.pdf           [dismiss]       │
│                                                                      │
│  ✅ Uploaded and encrypted                                           │
│  🔄 OCR + layout analysis...                                         │
│  ⏳ Entity extraction                                                │
│  ⏳ Reviewer queue                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.3 Side-by-side reviewer

The extracted entities review UI is the most complex document UI surface. It uses a two-panel layout:

```
┌──────────────────────────────┬──────────────────────────────────────┐
│  Document Viewer             │  Extracted Entities                  │
│  ─────────────────────────  │  ─────────────────────────────────── │
│  [← Page 2/8 →]             │  Filter: [All ▼] [Reviewed: 3/12]   │
│                              │                                       │
│  ┌────────────────────────┐  │  📍 Address: 0xabc...d4e3           │
│  │  [PDF rendered via     │  │     Found on: page 3                │
│  │   react-pdf or iframe] │  │     "Customer deposit address:      │
│  │                        │  │      0xabc...d4e3 (ETH)"           │
│  │  [Highlighted bbox     │  │     Conf: 0.98  [✅ Accept] [✗ Rej] │
│  │   for selected entity] │  │                                       │
│  │                        │  │  👤 Name: John Smith               │
│  └────────────────────────┘  │     Found on: page 1               │
│                              │     "Account holder: John Smith"    │
│                              │     Conf: 0.99  [✅ Accept] [✗ Rej] │
│                              │                                       │
│                              │  💰 Amount: $423,700               │
│                              │     [✅ Accept] [✗ Rej] [✏️ Edit]   │
│                              │                                       │
│                              │  [Accept all remaining]             │
└──────────────────────────────┴──────────────────────────────────────┘
```

Clicking an entity in the right panel highlights the corresponding bounding box in the PDF on the left panel. The PDF viewer uses `react-pdf` with a custom layer for bounding-box overlays.

Each entity has an "Accept" (promotes to BeliefAtom), "Reject" (dismisses with reason), and "Edit" (correct the extracted value) action.

---

## Section 14 — Deconfliction Tab UI

### 14.1 Tab layout

Route: `/cases/[caseId]/deconfliction`

```
┌─────────────────────────────────────────────────────────────────────┐
│  Deconfliction                  [+ Add external investigator]        │
├──────────────────────────────────────────────────────────────────────┤
│  External Contacts (2)          │  Automated Alerts (1 unresolved)  │
│  ───────────────────────────   │  ──────────────────────────────── │
│  FBI — Agent Johnson            │  🚨 OVERLAP DETECTED              │
│  Contact: 2026-06-01            │     Case "Operation Stardust"     │
│  Shared: address overlap        │     shares address bc1q...8a2     │
│  [View] [Edit]                  │     Lead: S. Park                 │
│                                  │     [Acknowledge] [Contact]      │
│  USSS — Det. Williams           │     [Escalate] [Resolve]          │
│  Contact: 2026-05-18            │                                   │
│  Status: Active                 │  ✅ Operation Mockingbird — addr  │
│  [View] [Edit]                  │     overlap resolved 2026-06-03   │
└─────────────────────────────────┴───────────────────────────────────┘

Coordination Timeline:
─────────────────────────────────────────────────────────────────────
2026-06-01  📞 Phone call with FBI Agent Johnson — shared 3 addresses
2026-05-30  🚨 Auto-detected: address bc1q...8a2 in Operation Stardust
2026-05-28  📝 Case opened
```

The "Add external investigator" button opens a `Dialog` with the `ExternalInvestigatorEntry` form.

### 14.2 Auto-detected alert actions

Alert action buttons map to specific backend mutations:
- **Acknowledge:** Sets `alert.status = 'acknowledged'`. No further action.
- **Contact:** Opens a platform message composer (sends structured message to the other case's lead via the platform's internal messaging; the sender controls what data is shared).
- **Escalate:** Sets `alert.status = 'escalated'`, routes to supervisor's review queue (F27).
- **Resolve:** Opens a short "resolution memo" form, then sets `alert.status = 'resolved'`.

---

## Section 15 — Personal Attribution UI

### 15.1 Apply modal

Right-click on any canvas entity → "Add my attribution" → `Dialog` (from Section 6.5's `PersonalAttribution` form design). The modal pre-fills target chain and address from the canvas selection.

### 15.2 Attribution library view

Route: `/attributions`

```
┌─────────────────────────────────────────────────────────────────────┐
│  My Attributions  (147)           [Export] [Import]                 │
├─────────────────────────────────────────────────────────────────────┤
│  Filter: [Chain: All ▼] [Category: All ▼] [Basis: All ▼] [Search] │
│  Sort: [Recent ▼]                                                   │
├──────────────────────────────────────────────────────────────────────┤
│  0xabc...d4e3 (ETH)   Exchange deposit   John Doe's Binance        │
│  Subpoena confirmed · Confidence 4/5 · Private · 2026-06-12        │
│  Used in 3 cases       [Edit] [Share] [View in canvas]             │
├──────────────────────────────────────────────────────────────────────┤
│  bc1q...8a2 (BTC)    Suspect EOA         Seized wallet address      │
│  Forensic seizure · Confidence 5/5 · Shared with team · 2026-04-12 │
│  Used in 2 cases       [Edit] [Share] [View in canvas]             │
└──────────────────────────────────────────────────────────────────────┘
```

This is a shadcn/ui `DataTable` with client-side filtering (the full attribution library loads once; filtering happens in-memory).

### 15.3 Sharing and counter-attribution

The sharing flow is a `Sheet` drawer with the four visibility levels as a `RadioGroup`. When the investigator selects "Share with specific users," a user search input appears (powered by a tRPC query).

Incoming shared attributions arrive as a shadcn/ui `Toast` notification with inline Accept/Reject/Counter buttons. Counter-attribution opens the apply modal with the sender's values pre-filled for the investigator to modify.

---

## Section 16 — Refresh Button + Last-Refresh Badge

### 16.1 Persistent top-bar placement

The refresh control sits in the canvas top bar, right of the breadcrumb:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cases › Operation Bluebird › Canvas        [🔄 4h ago 🟡] [⚙️] [?]│
└─────────────────────────────────────────────────────────────────────┘
```

The badge colors follow the v0.6 spec:
- `bg-green-500` — under 1 hour
- `bg-yellow-500` — 1–24 hours
- `bg-orange-500` — 1–7 days
- `bg-red-500` — over 7 days

### 16.2 Scope dropdown

Clicking the badge opens a `Popover` (shadcn/ui):

```typescript
function RefreshDropdown() {
  const [scope, setScope] = useState<RefreshScope>('case');
  const [dataTypes, setDataTypes] = useState({
    attribution: true,
    token_metadata: true,
    balances: true,
    tx_history: false,
    obfuscation: false,
  });
  
  const { data: estimate } = useQuery({
    queryKey: ['refresh-estimate', scope, dataTypes],
    queryFn: () => trpc.cache.estimateRefreshCost.query({ scope, dataTypes }),
    // Estimate updates in real-time as the user toggles options
  });
  
  return (
    <div className="refresh-dropdown w-72 p-4">
      <h3>What would you like to refresh?</h3>
      
      <RadioGroup value={scope} onValueChange={setScope}>
        <RadioGroupItem value="selection">Selected entities only</RadioGroupItem>
        <RadioGroupItem value="viewport">Visible viewport</RadioGroupItem>
        <RadioGroupItem value="case">All entities in this case</RadioGroupItem>
      </RadioGroup>
      
      <h3>What kind of data?</h3>
      <CheckboxGroup state={dataTypes} onChange={setDataTypes} />
      
      {estimate && (
        <p className="text-sm text-muted mt-2">
          Estimated cost: ~${estimate.dollars.toFixed(2)} · ~{estimate.seconds}s
        </p>
      )}
      
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={close}>Cancel</Button>
        <Button onClick={executeRefresh}>Refresh</Button>
      </div>
    </div>
  );
}
```

### 16.3 Post-refresh highlight

After a refresh completes, changed entities pulse for 5 seconds via a CSS animation applied to their Sigma node attributes:

```typescript
// In the refresh mutation's onSuccess:
const changedNodeIds = result.changed_nodes;
changedNodeIds.forEach(id => {
  sigma.graph.setNodeAttribute(id, 'highlighted', true);
});
setTimeout(() => {
  changedNodeIds.forEach(id => {
    sigma.graph.setNodeAttribute(id, 'highlighted', false);
  });
}, 5000);
```

---

## Section 17 — Accessibility

### 17.1 Keyboard navigation

**Principle:** Every feature reachable by mouse is reachable by keyboard. No exceptions.

The canvas itself is the hardest surface for keyboard accessibility. The approach:

```typescript
// The Sigma canvas element receives a tabIndex and handles keyboard nav
<canvas
  ref={canvasRef}
  tabIndex={0}
  role="application"
  aria-label="Investigation canvas — blockchain transaction graph"
  onKeyDown={handleCanvasKeyDown}
/>

// A keyboard-nav mode that uses Tab to cycle through visible nodes
function handleCanvasKeyDown(e: KeyboardEvent) {
  switch (e.key) {
    case 'Tab': {
      const nodes = sigma.graph.nodes().filter(n => !sigma.graph.getNodeAttribute(n, 'hidden'));
      const currentIdx = nodes.indexOf(focusedNode);
      const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
      setFocusedNode(nodes[nextIdx % nodes.length]);
      sigma.getCamera().animate(sigma.getNodeDisplayData(focusedNode));
      break;
    }
    case 'Enter': openContextMenu(focusedNode); break;
    case 'ArrowLeft'/'ArrowRight'/'ArrowUp'/'ArrowDown': pan(e.key); break;
  }
}
```

A visible focus ring follows the keyboard focus on canvas nodes, implemented as a Sigma custom renderer that draws an accessible ring around the focused node.

### 17.2 Screen reader support

- All data tables (inspector facts, path tables, document extractions) are standard HTML tables with `<caption>`, `<th scope>`, and `aria-sort` attributes.
- The Inspector popup announces section completion: `aria-live="polite"` regions update with "Summary complete," "Counterparties loaded," etc.
- Canvas has an `aria-describedby` that links to a visually hidden text description of the current graph state (number of nodes, active paths, selected entity details).
- Modals use `Dialog` from shadcn/ui which correctly manages `aria-modal="true"` and traps focus.

### 17.3 High-contrast mode

The semantic color palette has a high-contrast variant defined as a CSS class (`class="high-contrast"` on `<html>`):

```css
.high-contrast {
  --color-taint-critical: #FF0000;   /* pure red */
  --color-taint-high: #FF6600;       /* bright orange */
  --color-taint-medium: #FFCC00;     /* bright yellow */
  --color-investigator-mark: #0066FF; /* bright blue */
  /* background pushed to near-black, text to near-white */
}
```

The toggle lives in `/settings/appearance`. Sigma reads color values from CSS custom properties, so the canvas re-colors when the class is toggled.

### 17.4 Focus management

After every modal closes, focus returns to the triggering element (stored in a `useRef` before the modal opens). After inspector opens, focus goes to the first interactive element in the inspector. After Court Mode exits, focus returns to the canvas.

```typescript
function useModalFocus() {
  const triggerRef = useRef<HTMLElement | null>(null);
  
  const openModal = useCallback((trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setOpen(true);
  }, []);
  
  const closeModal = useCallback(() => {
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);
  
  return { openModal, closeModal };
}
```

---

## Section 18 — Mobile Responsiveness

### 18.1 Phase 1: Read-only viewer

The `(app)/layout.tsx` checks viewport width and conditionally renders `<MobileReadOnlyShell>` for screens under 768px. This shell:
- Shows case metadata, path summaries, wallet summaries, and reports in read-only card views
- Does not render the Sigma canvas (WebGL is unreliable on mobile browsers at investigation scale)
- Shows push notification badges for watcher alerts and deconfliction alerts
- Is fully responsive: every text component, card, and table uses Tailwind responsive modifiers

### 18.2 Phase 1: Court Mode driver (tablet)

On 768–1024px screens (tablet), the Court Mode route renders a touch-optimized layout:
- Swipe left/right → advance/retreat frames (handled by a `HammerJS` or native `touchstart`/`touchend` delta)
- Large tap targets for view switcher (A/B/C/D)
- The accounting panel collapses into a bottom sheet, swipe up to expand
- Methodology switcher is a bottom-sheet picker, not a dropdown

### 18.3 Phase 2: Field IOC capture

A `<FieldCapture>` component renders on mobile for `/cases/[caseId]/ioc/capture`:
- Camera integration via `getUserMedia()` and a Canvas-based OCR preview
- Barcode/QR code scanning via a WASM-based decoder
- Extracted addresses shown with checksum validation before submission
- Geo-tag and timestamp captured on tap of "Add to case"

### 18.4 What's never mobile

- Canvas editing (adding marks, memos, building paths) — desktop only
- Report authoring — desktop only
- Path finalization and sign-off — desktop only
- Any supervisor approval — desktop only

These restrictions are enforced via viewport detection that disables the write actions on mobile, not just hides them. A user trying to invoke them on mobile sees: "This action requires a desktop browser."

---

## Section 19 — Component Library Design

### 19.1 shadcn/ui primitives used directly

| shadcn Component | Where used |
|---|---|
| `Dialog` | API key modal, mark-as-important, attribution apply, compare mode confirmation |
| `Sheet` | Memo editor, important sidebar, review sidebar, refresh dropdown |
| `Popover` | Refresh scope dropdown, badge hover tooltips, context menus |
| `DropdownMenu` | Right-click canvas context menu, path style picker |
| `Tabs` | Case tabs (canvas / evidence / paths / wallets / documents / deconfliction / reports) |
| `Table` / `DataTable` | Inspector structured facts, coverage matrix, attribution library |
| `Form` / `Input` / `Textarea` | All form surfaces |
| `RadioGroup` / `Checkbox` | Selection groups in modals |
| `Toast` | Optimistic update confirmations, shared attribution notifications |
| `Progress` | Wallet analysis progress, document OCR progress |
| `Badge` | Entity attribution chips, path color chips, severity indicators |
| `Separator` | Inspector section dividers |
| `ScrollArea` | Important sidebar, inspector body, document extraction list |
| `Skeleton` | Inspector streaming placeholders |

### 19.2 Extended shadcn components

Components built on shadcn primitives but extended:

**`<TagInput>`** — multi-value tag entry with typeahead. Built on shadcn `Input` + `Badge` + a `Combobox`-style suggestion layer.

**`<ColorSwatchPicker>`** — the curated semantic palette swatch grid. Built on a CSS grid of colored `<button>` elements with aria labels. Not a free-picker.

**`<ConfidenceSlider>`** — a 5-point dot slider (●●●●○) for personal attribution confidence. Built on shadcn `Slider` with snapping.

**`<StreamingText>`** — text that reveals character by character as streaming SSE content arrives. Built as a custom hook + `<span>` with requestAnimationFrame batching.

### 19.3 Custom-built components (no shadcn base)

| Component | Justification |
|---|---|
| `<CanvasRoot>` | Sigma.js integration; no UI library has a WebGL graph primitive |
| `<DiamondNodeProgram>` | Custom Sigma WebGL program |
| `<PathRingProgram>` | Custom Sigma WebGL program |
| `<PercentageLabelProgram>` | Custom Sigma WebGL program |
| `<DropZone>` | File drag-and-drop with canvas and document tab variants |
| `<CourtAccountingPanel>` | Specialized display; no generic equivalent |
| `<SankeyView>` | D3 Sankey — direct D3 imperative rendering inside a React `useEffect` |
| `<TimelineView>` | Recharts area chart with a custom scrubber overlay |

### 19.4 Design tokens

```css
/* apps/web/app/globals.css — extends shadcn/ui's default tokens */
:root {
  /* Spacing (rem, base 4) */
  --spacing-canvas-gutter: 1.5rem;
  --spacing-sidebar-width: 280px;
  --spacing-inspector-width: 380px;
  --spacing-court-accounting-width: 280px;
  
  /* Typography */
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;  /* tx hashes */
  --font-body: 'Inter', sans-serif;
  --font-display: 'Inter', sans-serif;
  
  /* Canvas-specific tokens */
  --canvas-bg: hsl(222 47% 5%);          /* near-black */
  --canvas-grid: hsl(222 47% 8%);        /* subtle grid */
  --canvas-selection: hsl(212 100% 50%);  /* bright selection ring */
  
  /* Semantic palette (mirrors SemanticColors in TypeScript) */
  --color-taint-critical: hsl(6 78% 57%);
  --color-taint-high:     hsl(28 80% 52%);
  --color-taint-medium:   hsl(45 100% 51%);
  --color-taint-low:      hsl(145 63% 42%);
  --color-mark-blue:      hsl(210 68% 47%);
  --color-privacy-purple: hsl(275 60% 43%);
  --color-context-gray:   hsl(210 10% 50%);
}

/* High contrast variant */
.high-contrast {
  --canvas-bg: hsl(0 0% 0%);
  --color-taint-critical: hsl(0 100% 50%);
  /* ... */
}

/* Dark mode is the default (investigation platform) */
/* Light mode is available but non-default */
@media (prefers-color-scheme: light) {
  :root:not(.dark) {
    --canvas-bg: hsl(222 10% 95%);
    /* ... */
  }
}
```

---

## Section 20 — Phase 0 Implementation Plan

### 20.1 Week-by-week frontend work

**Week 1-2: Scaffold and auth**

Frontend work in this phase:
- Turborepo `apps/web` scaffold with Next.js 15 App Router, Tailwind, shadcn/ui `init`
- Supabase Auth integration: `@supabase/ssr` client factories, `middleware.ts` session refresh, `(auth)/login`, `(app)/layout.tsx` with `createSupabaseServerClient()` check
- Empty shell layout: sidebar, tab bar, top bar
- `/cases` route: case list with static mock data
- Route stubs: all routes return `<ComingSoon>` except `/cases` and the canvas skeleton
- Zustand stores: initial structure (empty, no actions yet)
- React Query: `QueryClientProvider` wired, initial `queryKeys` factory

**Week 3-4: Capability router + first chain**

Frontend work:
- Provider Marketplace stub: catalog page (static), single-key modal wired to backend
- `.env` bulk add modal (Mode B from v0.4 addendum)
- Sigma.js installed, canvas renders one hardcoded AddressNode + TransactionNode
- `AddressNode` circle renderer, `TransactionNode` diamond renderer
- Canvas container properly isolated from React re-renders (imperative sigma mutations)

**Week 5-6: Transaction-centric graph + Inspector skeleton**

Frontend work:
- Graph data React Query integration: `useQuery(queryKeys.caseGraph(caseId))` populates sigma.graph
- `NodeImageProgram` for entity type icons (static set of 8 most common icons)
- Transaction Inspector popup: non-modal, draggable, shows Sections 1-2 (facts + summary)
- SSE streaming from the analysis endpoint feeds `<StreamingSection>` components
- `Enter` key shortcut to open inspector for selected transaction

**Week 7-8: Reproducibility + canvas interactions**

Frontend work:
- Refresh button + last-refresh badge (stub: reads cache timestamp, no cost estimate yet)
- Mark as Important modal (`I` key) with optimistic update to canvas glow ring
- Memo drawer (`M` key) with Tiptap editor and save
- Basic keyboard shortcut handler (`E`, `H`, `F`, `?`)
- Court Mode route stub: full-screen, frozen state (no playback yet)
- Phase 0 demo: paste tx hash → Inspector populates → Reproducibility Pack export

### 20.2 Phase 1 frontend priorities (months 2-3)

After Phase 0 ships, the frontend work queue in rough priority order:
1. Path selection toolbar + click-select mode + path styling modal
2. Important sidebar with drag-to-reorder
3. LOD zoom transitions (far/medium/close thresholds)
4. Money-flow overlay toggle (Space key) + methodology switcher
5. API key bulk paste + `.env` file drop
6. Wallet creation form + progress indicator
7. Mobile read-only shell (responsive breakpoints)
8. Deconfliction tab (manual entries only)

### 20.3 Phase 2 frontend priorities (months 4-6)

1. Full Inspector (sections 3-8, obfuscation, critic, suggested actions)
2. Wallet History Analyzer results page + sub-graph on canvas
3. Document ingest: drop zone, progress, side-by-side reviewer
4. PSR: lasso and auto-pathfind modes + multi-path comparison panel
5. NL path select modal
6. Personal attribution apply + library view
7. Refresh cost estimator (real provider price sheets)
8. Court Mode: View C playback + accounting panel

---

## Section 21 — Open Questions

The following are specific decisions to clarify with the founder before or during Phase 0 development. These are UX choices that affect investigator workflow and can't be defaulted without user research.

### Q-FE-1: Inspector persistence model default

**Issue:** The v0.5 F8 addendum says inspections are ephemeral by default (24h cache then GC) unless explicitly saved. But the Inspector is the primary discovery surface.

**Design tension:** If investigators frequently need to recall "what analysis did I run on this tx three days ago?", ephemeral-by-default will frustrate them. If the platform auto-saves everything, the Reproducibility Pack grows large with noise.

**Recommendation:** Default to auto-save any inspection where the investigator takes any action (mark, memo, path add). Purely passive reads (open, read, close) are ephemeral. Verify this matches investigator expectations.

### Q-FE-2: Canvas node limit for the initial render

**Issue:** The progressive-loading approach (load 5-hop neighbors of seed IOCs) could still produce hundreds of nodes for complex cases. What is the right initial density before the investigator must manually expand?

**Recommendation:** Default to 3-hop initial render with a "Show more" prompt at the viewport edge. But the right number depends on how many nodes per hop an average case produces. Clarify with early pilot data.

### Q-FE-3: Methodology default in the overlay

**Issue:** The money-flow overlay defaults to showing FIFO. But different case types have different prosecutorial preferences (US criminal: FIFO/LIFO; UK civil: rolling charge).

**Recommendation:** Let the agency admin configure the default methodology, and let the investigator override per-case. Build the agency default into `AgencySettings.default_methodology`. Confirm whether it should also be configurable per Expert Witness Profile (v0.8 F26) for the expert's preferred methodology.

### Q-FE-4: Path naming UX — auto-name vs. always prompt

**Issue:** After a path is accepted (from auto-pathfind or NL query), should the platform auto-name it ("Path A," "Path B") or always prompt the investigator to name it?

**Recommendation:** Auto-name with a sequential label ("Path A") and prompt to rename inline (edit-in-place on the path strip). Requiring a name before saving friction blocks flow. Confirm.

### Q-FE-5: Court Mode network-disabled default

**Issue:** The v0.5 addendum says network calls are disabled by default in Court Mode. This protects against surprise re-renders but also means any attribution data that changed since the last refresh won't be current.

**Design tension:** If the investigator refreshes attribution the morning of trial, the frozen pack reflects that refresh. But if the case is old and they didn't refresh, they might present stale data.

**Recommendation:** Show a "last refreshed X days ago" warning when entering Court Mode with data older than 48 hours. Offer a "Refresh now before entering court" option. Confirm this is the right workflow vs. a harder "you must refresh before presenting" gate.

### Q-FE-6: Multi-inspector limit

**Issue:** The architecture allows up to 4 inspectors simultaneously. Is 4 the right cap, or should it be unlimited (with scrolling)?

**Recommendation:** 4 is the right cap for a single monitor. In dual-monitor scenarios (common in courtrooms), allow up to 8. Confirm based on typical investigator desktop setups.

### Q-FE-7: Memo editor — rich text vs. markdown

**Issue:** The spec describes memos as "rich-text first-class objects." Options: (a) Tiptap WYSIWYG, (b) `@uiw/react-md-editor` (split markdown/preview), (c) plain `<textarea>` for Phase 1.

**Recommendation:** Phase 0–1: plain `<textarea>` with basic markdown rendering in the preview. Phase 2: upgrade to Tiptap. This avoids Tiptap's bundle size (~150KB) in Phase 0 when the product is still proving its value. Confirm acceptable.

### Q-FE-8: Supervisor approval hot-path

**Issue:** The Supervisor Dashboard shows review checkpoints. For high-urgency decisions (freeze requests with SLA clocks running), supervisors need to approve from mobile. But Section 18.4 says supervisor approval is desktop-only.

**Design tension:** A freeze opportunity with a 6-hour stablecoin SLA and a supervisor on a plane should not fail because the approval is desktop-only.

**Recommendation:** Approve/reject on high-urgency checkpoints (specifically: freeze requests and seizure recommendations) should be available on mobile with MFA re-authentication for the action. Standard checkpoints (report drafts, tracing complete) remain desktop-only. Confirm which checkpoint types are "emergency-path" approvals.

### Q-FE-9: Keyboard shortcut conflicts with browser defaults

**Issue:** `Space` (assigned to money-flow overlay toggle) conflicts with browser page-scroll. The canvas has `tabIndex={0}` so when it's focused, `Space` would normally scroll.

**Recommendation:** Call `e.preventDefault()` for `Space` only when the canvas has focus and is the active element. Verify this doesn't conflict with accessibility tooling (some screen readers use `Space` to activate buttons).

### Q-FE-10: Path lasso freeform vs. rectangular

**Issue:** The spec describes a "freeform shape" for lasso selection. Freeform requires SVG path tracking and is harder to implement precisely. Rectangular selection is simpler and covers most use cases.

**Recommendation:** Phase 1: rectangular lasso (click-drag a box). Phase 2: freeform lasso (SVG path). Confirm this sequencing is acceptable.

### Q-FE-11: Supabase Realtime reconnect behavior

**Issue:** If an investigator's network drops briefly, Supabase Realtime channels reconnect automatically, but events during the disconnection window are lost (Realtime has no message history). React Query will eventually re-fetch, but the investigator may miss real-time alerts (deconfliction, watcher fires).

**Recommendation:** On Realtime reconnect, force-invalidate all active Realtime-dependent queries (deconfliction alerts, watcher fires, supervisor queue) to re-fetch fresh state. Add a "Reconnecting..." toast during the disconnection window. Implement a `useRealtimeReconnect` hook that subscribes to the Supabase Realtime `disconnect`/`reconnect` lifecycle and triggers the bulk invalidation.

### Q-FE-12: TOTP enrollment enforcement timeline

**Issue:** In Phase 0, MFA enrollment is advisory. When does it become mandatory? If an agency-tier investigator generates a court-grade report without MFA enrolled, that is a chain-of-custody gap.

**Recommendation:** Phase 1: TOTP enrollment required before first court-grade export. Phase 2: TOTP or WebAuthn required within 7 days of account creation for all agency-tier users. A persistent banner appears until enrolled. Confirm the enforcement timeline with legal/compliance review.

### Q-FE-13: RLS performance on large agencies

**Issue:** For agencies with thousands of cases, RLS policies with subquery joins (supervisor span-of-control policies) can degrade query performance.

**Recommendation:** Add covering indexes: `cases(agency_id, updated_at)`, `supervisory_roles(investigator_id)`. Validate with `EXPLAIN ANALYZE` before Phase 1 launch. Consider a materialized view for supervisor span-of-control if query time exceeds 50ms on the case list endpoint.

### Q-FE-14: Supabase Realtime and multi-tab scenarios

**Issue:** An investigator might have ChainSight open in two browser tabs simultaneously. Each tab creates its own Realtime subscriptions, leading to duplicate toast notifications and double React Query invalidations.

**Recommendation:** Use `BroadcastChannel` API to coordinate across tabs — whichever tab is the "leader" (using a leader election algorithm via `navigator.locks`) owns the Realtime subscriptions. Other tabs receive invalidation signals via BroadcastChannel. This is a Phase 2 concern; Phase 0 can accept duplicate toasts as a known limitation.


---

## Section 22 — Supabase Integration Reference

This section is a consolidated quick-reference for every place Supabase appears in the ChainSight frontend. It is the authoritative guide for AI agents and the solo developer when implementing features.

### 22.1 Package inventory

```
# Install set for SaaS Blind v1
pnpm add @supabase/ssr @supabase/supabase-js
pnpm add @tanstack/react-query @tanstack/react-query-devtools
pnpm add zustand

# Type generation (run after schema changes)
pnpm supabase gen types typescript --linked > apps/web/types/supabase-generated.ts
```

### 22.2 Client factory reference

| Factory | File | Used in | Cookies |
|---|---|---|---|
| `createSupabaseServerClient()` | `lib/supabase/server.ts` | Server Components, Route Handlers, Server Actions | Reads + writes via `cookies()` from `next/headers` |
| `supabase` (singleton) | `lib/supabase/client.ts` | Client Components, hooks | Browser cookie jar |
| Middleware client | `middleware.ts` | Every request (session refresh) | Reads from `request.cookies`, writes to `response.cookies` |

**Golden rule:** Never import `lib/supabase/server.ts` in a Client Component. Never call `cookies()` outside a Server Component or Route Handler. The TypeScript `"use server"` / `"use client"` boundary prevents this if you follow the module split above.

### 22.3 Data-fetching decision matrix

This matrix answers the question: "Where do I fetch this data?"

```
                ┌─────────────────────────────────────────────┐
                │         Does the read touch case graph data? │
                │              (nodes, edges, paths)           │
                └────────────────┬────────────────────────────┘
                                 │
               YES ◄─────────────┼─────────────────► NO
                │                                     │
                ▼                                     ▼
       Always tRPC API                Is a write or does it need
       (Memgraph fan-out +             an audit log entry?
        audit log required)           │
                                      │
                        YES ◄─────────┼──────────────► NO
                         │                              │
                         ▼                              ▼
                   tRPC mutation               Direct Supabase client
                   (API writes +               via React Query useQuery
                    audit entry)               (RLS enforces security)
```

**Non-sensitive direct reads (current list):**
- `cases` table: list view columns only (`id, codename, status, classification, created_by, updated_at`)
- `personal_attributions` table: own attributions only (`attributor_id = auth.uid()`)
- `agencies` table: own agency record
- `trace_paths` table: list columns for the case layout pre-fetch
- `providers` table: marketplace catalog (pre-fetch in marketplace layout)

**Everything else goes through tRPC.**

### 22.4 React Query stale-time cheat sheet

| Query key | staleTime | Rationale |
|---|---|---|
| `caseList` | 60s | Changes infrequently; Realtime invalidates on INSERT |
| `case(id)` | 5 min | Pre-fetched; Realtime invalidates on UPDATE |
| `caseGraph(id)` | 5 min | Expensive to fetch; Refresh button forces invalidation |
| `attributions(userId)` | 5 min | Infrequent writes |
| `providers()` | 10 min | Near-static catalog |
| `refreshStatus(id)` | 30s | Updates frequently; Realtime invalidates on change |
| `walletAnalysis(id)` | 0 (polling) | Long-running async; polling until complete then 5 min |
| `inspectorAnalysis(txId)` | 30 min | Expensive; persists for session unless manually invalidated |

### 22.5 Realtime channel lifecycle

All Realtime subscriptions follow the same lifecycle:

1. `useEffect` opens channel on mount
2. On event: update Zustand for UI state (badge counts, presence), then invalidate React Query for data
3. `return () => supabase.removeChannel(channel)` on unmount

**Subscription ownership:** Each subscription is owned by the hook/component most logically responsible for it. Do not create duplicate subscriptions for the same channel — React Query invalidation is global, so one subscription is enough.

```typescript
// Pattern: one subscription per context, always cleaned up
useEffect(() => {
  const ch = supabase.channel(channelName)
    .on('postgres_changes', { event, schema, table, filter }, handler)
    .subscribe();
  return () => supabase.removeChannel(ch);
}, [channelName]); // stable dep — channelName includes case/user ID
```

### 22.6 MFA gates reference

The following actions require MFA re-verification before execution:

| Action | tRPC procedure | MFA type |
|---|---|---|
| Finalize path for report | `paths.finalize` | TOTP or WebAuthn |
| Generate court-grade report | `reports.generateCourt` | TOTP or WebAuthn |
| Approve freeze request | `supervisor.approveFreezeRequest` | TOTP or WebAuthn |
| Approve supervisor checkpoint | `supervisor.approveCheckpoint` | TOTP |
| Export Reproducibility Pack | `reports.exportPack` | TOTP |
| Delete case | `cases.delete` | TOTP or WebAuthn |

All use `useMFAGate()` from `hooks/useMFAGate.ts`. In Phase 0, MFA enrollment is optional (advisory prompt only). In Phase 2, agency-tier users are required to enroll before any court-grade export.

### 22.7 Session and JWT claims

Supabase JWT payload that the frontend relies on:

```typescript
// What supabase.auth.getUser() returns (decoded from JWT)
interface ChainSightUser {
  id: string;                    // Supabase user UUID
  email: string;
  app_metadata: {
    agency_id: string;           // Set at registration by our API
    role: 'investigator' | 'supervisor' | 'admin'; // Set at registration
    license_tier: 'free' | 'professional' | 'agency'; // Controls feature flags
  };
  user_metadata: {
    display_name: string;        // "J. Smith"
    avatar_url?: string;         // Optional; used in presence chips
    expert_witness_credentials?: string; // Filled in Settings → Profile
  };
}
```

**Accessing JWT claims in hooks:**

```typescript
const { user } = useSession();
const agencyId = user?.app_metadata?.agency_id;
const role = user?.app_metadata?.role;
const isAdmin = role === 'admin';
const isSupervisor = role === 'supervisor' || role === 'admin';
```

**Accessing JWT claims in RLS policies:**

```sql
-- The canonical RLS helper expression:
(auth.jwt()->'app_metadata'->>'agency_id')::uuid

-- Role check in RLS:
(auth.jwt()->'app_metadata'->>'role') IN ('supervisor', 'admin')
```

### 22.8 Environment variables

```bash
# Required in apps/web/.env.local (development)
# and as Fly.io secrets (production)

NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>     # Safe to expose to browser (RLS enforces)
SUPABASE_SERVICE_ROLE_KEY=<service-key>      # NEVER exposed to browser — API only

# On-Prem Sovereign: replace URL with self-hosted Supabase instance URL
# All auth code paths work unchanged — just swap the environment variable
```

**ANON key vs. SERVICE_ROLE key:**
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — used by both server and browser Supabase clients. Respects RLS. Safe to embed in browser bundles.
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS entirely. Used only in tRPC API route handlers for operations that legitimately need to cross tenant boundaries (agency admin operations, background jobs). Must never be imported in any Client Component.

### 22.9 On-Prem compatibility checklist

When a new Supabase-dependent feature is added, verify it works with On-Prem Sovereign deployment:

- [ ] Auth: Does it use `NEXT_PUBLIC_SUPABASE_URL` (configurable) or hardcoded Supabase.co URLs?
- [ ] Storage: Does it use the `StorageBackend` abstraction or call `supabase.storage` directly?
- [ ] Realtime: Does it use the configurable WS URL or assume Supabase.co Realtime?
- [ ] Types: Are generated types from `supabase gen types` or hand-rolled? (Both work on-prem)
- [ ] JWT claims: Are `app_metadata` claims set by our API? (Yes — On-Prem uses same registration flow)


---

## Appendix A — Component Sketch Reference

### A.1 Canvas layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Top bar: [Case name] [🔄 4h ago 🟡] [Overlay off] [FIFO] [⚙️] [?]│
├───────┬──────────────────────────────────────────────┬──────────────┤
│ Path  │                                              │  Important   │
│ Toolbar│            SIGMA.JS CANVAS                  │  Sidebar     │
│       │                                              │  (closed by  │
│ [↗ P]│                                              │   default)   │
│ [⬡ L]│                                              │              │
│ [⇄ A]│                                              │              │
│ [💬 N]│                                              │              │
│       │                                              │              │
│       │                                              │              │
│       │                                              │              │
└───────┴──────────────────────────────────────────────┴──────────────┘
```

### A.2 Data flow: investigator mark → canvas

```
Investigator presses 'I'
        │
        ▼
useKeyboardShortcuts() dispatches openImportantModal(selectedNodes)
        │
        ▼
ImportantModal renders (shadcn Dialog)
        │ investigator fills form, clicks "Mark"
        ▼
useMutation('createMark') fires
        │
        ├──▶ OPTIMISTIC: sigma.graph.setNodeAttribute(id, 'isImportant', true)
        │    sigma.graph.setNodeAttribute(id, 'borderColor', SemanticColors.investigator_mark)
        │    → canvas re-renders immediately with glow ring
        │
        └──▶ ASYNC: POST /api/trpc/marks.create
                    │ server writes InvestigatorMark
                    │ server writes BeliefAtom (T0)
                    │ server notifies Suggestion Agent
                    │ server updates Important sidebar data
                    ▼
              React Query invalidates queryKeys.caseGraph(caseId)
              Important sidebar React Query data refetches
              Toast: "Marked as Important ⭐"
```

### A.3 Transaction Inspector data flow

```
User clicks TransactionNode on canvas (or presses Enter)
        │
        ▼
sigma.on('clickNode') fires with nodeId
canvasStore.openInspector(nodeId)
        │
        ▼
<InspectorPanel txId={nodeId}> mounts
        │
        ▼
useInspectorStream(caseId, txId) hook starts SSE connection
  GET /api/inspector/stream?case={caseId}&tx={txId}
        │
        ▼ events arrive:
section:summary  → <StreamingSection sectionId="summary"> updates
section:facts    → <StreamingSection sectionId="facts"> updates
section:decoded  → ...
...
        │
        ▼
On complete: TransactionAnalysis saved to React Query cache
            If any action taken: auto-saves to case (per §8.5 auto-save triggers)
```

---

*Document version: v1.0 · Generated as Frontend UX Architecture discipline output*  
*References: chainsight_v0_4_canvas_ux_addendum.md, chainsight_v0_5_addendum_2.md, chainsight_v0_5_addendum_3.md, chainsight_v0_5_addendum.md, chainsight_v0_4_api_key_entry_addendum.md, chainsight_v0_6_addendum.md, chainsight_v0_3_addendum.md, chainsight_v1_0_engineering.md, chainsight_v0_8_addendum.md*


---

*Document version: v1.1 · Stack update: Supabase (Auth + Postgres + Storage + Realtime) replaces Clerk*  
