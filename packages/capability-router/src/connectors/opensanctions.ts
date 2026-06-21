/**
 * OpenSanctionsConnector — implements get_address_attribution against
 * OpenSanctions' public API.
 *
 * The free OFAC SDN list is the default attribution provider in Phase 1
 * (v1.0 Backend §22.2 recommendation). When the address is listed, returns
 * a populated attribution payload; otherwise returns `match: false`. This
 * is enough to satisfy F25 (sanctions categorization at the Inspector).
 *
 * Endpoint: GET https://api.opensanctions.org/match/sanctions
 *   - free tier: no key, 100 req/day, sufficient for dev
 *   - paid: key passed via Authorization: ApiKey <key>
 */

import type {
  Capability,
  ConnectorCallOptions,
  ConnectorResponse,
  ProviderConnector,
  ResolvedCredential,
} from '../types';

const OPENSANCTIONS_BASE = 'https://api.opensanctions.org/match/sanctions';

export interface OpenSanctionsResponse {
  match: boolean;
  label: string | null;
  category: 'sanctions' | 'pep' | 'crime' | 'other' | null;
  source_dataset: string | null;
  match_score: number | null;
  /** Provider-side fingerprint (for audit). */
  raw_provider_id: string;
}

export interface OpenSanctionsConnectorOptions {
  base_url?: string;
  fetch_impl?: typeof fetch;
}

export class OpenSanctionsConnector implements ProviderConnector {
  readonly provider_id = 'opensanctions';
  readonly capabilities: readonly Capability[] = ['get_address_attribution', 'get_sanctions_status'];

  constructor(private readonly opts: OpenSanctionsConnectorOptions = {}) {}

  async call<TPayload>(
    capability: Capability,
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    if (capability !== 'get_address_attribution' && capability !== 'get_sanctions_status') {
      throw new Error(`OpenSanctionsConnector does not support capability '${capability}'`);
    }
    const addressRef = String(args.address_ref ?? '');
    // address_ref is a ChainAddressRef like 'evm:1_addr:0x…'. We extract the bare address.
    const bareAddress = addressRef.includes('_addr:') ? addressRef.split('_addr:')[1] : addressRef;
    if (!bareAddress) throw new Error(`address_ref missing or malformed: '${addressRef}'`);

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? OPENSANCTIONS_BASE;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (credential?.secret) headers.authorization = `ApiKey ${credential.secret}`;

    const body = {
      queries: {
        q: {
          schema: 'CryptoWallet',
          properties: { publicKey: [bareAddress] },
        },
      },
    };

    const res = await fetchImpl(base, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`opensanctions HTTP ${res.status}`);
    const json = await res.json() as OpenSanctionsRawResponse;

    const result = json.responses?.q?.results?.[0];
    if (!result) {
      const data: OpenSanctionsResponse = {
        match: false,
        label: null,
        category: null,
        source_dataset: null,
        match_score: null,
        raw_provider_id: 'opensanctions',
      };
      return { data: data as unknown as TPayload, metadata: { request_id: `opensanctions:${bareAddress}` } };
    }

    const category = mapDatasetToCategory(result.datasets ?? []);
    const data: OpenSanctionsResponse = {
      match: true,
      label: result.caption ?? result.id ?? 'sanctioned entity',
      category,
      source_dataset: result.datasets?.[0] ?? null,
      match_score: result.score ?? null,
      raw_provider_id: 'opensanctions',
    };
    return { data: data as unknown as TPayload, metadata: { request_id: `opensanctions:${bareAddress}` } };
  }
}

function mapDatasetToCategory(datasets: string[]): OpenSanctionsResponse['category'] {
  if (datasets.some((d) => d.toLowerCase().includes('sanction') || d.toLowerCase().includes('ofac'))) return 'sanctions';
  if (datasets.some((d) => d.toLowerCase().includes('pep'))) return 'pep';
  if (datasets.some((d) => d.toLowerCase().includes('crime'))) return 'crime';
  return 'other';
}

interface OpenSanctionsRawResponse {
  responses?: {
    q?: {
      results?: Array<{
        id?: string;
        caption?: string;
        score?: number;
        datasets?: string[];
      }>;
    };
  };
}
