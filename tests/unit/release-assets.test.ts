// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The names the release assets get, and what latest.json points at, read from
// the workflow itself (.github/workflows/release.yml) and computed the way
// tauri-action computes them. The rules below are a port of tauri-action at
// tag action-v1.0.0 (commit 1deb371), the version the workflow pins; each one
// cites the file and lines it comes from. A test here checks that the port
// reproduces the names and the latest.json of the published v0.1.0 release,
// which used tauri's default names, before it is trusted with the new ones.

const ROOT = process.cwd();
const WORKFLOW = readFileSync(resolve(ROOT, ".github/workflows/release.yml"), "utf8");
const CONF = JSON.parse(readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as TauriConf;
const VERSION = CONF.version;

/** The owner's names, one per build (2026-10-04). */
const OWNER_PATTERNS: Record<string, string> = {
  "macOS (Apple silicon)": "[name]_[version]_apple_silicon[ext]",
  "macOS (Intel)": "[name]_[version]_apple_intel[ext]",
  Linux: "[name]_[version]_linux_ubuntu_amd64[ext]",
  Windows: "[name]_[version]_windows_x64[ext]",
};

/** What `finalise` adds to every release, beside what the builds upload. */
const FINALISE_ASSETS = ["latest.json", "SHA256SUMS"];

interface TauriConf {
  productName: string;
  version: string;
  bundle: {
    createUpdaterArtifacts?: boolean | "v1Compatible";
    linux?: { rpm?: { release?: string } };
    windows?: { wix?: { language?: string | string[] | Record<string, unknown> } };
  };
}

// --- The workflow, read as text -------------------------------------------

interface MatrixEntry {
  platform: string;
  args: string;
  name: string;
  /** The raw value as written, quotes included. */
  rawPattern: string | undefined;
  pattern: string | undefined;
}

function unquote(raw: string): string {
  const quoted = /^'(.*)'$/.exec(raw) ?? /^"(.*)"$/.exec(raw);
  return quoted ? quoted[1] : raw;
}

/** The build matrix's entries. A YAML parser is not a dependency; the shape is fixed and checked. */
function matrix(text: string): MatrixEntry[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^\s+include:\s*$/.test(line));
  expect(start, "release.yml has a matrix with `include:`").toBeGreaterThan(0);
  const entries: Record<string, string>[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("#")) continue;
    const item = /^\s+- (\w+):\s*(.*)$/.exec(line);
    const field = /^\s{12,}(\w+):\s*(.*)$/.exec(line);
    if (item) entries.push({ [item[1]]: item[2].trim() });
    else if (field && entries.length > 0) entries[entries.length - 1][field[1]] = field[2].trim();
    else if (line.trim() !== "") break;
  }
  return entries.map((entry) => ({
    platform: unquote(entry.platform ?? ""),
    args: unquote(entry.args ?? ""),
    name: unquote(entry.name ?? ""),
    rawPattern: entry.assetPattern,
    pattern: entry.assetPattern === undefined ? undefined : unquote(entry.assetPattern),
  }));
}

/** A step's lines, from its `- name:` to the next step or job. */
function step(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(start, `release.yml has a step named "${name}"`).toBeGreaterThan(0);
  const indent = lines[start].indexOf("-");
  const end = lines.findIndex(
    (line, i) => i > start && line.trim() !== "" && line.search(/\S/) <= indent && !line.trim().startsWith("#"),
  );
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/**
 * The keys written directly under a step's `key:` (its `with:` inputs, say),
 * each as `name: value`: a line deeper in, such as the text of a `|` block,
 * is not one of them, and the block ends at the step's next key.
 */
function children(stepText: string, key: string): string[] {
  const lines = stepText.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^\\s+${key}:\\s*$`).test(line));
  expect(start, `the step has a "${key}:" block`).toBeGreaterThan(0);
  const indent = lines[start].search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const at = line.search(/\S/);
    if (at >= 0 && at <= indent && !line.trim().startsWith("#")) break;
    body.push(line);
  }
  const keys = body.filter((line) => /^\s*[A-Za-z][\w-]*:/.test(line));
  const depth = Math.min(...keys.map((line) => line.search(/\S/)));
  return keys.filter((line) => line.search(/\S/) === depth).map((line) => line.trim());
}

/** The Python that `finalise` runs to rewrite latest.json, as the shell receives it. */
function rewriteScript(text: string): string {
  const lines = text.split("\n");
  const open = lines.findIndex((line) => line.includes("python3 - <<'REWRITE'"));
  expect(open, "finalise feeds a REWRITE heredoc to python3").toBeGreaterThan(0);
  // The `run: |` block's indentation, which YAML strips before the shell sees it.
  const indent = lines[open].search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(open + 1)) {
    const dedented = line.slice(indent);
    if (dedented === "REWRITE") return `${body.join("\n")}\n`;
    body.push(dedented);
  }
  throw new Error("the REWRITE heredoc is never closed");
}

// --- tauri-action at action-v1.0.0, ported ----------------------------------

/** src/utils.ts:29-49. Order matters: a file's [ext] is the first entry its name contains. */
const EXTENSIONS = [
  ".app.tar.gz.sig", ".app.tar.gz", ".dmg", ".AppImage.tar.gz.sig", ".AppImage.tar.gz", ".AppImage.sig",
  ".AppImage", ".deb.sig", ".deb", ".rpm.sig", ".rpm", ".msi.zip.sig", ".msi.zip", ".msi.sig", ".msi",
  ".nsis.zip.sig", ".nsis.zip", ".exe.sig", ".exe",
];

interface Info {
  name: string;
  version: string;
  wixLanguages: string[];
  rpmRelease: string;
}

interface Artifact {
  path: string;
  name: string;
  mode: string;
  platform: string;
  arch: string;
  bundle: string;
  ext: string;
  version: string;
  setup: string;
  _setup: string;
}

type Target = { platform: "macos" | "linux" | "windows"; arch: string };

/** src/utils.ts:520-575 getInfo: productName, version, the WiX languages (default en-US), the rpm release. */
function infoOf(conf: TauriConf): Info {
  const language = conf.bundle.windows?.wix?.language ?? "en-US";
  const wixLanguages = typeof language === "string" ? [language] : Array.isArray(language) ? language : Object.keys(language);
  return { name: conf.productName, version: conf.version, wixLanguages, rpmRelease: conf.bundle.linux?.rpm?.release ?? "1" };
}

/** src/utils.ts:583-617 getTargetInfo: `--target` names it, else the runner (x64 on ubuntu-22.04 and windows-latest). */
function targetOf(entry: MatrixEntry): Target {
  const triple = /--target\s+(\S+)/.exec(entry.args)?.[1];
  const platform = entry.platform.startsWith("macos") ? "macos" : entry.platform.startsWith("windows") ? "windows" : "linux";
  return { platform, arch: triple ? triple.split("-")[0] : "x64" };
}

/** src/utils.ts:150-200 createArtifact. */
function createArtifact(info: Info, target: Target, path: string, arch: string, bundle: string): Artifact {
  const ext = EXTENSIONS.find((candidate) => basename(path).includes(candidate)) ?? extname(path);
  return {
    path,
    name: info.name,
    mode: "release",
    platform: target.platform === "macos" ? "darwin" : target.platform,
    arch,
    bundle,
    ext,
    version: info.version,
    setup: bundle === "nsis" ? "-setup" : "",
    _setup: bundle === "nsis" ? "_setup" : "",
  };
}

/**
 * src/build.ts:74-322: every file the action looks for, then only those a
 * build with `createUpdaterArtifacts: true` writes (build.ts:517 keeps the ones
 * that exist): no .msi.zip, .nsis.zip or .AppImage.tar.gz, which only the v1
 * updater format has; the .msi.sig of the first WiX language only
 * (build.ts:121-122); and no .app directory, which index.ts:69-97 drops
 * because its .app.tar.gz exists.
 */
function artifactsOf(info: Info, target: Target): Artifact[] {
  const { name, version } = info;
  const make = (path: string, arch: string, bundle: string) => createArtifact(info, target, path, arch, bundle);
  if (target.platform === "macos") {
    const arch = target.arch === "x86_64" ? "x64" : target.arch === "arm64" ? "aarch64" : target.arch;
    return [
      make(`bundle/dmg/${name}_${version}_${arch}.dmg`, arch, "dmg"),
      make(`bundle/macos/${name}.app.tar.gz`, arch, "app"),
      make(`bundle/macos/${name}.app.tar.gz.sig`, arch, "app"),
    ];
  }
  if (target.platform === "windows") {
    const arch = target.arch.startsWith("i") ? "x86" : target.arch === "aarch64" || target.arch === "arm64" ? "arm64" : "x64";
    return [
      ...info.wixLanguages.flatMap((lang, i) => [
        make(`bundle/msi/${name}_${version}_${arch}_${lang}.msi`, arch, "msi"),
        ...(i === 0 ? [make(`bundle/msi/${name}_${version}_${arch}_${lang}.msi.sig`, arch, "msi")] : []),
      ]),
      make(`bundle/nsis/${name}_${version}_${arch}-setup.exe`, arch, "nsis"),
      make(`bundle/nsis/${name}_${version}_${arch}-setup.exe.sig`, arch, "nsis"),
    ];
  }
  const x64 = target.arch === "x64" || target.arch === "x86_64";
  const debianArch = x64 ? "amd64" : target.arch;
  const rpmArch = x64 ? "x86_64" : target.arch;
  return [
    make(`bundle/deb/${name}_${version}_${debianArch}.deb`, debianArch, "deb"),
    make(`bundle/deb/${name}_${version}_${debianArch}.deb.sig`, debianArch, "deb"),
    make(`bundle/rpm/${name}-${version}-${info.rpmRelease}.${rpmArch}.rpm`, rpmArch, "rpm"),
    make(`bundle/rpm/${name}-${version}-${info.rpmRelease}.${rpmArch}.rpm.sig`, rpmArch, "rpm"),
    make(`bundle/appimage/${name}_${version}_${debianArch}.AppImage`, debianArch, "appimage"),
    make(`bundle/appimage/${name}_${version}_${debianArch}.AppImage.sig`, debianArch, "appimage"),
  ];
}

/** src/utils.ts:74-85: `[key]` becomes the artifact's field of that name; an unknown key is left as written. */
function renderNamePattern(pattern: string, replacements: Record<string, string>): string {
  return pattern.replace(/\[(\w+)]/g, (match, key: string) => (Object.hasOwn(replacements, key) ? replacements[key] : match));
}

/** src/utils.ts:87-138, the desktop branches: the label tauri-action uploads under. */
function getAssetName(artifact: Artifact, pattern?: string): string {
  if (artifact.name === "latest.json") return "latest.json";
  if (pattern) return renderNamePattern(pattern, artifact as unknown as Record<string, string>);
  if (artifact.ext !== ".app.tar.gz" && artifact.ext !== ".app.tar.gz.sig") return basename(artifact.path);
  return `${artifact.name}_${artifact.version}_${artifact.arch}${artifact.ext}`;
}

/** src/utils.ts:140-148: the name GitHub stores, with anything outside [A-Za-z0-9_-] as a dot. */
function ghAssetName(artifact: Artifact, pattern?: string): string {
  return getAssetName(artifact, pattern).trim().replace(/[^a-zA-Z0-9_-]/g, ".").replace(/\.\./g, ".");
}

/**
 * src/upload-version-json.ts:109-272, for builds that are not universal:
 * each .sig is paired with the uploaded file named like it without `.sig`;
 * the highest-priority signature (`.AppImage.sig`, then `.msi.sig`, then
 * `.exe.sig`: :153-176, with `createUpdaterArtifacts: true` meaning unzipped
 * signatures) also gives the plain `{os}-{arch}` key. Answers key → asset name,
 * and the signatures that found no file.
 */
function latestJsonOf(target: Target, artifacts: Artifact[], pattern?: string) {
  const uploaded = artifacts.filter((a) => !a.ext.endsWith(".sig"));
  const priority = (path: string): number => {
    if (path.endsWith(".AppImage.sig")) return 100;
    const order = [".msi.sig", ".exe.sig"];
    const at = order.findIndex((ext) => path.endsWith(ext));
    return at < 0 ? 0 : 100 - at;
  };
  const signatures = artifacts.filter((a) => a.ext.endsWith(".sig")).sort((a, b) => priority(b.path) - priority(a.path));
  const platforms: Record<string, string> = {};
  const unpaired: string[] = [];
  signatures.forEach((sig, idx) => {
    const label = getAssetName(sig, pattern);
    const name = ghAssetName(sig, pattern);
    const file = uploaded.find(
      (a) => getAssetName(a, pattern) === basename(label, extname(label)) || ghAssetName(a, pattern) === basename(name, extname(name)),
    );
    if (!file) {
      unpaired.push(name);
      return;
    }
    const os = target.platform === "macos" ? "darwin" : target.platform;
    const arch = ["amd64", "x86_64", "x64"].includes(sig.arch) ? "x86_64" : sig.arch === "arm64" ? "aarch64" : sig.arch;
    if (idx === 0) platforms[`${os}-${arch}`] = ghAssetName(file, pattern);
    platforms[`${os}-${arch}-${sig.bundle}`] = ghAssetName(file, pattern);
  });
  return { platforms, unpaired };
}

/** Every name given to more than one file. */
function collisions(names: string[]): string[] {
  return [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
}

interface Job {
  entry: MatrixEntry;
  target: Target;
  artifacts: Artifact[];
}

function jobsOf(conf: TauriConf, entries: MatrixEntry[] = matrix(WORKFLOW)): Job[] {
  const info = infoOf(conf);
  return entries.map((entry) => ({ entry, target: targetOf(entry), artifacts: artifactsOf(info, targetOf(entry)) }));
}

const names = (jobs: Job[], usePattern: boolean): string[] =>
  jobs.flatMap((job) => job.artifacts.map((a) => ghAssetName(a, usePattern ? job.entry.pattern : undefined)));

const latestJson = (jobs: Job[], usePattern: boolean) => {
  const merged = { platforms: {} as Record<string, string>, unpaired: [] as string[] };
  for (const job of jobs) {
    const { platforms, unpaired } = latestJsonOf(job.target, job.artifacts, usePattern ? job.entry.pattern : undefined);
    Object.assign(merged.platforms, platforms);
    merged.unpaired.push(...unpaired);
  }
  return merged;
};

// --- The tests ----------------------------------------------------------------

describe("the port of tauri-action", () => {
  it("is of the version the workflow pins, for the bundles this config makes", () => {
    for (const name of ["Build and upload", "Build only (dry run)"]) {
      expect(step(WORKFLOW, name)).toContain("uses: tauri-apps/tauri-action@action-v1.0.0");
    }
    // The rules above assume signed installers, not the v1 zip archives.
    expect(CONF.bundle.createUpdaterArtifacts).toBe(true);
  });

  it("reproduces the names and the latest.json of the published v0.1.0, which had no pattern", () => {
    const jobs = jobsOf({ ...CONF, version: "0.1.0" });
    expect(names(jobs, false).sort()).toEqual(
      [
        "Versorium-0.1.0-1.x86_64.rpm", "Versorium-0.1.0-1.x86_64.rpm.sig",
        "Versorium_0.1.0_aarch64.app.tar.gz", "Versorium_0.1.0_aarch64.app.tar.gz.sig", "Versorium_0.1.0_aarch64.dmg",
        "Versorium_0.1.0_amd64.AppImage", "Versorium_0.1.0_amd64.AppImage.sig",
        "Versorium_0.1.0_amd64.deb", "Versorium_0.1.0_amd64.deb.sig",
        "Versorium_0.1.0_x64-setup.exe", "Versorium_0.1.0_x64-setup.exe.sig",
        "Versorium_0.1.0_x64.app.tar.gz", "Versorium_0.1.0_x64.app.tar.gz.sig", "Versorium_0.1.0_x64.dmg",
        "Versorium_0.1.0_x64_en-US.msi", "Versorium_0.1.0_x64_en-US.msi.sig",
      ].sort(),
    );
    // gh release download v0.1.0 --pattern latest.json, each id resolved to its asset's name.
    expect(latestJson(jobs, false)).toEqual({
      platforms: {
        "darwin-aarch64": "Versorium_0.1.0_aarch64.app.tar.gz",
        "darwin-aarch64-app": "Versorium_0.1.0_aarch64.app.tar.gz",
        "darwin-x86_64": "Versorium_0.1.0_x64.app.tar.gz",
        "darwin-x86_64-app": "Versorium_0.1.0_x64.app.tar.gz",
        "linux-x86_64": "Versorium_0.1.0_amd64.AppImage",
        "linux-x86_64-appimage": "Versorium_0.1.0_amd64.AppImage",
        "linux-x86_64-deb": "Versorium_0.1.0_amd64.deb",
        "linux-x86_64-rpm": "Versorium-0.1.0-1.x86_64.rpm",
        "windows-x86_64": "Versorium_0.1.0_x64_en-US.msi",
        "windows-x86_64-msi": "Versorium_0.1.0_x64_en-US.msi",
        "windows-x86_64-nsis": "Versorium_0.1.0_x64-setup.exe",
      },
      unpaired: [],
    });
  });
});

describe("the names each build gives its files", () => {
  it("are set per build and handed to the tag build's tauri-action", () => {
    const entries = matrix(WORKFLOW);
    expect(entries.map((e) => e.name).sort()).toEqual(Object.keys(OWNER_PATTERNS).sort());
    for (const entry of entries) {
      // Unquoted, `[name]_…` starts a YAML flow sequence and is not a string.
      expect(entry.rawPattern, `${entry.name}: assetPattern, quoted`).toMatch(/^'[^']*'$|^"[^"]*"$/);
      expect(entry.pattern, entry.name).toBe(OWNER_PATTERNS[entry.name]);
    }
    // An input of the action, under `with:`: as an environment variable, or in
    // the text of another input, tauri-action would never read it.
    expect(children(step(WORKFLOW, "Build and upload"), "with")).toContain(
      "releaseAssetNamePattern: ${{ matrix.assetPattern }}",
    );
  });

  it("say which computer each file is for, and no two are alike", () => {
    const jobs = jobsOf(CONF);
    const v = VERSION;
    const all = names(jobs, true);
    expect(all.sort()).toEqual(
      [
        `Versorium_${v}_apple_silicon.dmg`, `Versorium_${v}_apple_silicon.app.tar.gz`, `Versorium_${v}_apple_silicon.app.tar.gz.sig`,
        `Versorium_${v}_apple_intel.dmg`, `Versorium_${v}_apple_intel.app.tar.gz`, `Versorium_${v}_apple_intel.app.tar.gz.sig`,
        `Versorium_${v}_windows_x64.msi`, `Versorium_${v}_windows_x64.msi.sig`,
        `Versorium_${v}_windows_x64.exe`, `Versorium_${v}_windows_x64.exe.sig`,
        `Versorium_${v}_linux_ubuntu_amd64.deb`, `Versorium_${v}_linux_ubuntu_amd64.deb.sig`,
        `Versorium_${v}_linux_ubuntu_amd64.rpm`, `Versorium_${v}_linux_ubuntu_amd64.rpm.sig`,
        `Versorium_${v}_linux_ubuntu_amd64.AppImage`, `Versorium_${v}_linux_ubuntu_amd64.AppImage.sig`,
      ].sort(),
    );
    // A clash between builds is silent loss: upload-release-assets.ts:54-65
    // deletes an asset of the same name before uploading, so a later build
    // replaces an earlier one's file. Within one build the listing it checks
    // was read before the first upload, so GitHub refuses the second file and
    // the job fails.
    expect(collisions([...all, ...FINALISE_ASSETS])).toEqual([]);
    // GitHub keeps the name as given, so the name and the label agree.
    for (const job of jobs) {
      for (const artifact of job.artifacts) {
        expect(getAssetName(artifact, job.entry.pattern)).toBe(ghAssetName(artifact, job.entry.pattern));
        expect(getAssetName(artifact, job.entry.pattern)).toMatch(/^[A-Za-z0-9._-]+$/);
      }
    }
    // tauri-action reads the release's assets one page at a time (50 a page in
    // upload-version-json.ts:57-62); a release must fit in that page.
    expect(all.length + FINALISE_ASSETS.length).toBeLessThanOrEqual(50);
  });

  it("keep latest.json pointing at the installer each platform updates with", () => {
    const v = VERSION;
    expect(latestJson(jobsOf(CONF), true)).toEqual({
      platforms: {
        "darwin-aarch64": `Versorium_${v}_apple_silicon.app.tar.gz`,
        "darwin-aarch64-app": `Versorium_${v}_apple_silicon.app.tar.gz`,
        "darwin-x86_64": `Versorium_${v}_apple_intel.app.tar.gz`,
        "darwin-x86_64-app": `Versorium_${v}_apple_intel.app.tar.gz`,
        "linux-x86_64": `Versorium_${v}_linux_ubuntu_amd64.AppImage`,
        "linux-x86_64-appimage": `Versorium_${v}_linux_ubuntu_amd64.AppImage`,
        "linux-x86_64-deb": `Versorium_${v}_linux_ubuntu_amd64.deb`,
        "linux-x86_64-rpm": `Versorium_${v}_linux_ubuntu_amd64.rpm`,
        "windows-x86_64": `Versorium_${v}_windows_x64.msi`,
        "windows-x86_64-msi": `Versorium_${v}_windows_x64.msi`,
        "windows-x86_64-nsis": `Versorium_${v}_windows_x64.exe`,
      },
      unpaired: [],
    });
  });

  it("hold for a pre-release version too", () => {
    const jobs = jobsOf({ ...CONF, version: "0.2.0-1" });
    const all = names(jobs, true);
    expect(all).toContain("Versorium_0.2.0-1_apple_silicon.app.tar.gz");
    expect(collisions(all)).toEqual([]);
    expect(latestJson(jobs, true).unpaired).toEqual([]);
  });

  it("would collide with a second WiX language, so the config has one", () => {
    // Each language is its own .msi, and [ext] drops the `_en-US` that told them apart.
    const two: TauriConf = { ...CONF, bundle: { ...CONF.bundle, windows: { wix: { language: ["en-US", "es-ES"] } } } };
    expect(collisions(names(jobsOf(two), true))).toEqual([`Versorium_${VERSION}_windows_x64.msi`]);
    expect(infoOf(CONF).wixLanguages).toHaveLength(1);
  });

  it("would collide without [ext], which is how this check could fail", () => {
    const entries = matrix(WORKFLOW).map((e) => ({ ...e, pattern: e.pattern?.replace("[ext]", "") }));
    const jobs = jobsOf(CONF, entries);
    expect(collisions(names(jobs, true))).toHaveLength(4);
    expect(latestJson(jobs, true).unpaired.length).toBeGreaterThan(0);
  });
});

describe("finalise, with the new names", () => {
  const REPO = "MAECLY/versorium-app";
  const API = `https://api.github.com/repos/${REPO}/releases/assets/`;
  const SCRIPT = rewriteScript(WORKFLOW);
  const dirs: string[] = [];
  let seq = 0;

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** The release's own listing: every asset the builds uploaded, with ids, and the first latest.json. */
  const listing = () => [
    ...names(jobsOf(CONF), true).map((name, i) => ({ name, id: 7000 + i })),
    { name: "latest.json", id: 6999 },
  ];

  /** Runs the step's Python as the runner would, in a folder of its own. */
  function rewrite(platforms: Record<string, string>) {
    const dir = resolve(ROOT, `tests/scratch/out/release-finalise-${process.pid}-${seq++}`);
    dirs.push(dir);
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "release-assets.json"), JSON.stringify(listing()));
    const manifest = {
      version: VERSION,
      platforms: Object.fromEntries(Object.entries(platforms).map(([key, url]) => [key, { signature: "sig", url }])),
    };
    writeFileSync(join(dir, "assets", "latest.json"), JSON.stringify(manifest));
    const run = spawnSync("python3", ["-"], { input: SCRIPT, cwd: dir, env: { ...process.env, REPO }, encoding: "utf8" });
    expect(run.error, "python3 runs").toBeUndefined();
    let written: Record<string, { url: string }> | null = null;
    if (run.status === 0) written = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")).platforms;
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, written };
  }

  const idOf = (name: string) => listing().find((asset) => asset.name === name)?.id;
  const silicon = `Versorium_${VERSION}_apple_silicon.app.tar.gz`;
  const nsis = `Versorium_${VERSION}_windows_x64.exe`;

  it("accepts the API URLs tauri-action writes, when they are assets of this release", () => {
    const result = rewrite({ "darwin-aarch64": `${API}${idOf(silicon)}`, "windows-x86_64-nsis": `${API}${idOf(nsis)}` });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.written?.["darwin-aarch64"].url).toBe(`${API}${idOf(silicon)}`);
    expect(result.written?.["windows-x86_64-nsis"].url).toBe(`${API}${idOf(nsis)}`);
  });

  it("rewrites a browser URL to the API one, by the asset's new name", () => {
    const browser = `https://github.com/${REPO}/releases/download/v${VERSION}/`;
    const result = rewrite({ "darwin-aarch64": `${browser}${silicon}`, "windows-x86_64-nsis": `${browser}${nsis}` });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.written?.["darwin-aarch64"].url).toBe(`${API}${idOf(silicon)}`);
    expect(result.written?.["windows-x86_64-nsis"].url).toBe(`${API}${idOf(nsis)}`);
  });

  it("refuses a file this release does not have, by name or by id", () => {
    const old = `Versorium_${VERSION}_aarch64.app.tar.gz`;
    const byName = rewrite({ "darwin-aarch64": `https://github.com/${REPO}/releases/download/v${VERSION}/${old}` });
    expect(byName.status).toBe(1);
    expect(byName.stdout).toContain(`::error::latest.json names ${old} for darwin-aarch64, which is not an asset of this release`);
    const byId = rewrite({ "darwin-aarch64": `${API}1` });
    expect(byId.status).toBe(1);
    expect(byId.stdout).toContain("::error::latest.json names 1 for darwin-aarch64");
  });
});
