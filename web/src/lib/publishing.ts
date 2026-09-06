import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who can walk a trail, in one place.
 *
 * There were two controls for this and two vocabularies. My trails offered
 * private / with the code / ask to be listed, and the editor offered a Publish
 * button that toggled the same two columns behind the creator's back - so a
 * trail could be "published" in one screen and "only me" in the other, and both
 * were telling the truth about a different column.
 *
 * The ladder has three rungs and they are ordered by who can reach the trail:
 *
 *   draft   nobody but the owner
 *   code    anyone the owner hands the code to
 *   public  anyone at all, once a reviewer has agreed
 *
 * The first two are the owner's to set. The third is a request, because the
 * word "public" is granted by somebody else - which is why it is an action here
 * and a state only after decide_listing has run.
 */
export type Level = 'draft' | 'code' | 'public';

/** Which rung a trail is on, from the two columns that actually store it. */
export function levelOf(world: { status?: string; visibility?: string }): Level {
  if (world.status === 'submitted') return 'public';
  if (world.visibility === 'public') return 'public';
  if (world.status === 'draft' || world.visibility === 'private') return 'draft';
  return 'code';
}

/** Waiting for a reviewer: on the public rung, not yet standing on it. */
export const isPending = (world: { status?: string }) => world.status === 'submitted';

/** Granted, rather than asked for. */
export const isListed = (world: { status?: string; visibility?: string }) =>
  world.visibility === 'public' && world.status !== 'submitted';

/**
 * Moves a trail to a rung.
 *
 * Returns an error message or null. The caller reloads afterwards rather than
 * guessing the new state: request_listing refuses a trail with no stops, and
 * what the row ends up saying is the server's business.
 */
export async function setLevel(
  client: SupabaseClient,
  world: { id: string; status?: string; visibility?: string },
  level: Level,
): Promise<string | null> {
  // Leaving the queue first. A submitted trail cannot simply be written over -
  // it would sit in the reviewer's list pointing at something that had changed
  // underneath them.
  if (isPending(world) && level !== 'public') {
    const { error } = await client.rpc('withdraw_listing', { p_world: world.id });
    if (error) return error.message;
  }

  if (level === 'public') {
    if (isListed(world) || isPending(world)) return null;
    const { error } = await client.rpc('request_listing', { p_world: world.id });
    return error ? error.message : null;
  }

  // status and visibility move together, always. Half of this pair on its own is
  // how a trail ends up claiming to be shared while opening for nobody.
  const { error } = await client
    .from('worlds')
    .update(level === 'draft'
      ? { visibility: 'private', status: 'draft' }
      : { visibility: 'unlisted', status: 'published' })
    .eq('id', world.id)
    .select('id');

  return error ? error.message : null;
}
