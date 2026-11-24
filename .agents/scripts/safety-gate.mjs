import fs from 'node:fs';

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function checkCommandSafety(args) {
  const cmd = String(args?.CommandLine || '');
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
  if (args?.BypassSandbox === true) {
    return { decision: 'ask', reason: '[FieldCast Security Gate] BypassSandbox requires standard confirmation.' };
  }
  return { decision: 'allow' };
}

function checkWriteSafety(args) {
  const filePath = args?.Path || args?.path || '';
  const normalized = String(filePath).replace(/\\/g, '/');
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
  return { decision: 'allow' };
}

const payload = readStdinJson();
const eventName = payload.hookEventName || '';
const toolName = payload.toolCall?.name || '';
const args = payload.toolCall?.args || {};

let response = {};
if (eventName === 'PreToolUse') {
  if (toolName === 'run_command') {
    response = checkCommandSafety(args);
  } else if (toolName === 'write_file' || toolName === 'edit_file') {
    response = checkWriteSafety(args);
  } else {
    response = { decision: 'allow' };
  }
}

process.stdout.write(JSON.stringify(response));