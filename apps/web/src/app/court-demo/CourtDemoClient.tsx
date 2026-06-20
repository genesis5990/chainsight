'use client';

import { CourtMode } from '../../components/court/CourtMode';
import { SEED_DECK } from '../../components/court/seed';

export default function CourtDemoClient() {
  // In production this page would only be reachable through a case view's
  // "Present in Court" button, and onExit would route back to the case.
  // For the Phase 0 demo we just stay on the page — the close button is a no-op.
  return (
    <CourtMode
      deck={SEED_DECK}
      onExit={() => {
        if (typeof window !== 'undefined') window.location.href = '/';
      }}
    />
  );
}
