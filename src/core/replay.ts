import type { Fetch } from './github.ts';

/** One recorded GitHub answer: the status, the body, JSON or text, and the headers that matter, e.g. `Link`. */
export type Recorded = { status: number; body: unknown; headers?: Record<string, string> };

/**
 * Recorded answers by request URL. A GraphQL request is recorded by its URL and its variables, as
 * `graphql(variables)` names it: the query is the code's own.
 */
export type Recording = Record<string, Recorded>;

/** The recording's name for a GraphQL request with these variables. */
export function graphql(variables: Record<string, unknown>): string {
  return `https://api.github.com/graphql ${JSON.stringify(variables)}`;
}

/**
 * A fetch that answers from a recording. Any other URL goes to `fallback`,
 * or fails, so a replay never reaches the network by accident.
 */
export function replay(recording: Recording, fallback?: Fetch): Fetch {
  return async (url, init) => {
    const key = init?.body === undefined ? url : `${url} ${JSON.stringify((JSON.parse(init.body) as { variables: unknown }).variables)}`;
    if (Object.hasOwn(recording, key)) {
      const { status, body, headers } = recording[key];
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
    }
    if (fallback) return fallback(url, init);
    throw new Error(`not recorded: ${key}`);
  };
}
