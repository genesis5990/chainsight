import { PacksClient } from './PacksClient';

export const metadata = {
  title: 'Packs — ChainSight',
  description: 'Reproducibility Pack management: list, build, download, and verify.',
};

export default async function PacksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PacksClient case_id={id} />;
}
