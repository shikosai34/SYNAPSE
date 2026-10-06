/**
 * 2026-10-03: lockfile の開発・optional・間接依存も npm/OSV と照合する。
 * audit サービスの失敗を「脆弱性なし」に変換せず、例外は advisory/版/期限で限定する。
 */
import { readFile, writeFile } from "node:fs/promises";

export const USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0";
export type PackageVersion = { name: string; version: string };
export type Finding = PackageVersion & {
  id: string;
  severity: string;
  title: string;
  url: string;
  sources: string[];
};
export type Exception = {
  id: string;
  package: string;
  versions: string[];
  expires: string;
  reason: string;
  issue: string;
};
type Advisory = {
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
};

export function lockedPackages(source: string): PackageVersion[] {
  const lock = Bun.JSON5.parse(source);
  if (!lock.packages || typeof lock.packages !== "object") throw new Error("Missing lockfile packages");
  const packages = new Map<string, PackageVersion>();
  for (const value of Object.values(lock.packages)) {
    if (!Array.isArray(value) || typeof value[0] !== "string") throw new Error("Invalid lockfile package entry");
    const descriptor = value[0];
    if (descriptor.includes("@workspace:")) continue;
    const split = descriptor.lastIndexOf("@");
    if (split <= 0) throw new Error(`Unsupported package descriptor: ${descriptor}`);
    const name = descriptor.slice(0, split);
    const version = descriptor.slice(split + 1);
    // npm の正確なバージョン以外を silently skip すると監査漏れになる。
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error(`Unsupported package version: ${descriptor}`);
    packages.set(descriptor, { name, version });
  }
  return [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export function npmFindings(packages: PackageVersion[], advisories: Record<string, Advisory[]>): Finding[] {
  return packages.flatMap(({ name, version }) => (advisories[name] ?? [])
    .filter((advisory) => Bun.semver.satisfies(version, advisory.vulnerable_versions))
    .map((advisory) => {
      const id = advisory.url.match(/GHSA-[\w-]+/)?.[0];
      if (!id) throw new Error(`Unknown npm advisory identity: ${advisory.url}`);
      return { name, version, id, severity: advisory.severity, title: advisory.title, url: advisory.url, sources: ["npm"] };
    }));
}

export function applyExceptions(findings: Finding[], exceptions: Exception[], now = new Date()) {
  const accepted = new Set<string>();
  for (const exception of exceptions) {
    if (!exception.id || !exception.package || !exception.versions?.length || !exception.reason || !exception.issue ||
      !/^\d{4}-\d{2}-\d{2}$/.test(exception.expires)) throw new Error("Incomplete security exception");
    // 有効期限の日を UTC の終端まで有効とし、翌日から必ず失敗させる。
    const deadline = Date.parse(`${exception.expires}T23:59:59Z`);
    if (!Number.isFinite(deadline) || now.getTime() > deadline) throw new Error(`Expired security exception: ${exception.id} (${exception.expires})`);
    for (const version of exception.versions) accepted.add(`${exception.id}|${exception.package}|${version}`);
  }
  return {
    actionable: findings.filter((finding) => !accepted.has(`${finding.id}|${finding.name}|${finding.version}`)),
    excepted: findings.filter((finding) => accepted.has(`${finding.id}|${finding.name}|${finding.version}`)),
  };
}

async function requestJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Security audit service returned ${response.status}: ${new URL(url).hostname}`);
  return response.json();
}

async function main() {
  const packages = lockedPackages(await readFile("bun.lock", "utf8"));
  const request: Record<string, string[]> = {};
  for (const { name, version } of packages) (request[name] ??= []).push(version);
  const [npm, osv] = await Promise.all([
    requestJson("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", request),
    Promise.all(Array.from({ length: Math.ceil(packages.length / 1000) }, (_, index) => {
      const batch = packages.slice(index * 1000, (index + 1) * 1000);
      return requestJson("https://api.osv.dev/v1/querybatch", {
        queries: batch.map(({ name, version }) => ({ package: { name, ecosystem: "npm" }, version })),
      }).then((response) => {
        if (!Array.isArray(response.results) || response.results.length !== batch.length) throw new Error("Incomplete OSV response");
        return response.results;
      });
    })).then((results) => results.flat()),
  ]);
  if (!npm || typeof npm !== "object" || Array.isArray(npm)) throw new Error("Invalid npm audit response");
  const findings = new Map(npmFindings(packages, npm).map((finding) => [`${finding.id}|${finding.name}|${finding.version}`, finding]));
  for (let index = 0; index < osv.length; index++) {
    for (const vuln of osv[index].vulns ?? []) {
      if (typeof vuln.id !== "string") throw new Error("Invalid OSV advisory identity");
      const { name, version } = packages[index]!;
      const key = `${vuln.id}|${name}|${version}`;
      const existing = findings.get(key);
      if (existing) existing.sources.push("OSV");
      else findings.set(key, { name, version, id: vuln.id, severity: "unknown", title: "OSV advisory", url: `https://osv.dev/vulnerability/${vuln.id}`, sources: ["OSV"] });
    }
  }
  const config = JSON.parse(await readFile("scripts/security-exceptions.json", "utf8"));
  if (config.schemaVersion !== 1 || !Array.isArray(config.exceptions)) throw new Error("Invalid security exceptions configuration");
  const result = applyExceptions([...findings.values()], config.exceptions);
  const report = { scannedAt: new Date().toISOString(), packages: packages.length, advisories: new Set([...findings.values()].map((finding) => finding.id)).size, ...result };
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const output = process.argv[outputIndex + 1];
    if (!output || output.startsWith("--")) throw new Error("--output requires a path");
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(`Dependency audit: ${packages.length} package versions; ${report.advisories} advisories; ${result.actionable.length} actionable; ${result.excepted.length} time-limited exceptions.`);
  for (const finding of result.actionable) console.error(`${finding.severity}: ${finding.name}@${finding.version} ${finding.id} ${finding.url}`);
  for (const finding of result.excepted) console.log(`Exception: ${finding.name}@${finding.version} ${finding.id} (see scripts/security-exceptions.json)`);
  if (result.actionable.length) process.exitCode = 1;
}

if (import.meta.main) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
