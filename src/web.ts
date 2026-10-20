// The web view: one page with a field for a repository link, and the scan as JSON behind it. Local
// only, on 127.0.0.1; nothing is stored. The same core as the CLI: fetch → find → parse.
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { skillLink, skillLinkParts, type Repository, type Skill } from './core/model.ts';
import { scan, scanOrganization, type OrganizationSource, type Progress, type Source } from './core/scan.ts';
import { renderSkill } from './markdown.ts';

const PAGE = readFileSync(new URL('./web/index.html', import.meta.url));
const HOST = '127.0.0.1';

/** The web view's server, not yet listening; `open` is what the CLI's `scan` opens. */
export function createWebServer(open: (input: string) => Promise<Source | OrganizationSource>): Server {
  return createServer(async (request, response) => {
    const send = (status: number, type: string, body: string | Buffer) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    const json = (status: number, value: unknown) => send(status, 'application/json; charset=utf-8', JSON.stringify(value));

    // Only the page itself asks: another Host is another site, rebound to this address.
    const host = request.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) return json(403, { error: `Not a local address: ${host}` });
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (request.method !== 'GET') return json(405, { error: `Not allowed: ${request.method}` });
    if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', PAGE);
    if (url.pathname !== '/api/scan') return json(404, { error: `Not found: ${url.pathname}` });

    const input = url.searchParams.get('repo')?.trim();
    if (!input) return json(400, { error: 'Enter a GitHub repository or organization URL, or a directory' });
    const failure = (error: unknown) => error instanceof AtlasError
      ? { status: 400, error: error.message }
      : { status: 500, error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` };

    // With &progress, one JSON line as each repository is done, then the result or the error.
    if (url.searchParams.has('progress')) {
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const line = (value: unknown) => response.write(`${JSON.stringify(value)}\n`);
      try {
        line({ result: await scanned(open, input, (progress) => line({ progress })) });
      } catch (error) {
        line(failure(error));
      }
      return response.end();
    }
    try {
      json(200, await scanned(open, input));
    } catch (error) {
      const { status, error: message } = failure(error);
      json(status, { error: message });
    }
  });
}

/** What `/api/scan` answers: the repository, or the organization's repositories, with the warnings. */
async function scanned(open: (input: string) => Promise<Source | OrganizationSource>, input: string, progress?: (progress: Progress) => void) {
  const source = await open(input);
  if ('organization' in source) {
    const { organization, repositories, scanned, warnings } = await scanOrganization(source, progress);
    return {
      organization,
      repositories: repositories.map(({ repository, skills, warnings }) => ({ ...withPages(repository, skills), warnings })),
      scanned,
      warnings,
    };
  }
  const { repository, skills, warnings } = await scan(source);
  return { ...withPages(repository, skills), warnings };
}

/** The repository and its skills, each with its link and its SKILL.md as HTML. */
function withPages(repository: Repository, skills: Skill[]) {
  return {
    repository,
    skills: skills.map((skill) => ({
      ...skill,
      link: skillLinkParts(repository, skill),
      html: renderSkill(skill.text, skillLink(repository, skill)),
    })),
  };
}

/** Listens on 127.0.0.1; the page's address, once it is there. */
export function listen(server: Server, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(new AtlasError(error.code === 'EADDRINUSE' ? `Port ${port} is in use; try another: skill-atlas serve <port>` : error.message));
    });
    server.listen(port, HOST, () => {
      const address = server.address();
      resolve(`http://${HOST}:${typeof address === 'object' && address ? address.port : port}/`);
    });
  });
}
