import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

function fixture(t, version = '0.2.0') {
  const root = mkdtempSync(join(tmpdir(), 'key-relay-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  const files = {
    'package.json': JSON.stringify({ name: 'key-relay', version }),
    'package-lock.json': JSON.stringify({ version, packages: { '': { version } } }),
    'src-tauri/tauri.conf.json': JSON.stringify({ version }),
    'src-tauri/Cargo.toml': `[package]\nname = "key-relay"\nversion = "${version}"\n\n[dependencies]\nserde = "1"\n`,
    'src-tauri/Cargo.lock': `version = 4\n\n[[package]]\nname = "dependency"\nversion = "9.0.0"\n\n[[package]]\nname = "key-relay"\nversion = "${version}"\n`,
    'CHANGELOG.md': `# Changelog\n\n## [Unreleased]\n\n### Added\n- Future feature.\n\n## [${version}] - 2026-10-03\n\n### Added\n- 关于页。\n\n## [0.1.0] - 2026-10-01\n\n### Fixed\n- Older change.\n\n[Unreleased]: https://example.com/compare\n[${version}]: https://example.com/release\n`,
  };
  for (const [path, value] of Object.entries(files)) writeFileSync(join(root, path), value);
  return { root, files };
}

test('signed packaging requires both keys and embeds only the public key', async () => {
  const { signingConfig } = await import('./package.mjs');
  assert.throws(() => signingConfig({}), /PRIVATE_KEY/);
  assert.throws(() => signingConfig({ TAURI_SIGNING_PRIVATE_KEY: 'private' }), /PUBLIC_KEY/);
  assert.deepEqual(signingConfig({ TAURI_SIGNING_PRIVATE_KEY: 'private', TAURI_UPDATER_PUBLIC_KEY: ' public\n' }), { plugins: { updater: { pubkey: 'public' } } });
});

test('validates all version sources and extracts only the matching release notes', async t => {
  const { inspectRelease } = await import('./release.mjs');
  const { root } = fixture(t);
  assert.deepEqual(inspectRelease(root, 'v0.2.0'), { tag: 'v0.2.0', version: '0.2.0', prerelease: false, notes: '### Added\n- 关于页。\n' });
});

test('recognizes SemVer prereleases and rejects malformed tags', async t => {
  const { inspectRelease } = await import('./release.mjs');
  const { root } = fixture(t, '0.2.0-rc.1');
  assert.equal(inspectRelease(root, 'v0.2.0-rc.1').prerelease, true);
  for (const tag of ['0.2.0', 'v01.2.0', 'v0.2', 'v0.2.0-01', 'v0.2.0/../../file', 'v0.2.0+build']) {
    assert.throws(() => inspectRelease(root, tag), /Invalid release tag/);
  }
});

test('reads the last release with CRLF and excludes changelog reference links', async t => {
  const { inspectRelease } = await import('./release.mjs');
  const { root } = fixture(t);
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n## [0.2.0] - 2026-10-03\r\n\r\n### Fixed\r\n\r\n- Fix input.\r\n\r\n[Unreleased]: https://example.com/compare\r\n[0.2.0]: https://example.com/release\r\n');
  assert.equal(inspectRelease(root, 'v0.2.0').notes, '### Fixed\n\n- Fix input.\n');
});

test('rejects mismatches in every manifest and project lock entry', async t => {
  const { inspectRelease } = await import('./release.mjs');
  for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
    const { root, files } = fixture(t);
    writeFileSync(join(root, file), files[file].replace('0.2.0', '0.9.0'));
    assert.throws(() => inspectRelease(root, 'v0.2.0'), /Version mismatch/);
  }
  const { root, files } = fixture(t);
  const lock = JSON.parse(files['package-lock.json']);
  lock.packages[''].version = '0.9.0';
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.throws(() => inspectRelease(root, 'v0.2.0'), /Version mismatch/);
});

test('rejects missing, duplicate, empty and invalid-date changelog entries', async t => {
  const { inspectRelease } = await import('./release.mjs');
  const { root } = fixture(t);
  for (const notes of [
    '# Changelog\n## [Unreleased]\n- Future.\n',
    '## [0.2.0] - 2026-10-03\n### Added\n- One.\n## [0.2.0] - 2026-10-03\n- Two.\n',
    '## [0.2.0] - 2026-10-03\n### Added\n',
    '## [0.2.0] - 2026-02-30\n### Added\n- One.\n',
  ]) {
    writeFileSync(join(root, 'CHANGELOG.md'), notes);
    assert.throws(() => inspectRelease(root, 'v0.2.0'), /CHANGELOG/);
  }
});

test('bundles the two current binaries, notes and exact SHA-256 sums', async t => {
  const { bundleRelease } = await import('./release.mjs');
  const { root } = fixture(t);
  const binaryRoot = join(root, 'src-tauri/target/release');
  mkdirSync(join(binaryRoot, 'bundle/nsis'), { recursive: true });
  writeFileSync(join(binaryRoot, 'key-relay.exe'), 'application');
  writeFileSync(join(binaryRoot, 'bundle/nsis/Key Relay_0.2.0_x64-setup.exe'), 'installer');
  writeFileSync(join(binaryRoot, 'bundle/nsis/Key Relay_0.2.0_x64-setup.exe.sig'), 'signed-installer');
  writeFileSync(join(binaryRoot, 'bundle/nsis/Key Relay_0.1.0_x64-setup.exe'), 'old installer');
  const output = bundleRelease(root, 'v0.2.0');
  assert.deepEqual(readdirSync(output).sort(), ['Key Relay_0.2.0_x64-setup.exe', 'Key Relay_0.2.0_x64-setup.exe.sig', 'latest.json', 'SHA256SUMS.txt', 'key-relay.exe', 'release-notes.md'].sort());
  const manifest = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'signed-installer');
  assert.equal(manifest.platforms['windows-x86_64'].url, 'https://github.com/sunnyx11/key-relay/releases/download/v0.2.0/Key%20Relay_0.2.0_x64-setup.exe');
  for (const line of readFileSync(join(output, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')) {
    const [hash, name] = line.split('  ');
    assert.equal(hash, createHash('sha256').update(readFileSync(join(output, name))).digest('hex'));
  }
  assert.equal(readFileSync(join(output, 'release-notes.md'), 'utf8'), '### Added\n- 关于页。\n');
});

test('missing installer prevents attachment preparation', async t => {
  const { bundleRelease } = await import('./release.mjs');
  const { root } = fixture(t);
  assert.throws(() => bundleRelease(root, 'v0.2.0'), /ENOENT/);
});
