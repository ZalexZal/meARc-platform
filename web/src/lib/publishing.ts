import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who can walk a trail, in one place.
 *
 * Two rungs, and a trail is on one of them from the moment it is made
 * (12 Nov 2026; "Only me" and the review queue are gone):
 *
 *   code    anyone the owner hands the code to. Where every trail starts.
 *   public  anyone at all: listed on the trails page the moment the owner says so.
 *
 * Both are the owner's to set, and both are instant. The word "public" used to
 * be granted by a reviewer; now it is a switch like the other.
 *
 * Old rows that were still waiting in the queue were approved by migration 0072,
 * so a 'submitted' status is not a state this code draws. decide_listing and
 * the review page stay for the day a reviewer is wanted again.
 */
export type Level = 'code' | 'public';

/** Which rung a trail is on. Anything that is not public opens with the code. */
export function levelOf(world: { status?: string; visibility?: string }): Level {
  return world.visibility === 'public' ? 'public' : 'code';
}

/**
 * How many of a trail's stops are still drafts: placed on the map and never
 * finished. Drafts are never sent to walkers, so a trail shared with any of
 * them would be missing stops.
 */
export async function unfinishedStops(client: SupabaseClient, worldId: string): Promise<number> {
  const { data } = await client.rpc('trail_markers', { p_world: worldId });
  return ((data ?? []) as { status?: string }[]).filter((m) => m.status === 'draft').length;
}

/**
 * Moves a trail to a rung.
 *
 * Made public only once every stop is finished (30 October 2026): `draftsMessage`
 * is said instead, with {0} for how many are not. The server checks the same
 * thing in make_public, so this is the friendly version of its refusal.
 *
 * Returns an error message or null. The caller reloads afterwards rather than
 * guessing the new state.
 */
export async function setLevel(
  client: SupabaseClient,
  world: { id: string; status?: string; visibility?: string },
  level: Level,
  draftsMessage: string,
): Promise<string | null> {
  if (level === 'public') {
    const drafts = await unfinishedStops(client, world.id);
    if (drafts > 0) return draftsMessage.replace('{0}', String(drafts));
    const { error } = await client.rpc('make_public', { p_world: world.id });
    return error ? error.message : null;
  }

  // Back to the code: unlisted at once. A function rather than two column
  // writes, because status and visibility have to move together.
  const { error } = await client.rpc('make_code', { p_world: world.id });
  return error ? error.message : null;
}
