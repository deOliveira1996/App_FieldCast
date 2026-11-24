import fs from 'node:fs';

/**
 * FieldCast runtime security and Write-Scope guard for Antigravity lifecycle hooks.
 * Invoked via `.agents/hooks.json` on PreToolUse / PostToolUse.
 */
function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function checkCommandSafety(commandLine) {
  const cmd = String(commandLine || '');
  const blockedPatterns = [
    { re: /(^|\s)rm\s+-rf\s+(\/|~|\*|\.\.)/i, msg: 'Blocked destructive recursive delete command.' },
    { re: /\bgit\s+push\s+(--force|-f)\b/i, msg: 'Blocked force push; inspect branch state explicitly.' },
    { re: /\bgit\s+reset\s+--hard\b/i, msg: 'Blocked hard git reset inside automated hook.' },
    { re: /\b(format|diskpart|cipher\s+\/w)\b/i, msg: 'Blocked destructive disk command.' },
    {
      re: /(cat|type|get-content|echo)\s+.*\.(env|keystore|jks)\b/i,
      msg: 'Blocked command reading sensitive environment or signing files.',
    },
  ];

  for (const rule of blockedPatterns) {
    if (rule.re.test(cmd)) {
      return { decision: 'deny', reason: `[FieldCast Security Gate] ${rule.msg}` };
    }
  }
  return {};
}

function checkWriteSafety(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (/(^|\/)(\.env(\..*)?|.*\.(keystore|jks|p12|pem|key))$/i.test(normalized)) {
    return {
      decision: 'deny',
      reason: `[FieldCast Security Gate] Refusing direct write to secret/signing artifact: ${normalized}`,
    };
  }

  const scopeEnv = process.env.FIELDCAST_WRITE_SCOPE;
  if (scopeEnv && normalized) {
    const allowedPrefixes = scopeEnv
      .split(',')
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean);
    const matchesScope = allowedPrefixes.some(
      (prefix) => normalized.includes(`/${prefix}`) || normalized.startsWith(prefix),
    );
    if (!matchesScope) {
      return {
        decision: 'deny',
        reason: `[FieldCast Write-Scope Gate] Path '${normalized}' outside assigned scope (${allowedPrefixes.join(', ')}).`,
      };
    }
  }
  return {};
}

const payload = readStdinJson();
const eventName = payload.hookEventName || '';
const toolName = payload.toolCall?.name || '';
const args = payload.toolCall?.args || {};

let response = {};
if (eventName === 'PreToolUse') {
  if (toolName === 'run_command') {
    response = checkCommandSafety(args.CommandLine);
  } else if (toolName === 'write_file' || toolName === 'edit_file') {
    response = checkWriteSafety(args.Path || args.path);
  }
}

process.stdout.write(JSON.stringify(response));
