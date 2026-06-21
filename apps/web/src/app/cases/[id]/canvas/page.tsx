import { CanvasLiveClient } from './CanvasLiveClient';

export const metadata = {
  title: 'Canvas (live) — ChainSight',
  description: 'Live investigator canvas wired to /v1/pathfinder, /v1/tracer, and SSE.',
};

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CanvasLiveClient case_id={id} />;
}
