import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { log, error } from 'node:console';

/** Parse a v-prefixed SemVer tag used for Windows release names; reject invalid identifiers. */
export function releaseIdentity(tag) {
  const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)$/.exec(tag);
  if (!match || match[2]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error(`Invalid release tag: ${tag}. Expected vX.Y.Z or vX.Y.Z-prerelease.`);
  }
  return { tag, version: match[1], prerelease: !!match[2] };
}

/** Read manifests and dated changelog notes. Throws before build if any release input is inconsistent. */
export function inspectRelease(root, tag) {
  const identity = releaseIdentity(tag);
  const text = path => readFileSync(join(root, path), 'utf8');
  const npm = JSON.parse(text('package.json'));
  const lock = JSON.parse(text('package-lock.json'));
  const cargo = text('src-tauri/Cargo.toml').split(/(?=^\[)/m).find(section => section.startsWith('[package]')) ?? '';
  const cargoLock = text('src-tauri/Cargo.lock').split('[[package]]').find(section => /^name = "key-relay"\s*$/m.test(section)) ?? '';
  const versions = {
    'package.json': npm.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'src-tauri/tauri.conf.json': JSON.parse(text('src-tauri/tauri.conf.json')).version,
    'src-tauri/Cargo.toml': cargo.match(/^version = "([^"]+)"\s*$/m)?.[1],
    'src-tauri/Cargo.lock key-relay': cargoLock.match(/^version = "([^"]+)"\s*$/m)?.[1],
  };
  for (const [source, version] of Object.entries(versions)) {
    if (version !== identity.version) throw new Error(`Version mismatch: ${source} has ${version}, tag requires ${identity.version}.`);
  }
  const changelog = text('CHANGELOG.md').replace(/\r\n/g, '\n');
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gm)];
  const matching = headings.filter(heading => heading[1] === identity.version);
  if (matching.length !== 1) throw new Error(`CHANGELOG.md must contain exactly one [${identity.version}] release entry.`);
  const heading = matching[0];
  const date = /^ - (\d{4}-\d{2}-\d{2})$/.exec(heading[2])?.[1];
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!date || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error('CHANGELOG.md release heading requires a valid YYYY-MM-DD date.');
  }
  const next = headings[headings.indexOf(heading) + 1]?.index ?? changelog.length;
  const notes = changelog.slice(heading.index + heading[0].length, next).replace(/^\[[^\]]+\]:.*$/gm, '').trim();
  if (!/^### (Added|Changed|Deprecated|Removed|Fixed|Security)$/m.test(notes) || !/^- \S.+$/m.test(notes)) {
    throw new Error('CHANGELOG.md release entry requires a category and a nonempty change item.');
  }
  return { ...identity, notes: `${notes}\n` };
}

/** Copy this version's build outputs and notes into target/release-assets/<tag>, with SHA-256 sums. */
export function bundleRelease(root, tag) {
  const release = inspectRelease(root, tag);
  const installer = `key-relay_${release.version}_x64-setup.exe`;
  const builtInstaller = `src-tauri/target/release/bundle/nsis/Key Relay_${release.version}_x64-setup.exe`;
  const sources = [
    [installer, builtInstaller],
    ['key-relay.exe', 'src-tauri/target/release/key-relay.exe'],
    [`${installer}.sig`, `${builtInstaller}.sig`],
  ];
  const binaries = sources.map(([name, path]) => {
    const bytes = readFileSync(join(root, path));
    if (!bytes.length) throw new Error(`Empty release binary: ${path}`);
    return { name, bytes };
  });
  const manifest = {
    version: release.version, notes: release.notes, pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': {
      signature: binaries[2].bytes.toString('utf8').trim(),
      url: `https://github.com/sunnyx11/key-relay/releases/download/${tag}/${encodeURIComponent(installer)}`,
    } },
  };
  if (!manifest.platforms['windows-x86_64'].signature) throw new Error('Empty updater signature.');
  binaries.push({ name: 'latest.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  const output = join(root, 'src-tauri/target/release-assets', tag);
  mkdirSync(output, { recursive: true });
  for (const { name, bytes } of binaries) writeFileSync(join(output, name), bytes);
  writeFileSync(join(output, 'SHA256SUMS.txt'), binaries.map(({ name, bytes }) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`).join(''));
  writeFileSync(join(output, 'release-notes.md'), release.notes);
  return output;
}

// CLI: check <tag> prints metadata; bundle <tag> prepares local release files. Neither publishes.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , command, tag, ...extra] = process.argv;
    if (!['check', 'bundle'].includes(command) || !tag || extra.length) throw new Error('Usage: node scripts/release.mjs <check|bundle> <tag>');
    log(command === 'check' ? JSON.stringify(inspectRelease(process.cwd(), tag), null, 2) : bundleRelease(process.cwd(), tag));
  } catch (cause) { error(cause.message); process.exitCode = 1; }
}
