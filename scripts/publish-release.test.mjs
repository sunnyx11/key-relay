import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

function fixture(t, existing = [], version = '0.2.0') {
  const directory = mkdtempSync(join(tmpdir(), 'key-relay-publish-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const files = [`Key Relay_${version}_x64-setup.exe`, 'key-relay.exe', `Key Relay_${version}_x64-setup.exe.sig`, 'latest.json'];
  for (const file of files) writeFileSync(join(directory, file), file);
  writeFileSync(join(directory, 'latest.json'), JSON.stringify({ version, pub_date: '2026-10-03T00:00:00.000Z', notes: '### Added\n- About tab.\n', platforms: { 'windows-x86_64': { signature: files[2], url: `https://github.com/owner/repo/releases/download/v${version}/${encodeURIComponent(files[0])}` } } }));
  writeFileSync(join(directory, 'SHA256SUMS.txt'), files.map(file => `${createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')}  ${file}\n`).join(''));
  writeFileSync(join(directory, 'release-notes.md'), '### Added\n- About tab.\n');
  const calls = [];
  const repos = {};
  for (const name of ['listReleases', 'listReleaseAssets', 'createRelease', 'updateRelease', 'deleteReleaseAsset', 'uploadReleaseAsset']) {
    repos[name] = async args => {
      calls.push({ name, args });
      return { data: { id: 7, upload_url: 'https://uploads.github.com/repos/owner/repo/releases/7/assets{?name,label}', html_url: 'https://github.com/owner/repo/releases/7' } };
    };
  }
  const github = { rest: { repos }, paginate: async method => method === repos.listReleases ? existing : [{ id: 11, name: 'key-relay.exe' }] };
  return { directory, calls, github, repo: { owner: 'owner', repo: 'repo' } };
}

test('creates only a draft and uploads the five verified attachments', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  const f = fixture(t);
  await publishDraft(f.github, f.repo, 'v0.2.0', f.directory);
  const create = f.calls.find(call => call.name === 'createRelease').args;
  assert.equal(create.draft, true);
  assert.equal(create.prerelease, false);
  assert.equal(create.tag_name, 'v0.2.0');
  assert.equal(create.body, '### Added\n- About tab.\n');
  assert.deepEqual(f.calls.filter(call => call.name === 'uploadReleaseAsset').map(call => call.args.name).sort(), ['Key Relay_0.2.0_x64-setup.exe', 'Key Relay_0.2.0_x64-setup.exe.sig', 'latest.json', 'SHA256SUMS.txt', 'key-relay.exe'].sort());
});

test('marks prerelease drafts from the tag suffix', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  const f = fixture(t, [], '0.2.0-rc.1');
  await publishDraft(f.github, f.repo, 'v0.2.0-rc.1', f.directory);
  assert.equal(f.calls.find(call => call.name === 'createRelease').args.prerelease, true);
});

test('GitHub lookup failure stops without creating a replacement release', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  const f = fixture(t);
  f.github.paginate = async () => { throw new Error('Access denied'); };
  await assert.rejects(publishDraft(f.github, f.repo, 'v0.2.0', f.directory), /Access denied/);
  assert.deepEqual(f.calls, []);
});

test('rerun updates the existing draft and replaces matching attachments', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  const f = fixture(t, [{ tag_name: 'v0.2.0', id: 7, draft: true }]);
  await publishDraft(f.github, f.repo, 'v0.2.0', f.directory);
  assert.equal(f.calls.some(call => call.name === 'createRelease'), false);
  assert.equal(f.calls.find(call => call.name === 'updateRelease').args.draft, true);
  assert.equal(f.calls.find(call => call.name === 'deleteReleaseAsset').args.asset_id, 11);
});

test('published release is never edited or uploaded to', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  const f = fixture(t, [{ tag_name: 'v0.2.0', id: 7, draft: false }]);
  await assert.rejects(publishDraft(f.github, f.repo, 'v0.2.0', f.directory), /already published/);
  assert.deepEqual(f.calls, []);
});

test('corrupted attachments stop before any GitHub mutation', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  const f = fixture(t);
  writeFileSync(join(f.directory, 'key-relay.exe'), 'corrupted');
  await assert.rejects(publishDraft(f.github, f.repo, 'v0.2.0', f.directory), /checksum/i);
  assert.deepEqual(f.calls, []);
});

test('invalid updater metadata stops before any GitHub mutation even with valid hashes', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  for (const field of ['version', 'signature', 'url', 'pub_date', 'notes']) {
    const f = fixture(t);
    const manifestPath = join(f.directory, 'latest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (field === 'signature' || field === 'url') manifest.platforms['windows-x86_64'][field] = 'invalid';
    else manifest[field] = 'invalid';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const files = ['Key Relay_0.2.0_x64-setup.exe', 'key-relay.exe', 'Key Relay_0.2.0_x64-setup.exe.sig', 'latest.json'];
    writeFileSync(join(f.directory, 'SHA256SUMS.txt'), files.map(file => `${createHash('sha256').update(readFileSync(join(f.directory, file))).digest('hex')}  ${file}\n`).join(''));
    await assert.rejects(publishDraft(f.github, f.repo, 'v0.2.0', f.directory), /manifest/i);
    assert.deepEqual(f.calls, []);
  }
});

test('upload failure rejects the run while retaining draft status', async t => {
  const { publishDraft } = await import('./publish-release.mjs');
  const f = fixture(t);
  f.github.rest.repos.uploadReleaseAsset = async () => { throw new Error('upload failed'); };
  await assert.rejects(publishDraft(f.github, f.repo, 'v0.2.0', f.directory), /upload failed/);
  assert.equal(f.calls.find(call => call.name === 'createRelease').args.draft, true);
  assert.equal(f.calls.some(call => call.args.draft === false), false);
});
