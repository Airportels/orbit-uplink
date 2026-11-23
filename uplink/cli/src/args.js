// A small argv parser: --flag, --key value, --key=value, positionals. No dependency, no surprises.
export function parseArgs(argv, spec = {}) {
  const booleans = new Set(spec.booleans ?? []);
  const aliases = spec.aliases ?? {};
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('-') || a === '-') { out._.push(a); continue; }
    let key, val;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { key = a.slice(2, eq); val = a.slice(eq + 1); } else key = a.slice(2);
    } else {
      key = aliases[a.slice(1)] ?? a.slice(1);
    }
    if (key.startsWith('no-') && booleans.has(key.slice(3))) { out[key.slice(3)] = false; continue; }
    if (val === undefined) {
      if (booleans.has(key)) val = true;
      else if (i + 1 < argv.length && !(argv[i + 1].startsWith('--') && argv[i + 1].length > 2)) val = argv[++i];
      else val = true;
    }
    out[key] = val;
  }
  return out;
}

export function need(args, key, usage) {
  const v = args[key];
  if (v === undefined || v === true || v === '') {
    const e = new Error(`missing --${key}\nusage: ${usage}`);
    e.exitCode = 2;
    throw e;
  }
  return String(v);
}
