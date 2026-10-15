/**
 * Case access for writes (belief.case_acl).
 *
 * The belief-state service refuses to record evidence on a case unless the
 * acting user has can_write in belief.case_acl. Nothing granted that, so
 * every trace that reached atom emission failed with
 * "no write access to case …".
 *
 * Cases are not persisted as their own rows yet, so the first user to start
 * work on an unclaimed case becomes its owner (read + write). Once a case has
 * any ACL row, other users need an explicit grant.
 */

export interface CaseAclClient {
  schema(name: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(table: string): any;
  };
}

export class CaseAccessDenied extends Error {
  readonly statusCode = 403;
  constructor(case_id: string) {
    super(`You do not have write access to case ${case_id}. Ask the case owner to grant it.`);
    this.name = 'CaseAccessDenied';
  }
}

export type CaseAccessResult = 'already_granted' | 'claimed_as_owner';

/** Ensure user_id can write to case_id, claiming an unowned case. Throws CaseAccessDenied otherwise. */
export async function ensureCaseWriteAccess(
  client: CaseAclClient,
  case_id: string,
  user_id: string,
): Promise<CaseAccessResult> {
  const acl = client.schema('belief').from('case_acl');

  const mine = await acl.select('can_write').eq('case_id', case_id).eq('user_id', user_id).maybeSingle();
  if (mine.error) throw new Error(`case_acl read failed: ${mine.error.message}`);
  if (mine.data?.can_write) return 'already_granted';
  if (mine.data) throw new CaseAccessDenied(case_id); // read-only grant

  const any = await client.schema('belief').from('case_acl').select('user_id').eq('case_id', case_id).limit(1);
  if (any.error) throw new Error(`case_acl read failed: ${any.error.message}`);
  if ((any.data ?? []).length > 0) throw new CaseAccessDenied(case_id);

  // Unclaimed: take ownership. ignoreDuplicates so a concurrent claim by the
  // same user is harmless; a concurrent claim by someone else is caught below.
  const ins = await client
    .schema('belief')
    .from('case_acl')
    .upsert(
      { case_id, user_id, can_read: true, can_write: true, granted_by: user_id },
      { onConflict: 'case_id,user_id', ignoreDuplicates: true },
    );
  if (ins.error) throw new Error(`case_acl claim failed: ${ins.error.message}`);

  // Two users can claim the same new case at the same instant and both rows
  // land. The earliest grant wins; the loser's row is downgraded to
  // read-only (service_role cannot delete ACL rows) so it never authorizes a
  // later write.
  const owners = await client
    .schema('belief')
    .from('case_acl')
    .select('user_id, granted_at')
    .eq('case_id', case_id)
    .order('granted_at', { ascending: true })
    .order('user_id', { ascending: true })
    .limit(1);
  if (owners.error) throw new Error(`case_acl read failed: ${owners.error.message}`);
  if (owners.data?.[0]?.user_id !== user_id) {
    const down = await client
      .schema('belief')
      .from('case_acl')
      .update({ can_write: false })
      .eq('case_id', case_id)
      .eq('user_id', user_id);
    if (down.error) throw new Error(`case_acl downgrade failed: ${down.error.message}`);
    throw new CaseAccessDenied(case_id);
  }
  return 'claimed_as_owner';
}
