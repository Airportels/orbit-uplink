export class OrbitError extends Error {
  /** @param {string} message @param {{ code?: string, exitCode?: number, hint?: string }} [opts] */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'OrbitError';
    this.code = opts.code ?? 'orbit_error';
    this.exitCode = opts.exitCode ?? 1;
    this.hint = opts.hint;
  }
}

/**
 * §27.1 (CONTRACT 0.11.0, M26): Mission Control's permission refusals, for every command. `not_allowed` (403, which replaces
 * `not_admin`) names the missing permission in `details.perm`; `target_not_admin` (409, transferOwnership) wants an admin. Older
 * servers' `not_admin` keeps the commands' own hints. → a hint, or undefined.
 */
export function permissionHint(code, body) {
  if (code === 'not_allowed') {
    const perm = body && typeof body === 'object' ? body.error?.details?.perm : undefined;
    return typeof perm === 'string' && perm ? `your role doesn't allow this (it needs ${perm}); ask someone who can change your role` : "your role doesn't allow this; ask someone who can change your role";
  }
  if (code === 'target_not_admin') return 'make them an admin first';
  return undefined;
}

export class McError extends OrbitError {
  constructor(status, code, message, body) {
    super(message, { code: code ?? `http_${status}`, exitCode: 1, hint: permissionHint(code, body) });
    this.name = 'McError';
    this.status = status;
    this.body = body;
  }
}
