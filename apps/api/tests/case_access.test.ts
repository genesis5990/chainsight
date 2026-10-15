import { describe, it, expect } from 'vitest';
import { ensureCaseWriteAccess } from '../src/lib/case_access';

type Row = { case_id: string; user_id: string; can_read: boolean; can_write: boolean; granted_by: string; granted_at: string };

/** belief.case_acl over an array, with the PostgREST calls the helper makes. */
function fakeAcl(rows: Row[] = []) {
  let clock = 0;
  const table = () => {
    const f: Array<(r: Row) => boolean> = [];
    let lim = Infinity;
    let patch: Partial<Row> | null = null;
    const run = () => rows.filter((r) => f.every((p) => p(r)));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: keyof Row, v: unknown) => { f.push((r) => r[c] === v); return q; },
      order: () => q,
      limit: async (n: number) => { lim = n; return { data: run().sort((a, b) => a.granted_at.localeCompare(b.granted_at)).slice(0, lim), error: null }; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      upsert: async (row: Omit<Row, 'granted_at'>) => {
        if (!rows.some((r) => r.case_id === row.case_id && r.user_id === row.user_id)) rows.push({ ...row, granted_at: String(++clock).padStart(6, '0') });
        return { error: null };
      },
      update: (p: Partial<Row>) => { patch = p; return q; },
      then: (res: (v: { error: null }) => void) => { if (patch) for (const r of run()) Object.assign(r, patch); res({ error: null }); },
    };
    return q;
  };
  return { client: { schema: () => ({ from: table }) }, rows };
}

describe('ensureCaseWriteAccess', () => {
  it('first user claims an unowned case; the owner keeps access; others are refused', async () => {
    const { client, rows } = fakeAcl();
    expect(await ensureCaseWriteAccess(client as never, 'c', 'u1')).toBe('claimed_as_owner');
    expect(await ensureCaseWriteAccess(client as never, 'c', 'u1')).toBe('already_granted');
    await expect(ensureCaseWriteAccess(client as never, 'c', 'u2')).rejects.toThrow(/do not have write access/);
    expect(rows).toHaveLength(1);
  });

  it('a read-only grant does not allow writes', async () => {
    const { client } = fakeAcl([{ case_id: 'c', user_id: 'u2', can_read: true, can_write: false, granted_by: 'u1', granted_at: '000001' }]);
    await expect(ensureCaseWriteAccess(client as never, 'c', 'u2')).rejects.toThrow(/write access/);
  });

  it('an explicit write grant is honoured', async () => {
    const { client } = fakeAcl([{ case_id: 'c', user_id: 'u2', can_read: true, can_write: true, granted_by: 'u1', granted_at: '000001' }]);
    expect(await ensureCaseWriteAccess(client as never, 'c', 'u2')).toBe('already_granted');
  });
});
