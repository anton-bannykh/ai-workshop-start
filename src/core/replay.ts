import type { Fetch } from './github.ts';

/** One recorded GitHub answer: the status and the body, JSON or text. */
export type Recorded = { status: number; body: unknown };

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
      const { status, body } = recording[key];
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }
    if (fallback) return fallback(url, init);
    throw new Error(`not recorded: ${key}`);
  };
}
