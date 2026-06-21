import { AgencyAdminClient } from './AgencyAdminClient';

export const metadata = {
  title: 'Agency admin — ChainSight',
  description: 'SaaS Blind agency onboarding: members, invitations, provider installs, BYOK credentials.',
};

export default function AgencyAdminPage() {
  return <AgencyAdminClient />;
}
