// Supabase Free pauses a project after a week with no requests. A trail
// organised for a Saturday morning, after a quiet week, would find the
// database asleep - so once a day this asks it something.
//
// keep_alive() stamps public.heartbeat; reading that timestamp is how anyone
// can check this is still running. The URL and anon key come from the site's
// own environment variables in Netlify (the same two the build uses), so no
// key is written into this repository.

export default async () => {
  const url = process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.log('keep-alive: PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY is not set for functions');
    return new Response('not configured', { status: 500 });
  }

  const response = await fetch(`${url}/rest/v1/rpc/keep_alive`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  });

  console.log('keep-alive:', response.status, await response.text());
  return new Response(String(response.status));
};

export const config = { schedule: '@daily' };
