// What the opener plugin lets the page open, worked out the way the real app
// works it out, for the in-browser mock (mock-tauri.ts) and its unit test.
//
// The real `plugin:opener|open_url` passes two checks. Tauri's ACL must allow
// the command for the window that asks, and the plugin's scope must allow the
// address. That scope is the allow and deny entries of the permissions that
// granted the command, plus the plugin's global scope; a denial wins, and with
// no allow entry nothing opens (tauri-plugin-opener 2.6.0, `scope.rs`
// `is_url_allowed`). The mock used to accept every call, so a capability that
// granted the command with no scope passed every E2E test while the real app
// refused every link. This reads the same files the app is built from, so a
// capability that refuses an address in the app refuses it in the mock too.
//
// Mirrors tauri-utils 2.10.0 `acl/resolved.rs` (`Resolved::resolve`,
// `get_permissions`) and tauri-codegen's `get_capabilities`, for one command.
// Platforms are not told apart: the mock is every desktop at once. The Rust
// side is proven by src-tauri/tests/opener_scope.rs.

export interface ScopeEntry {
  url?: string;
  path?: string;
  /** Absent: only when no program is named. `true`: any program. A name: that one. */
  app?: boolean | string | null;
}

interface Scopes {
  allow?: ScopeEntry[];
  deny?: ScopeEntry[];
}

interface Permission {
  identifier: string;
  commands?: { allow?: string[]; deny?: string[] };
  scope?: Scopes;
}

interface PermissionSet {
  identifier: string;
  permissions: string[];
}

export interface Manifest {
  default_permission?: PermissionSet | null;
  permissions: Record<string, Permission>;
  permission_sets: Record<string, PermissionSet>;
}

export type PermissionEntry = string | ({ identifier: string } & Scopes);

export interface Capability {
  identifier: string;
  windows?: string[];
  webviews?: string[];
  /** Defaults to true: the app's own pages. */
  local?: boolean;
  permissions: PermissionEntry[];
}

/** tauri.conf.json's `app.security.capabilities`: names of capability files, or capabilities written inline. */
export type CapabilityEntry = string | Capability;

export interface OpenUrlAccess {
  /** The command is granted to the window and denied by nothing. */
  granted: boolean;
  allow: ScopeEntry[];
  deny: ScopeEntry[];
}

const PLUGIN = "opener";
const COMMAND = "open_url";

/**
 * A UNIX glob (Rust's `glob::Pattern` with its default options, as both
 * Tauri and the plugin use it): `*` is any run of characters, `/` included,
 * and `?` any one. Character classes are refused rather than guessed at.
 */
export function globMatches(pattern: string, input: string): boolean {
  if (pattern.includes("[")) throw new Error(`the mock does not read glob classes: ${pattern}`);
  const source = pattern
    .split("")
    .map((ch) => (ch === "*" ? "[\\s\\S]*" : ch === "?" ? "[\\s\\S]" : ch.replace(/[\\^$.|+(){}]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`).test(input);
}

/** "core:window:allow-destroy" → ["core:window", "allow-destroy"]; the separator is the last colon. */
function split(identifier: string): [string | null, string] {
  const at = identifier.lastIndexOf(":");
  return at < 0 ? [null, identifier] : [identifier.slice(0, at), identifier.slice(at + 1)];
}

interface Traversed {
  key: string;
  permission: Permission;
}

/** `get_permissions`: a permission, a set, or a plugin's `default`, down to permissions. */
function expand(identifier: string, acl: Record<string, Manifest>): Traversed[] {
  const [prefix, base] = split(identifier);
  const key = prefix ?? "__app-acl__";
  const manifest = acl[key];
  if (!manifest) throw new Error(`unknown ACL manifest "${key}" in ${identifier}`);
  if (base === "default") return manifest.default_permission ? expandSet(key, manifest, manifest.default_permission, acl) : [];
  const set = manifest.permission_sets[base];
  if (set) return expandSet(key, manifest, set, acl);
  const permission = manifest.permissions[base];
  if (permission) return [{ key, permission }];
  throw new Error(`unknown permission ${identifier}`);
}

/** `get_permission_set_permissions`: a set may name another plugin's permission ("fs:default"). */
function expandSet(key: string, manifest: Manifest, set: PermissionSet, acl: Record<string, Manifest>): Traversed[] {
  return set.permissions.flatMap((name) => {
    const [prefix] = split(name);
    if (prefix && acl[prefix]) return expand(name, acl);
    if (name === "default") return manifest.default_permission ? expandSet(key, manifest, manifest.default_permission, acl) : [];
    const permission = manifest.permissions[name];
    if (permission) return [{ key, permission }];
    const nested = manifest.permission_sets[name];
    if (nested) return expandSet(key, manifest, nested, acl);
    throw new Error(`set ${set.identifier} names ${name}, which does not exist`);
  });
}

/**
 * tauri-codegen's `get_capabilities`: every capability file, unless
 * tauri.conf.json lists capabilities, and then only those it lists.
 */
export function enabledCapabilities(files: Capability[], listed: CapabilityEntry[] = []): Capability[] {
  if (listed.length === 0) return files;
  return listed.map((entry) => {
    if (typeof entry !== "string") return entry;
    const found = files.find((capability) => capability.identifier === entry);
    if (!found) throw new Error(`tauri.conf.json names capability ${entry}, which no file defines`);
    return found;
  });
}

/**
 * `plugin:opener|open_url` for one window, from the app's own pages.
 * Granting follows the local capabilities that name the window; a denial
 * counts from any local capability, whatever window it names; and the global
 * scope comes from every capability, as Tauri keeps it per plugin, not per
 * window or origin.
 */
export function resolveOpenUrl(capabilities: Capability[], acl: Record<string, Manifest>, window = "main"): OpenUrlAccess {
  let granted = false;
  let denied = false;
  const allow: ScopeEntry[] = [];
  const deny: ScopeEntry[] = [];
  for (const capability of capabilities) {
    const local = capability.local !== false;
    const labels = [...(capability.windows ?? []), ...(capability.webviews ?? [])];
    const forWindow = local && labels.some((label) => globMatches(label, window));
    for (const entry of capability.permissions) {
      const identifier = typeof entry === "string" ? entry : entry.identifier;
      const inline: Scopes = typeof entry === "string" ? {} : entry;
      for (const { key, permission } of expand(identifier, acl)) {
        if (key !== PLUGIN) continue;
        const scopeAllow = [...(inline.allow ?? []), ...(permission.scope?.allow ?? [])];
        const scopeDeny = [...(inline.deny ?? []), ...(permission.scope?.deny ?? [])];
        const commands = { allow: permission.commands?.allow ?? [], deny: permission.commands?.deny ?? [] };
        if (commands.allow.length === 0 && commands.deny.length === 0) {
          // A scope with no command is the plugin's global scope.
          allow.push(...scopeAllow);
          deny.push(...scopeDeny);
          continue;
        }
        if (local && commands.deny.includes(COMMAND)) denied = true;
        if (forWindow && commands.allow.includes(COMMAND)) {
          granted = true;
          allow.push(...scopeAllow);
          deny.push(...scopeDeny);
        }
      }
    }
  }
  return { granted: granted && !denied, allow, deny };
}

/** `Entry::matches_url`: path entries never match an address. */
function matches(entry: ScopeEntry, url: string, program: string | undefined): boolean {
  if (typeof entry.url !== "string") return false;
  const app = entry.app ?? null;
  const byProgram = app === null ? program === undefined : typeof app === "boolean" ? app : app === program;
  return byProgram && globMatches(entry.url, url);
}

/** `Scope::is_url_allowed`. */
export function urlAllowed(access: OpenUrlAccess, url: string, program?: string): boolean {
  if (access.deny.some((entry) => matches(entry, url, program))) return false;
  return access.allow.some((entry) => matches(entry, url, program));
}

/** What the page hears when the plugin refuses an address (`Error::ForbiddenUrl`). */
export function refusal(url: string, program?: string): string {
  return `Not allowed to open url ${url}${program === undefined ? "" : ` with ${program}`}`;
}
