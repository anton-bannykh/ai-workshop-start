/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/**
 * The source not answering at all, rather than for one repository: unreachable, rate-limited or the
 * token rejected. An organization's scan stops at it; another error only skips that repository.
 */
export class Unavailable extends AtlasError {}
