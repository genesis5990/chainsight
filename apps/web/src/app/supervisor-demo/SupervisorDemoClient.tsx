'use client';

import { SupervisorDashboard } from '../../components/supervisor/SupervisorDashboard';
import { ALTERNATE_SCOPES, SUPERVISOR_DASHBOARD } from '../../components/supervisor/seed';

export default function SupervisorDemoClient() {
  return (
    <SupervisorDashboard
      snapshot={SUPERVISOR_DASHBOARD}
      scopes={ALTERNATE_SCOPES}
    />
  );
}
