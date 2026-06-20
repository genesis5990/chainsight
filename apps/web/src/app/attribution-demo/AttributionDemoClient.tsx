'use client';

import { AttributionLibrary } from '../../components/attribution/AttributionLibrary';
import { LIBRARY } from '../../components/attribution/seed';

export default function AttributionDemoClient() {
  return <AttributionLibrary snapshot={LIBRARY} />;
}
