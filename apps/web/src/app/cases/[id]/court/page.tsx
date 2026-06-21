import { CourtLiveClient } from './CourtLiveClient';

export const metadata = {
  title: 'Court view — ChainSight',
  description: 'Read-only path renderer with hop navigation, value Sankey, and atom citations.',
};

export default async function CourtPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourtLiveClient case_id={id} />;
}
