import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseIdentity } from './release.mjs';

/** Create/update a draft via Actions' Octokit client. Verify artifacts first; reject published releases. */
export async function publishDraft(github, repo, tag, directory) {
  const release = releaseIdentity(tag);
  const names = [`Key Relay_${release.version}_x64-setup.exe`, 'key-relay.exe', 'SHA256SUMS.txt'];
  const assets = names.map(name => ({ name, data: readFileSync(join(directory, name)) }));
  const checksums = assets.slice(0, 2).map(({ name, data }) => `${createHash('sha256').update(data).digest('hex')}  ${name}\n`).join('');
  if (assets.some(asset => !asset.data.length) || assets[2].data.toString('utf8') !== checksums) throw new Error('Release attachment checksum mismatch.');
  const body = readFileSync(join(directory, 'release-notes.md'), 'utf8');
  if (!body.trim()) throw new Error('Release notes are empty.');
  const releases = await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 });
  const existing = releases.find(item => item.tag_name === tag);
  if (existing && !existing.draft) throw new Error(`Release ${tag} is already published; automatic updates are disabled.`);
  const details = { ...repo, name: `Key Relay ${tag}`, body, draft: true, prerelease: release.prerelease };
  const { data: draft } = existing
    ? await github.rest.repos.updateRelease({ ...details, release_id: existing.id })
    : await github.rest.repos.createRelease({ ...details, tag_name: tag });
  const current = await github.paginate(github.rest.repos.listReleaseAssets, { ...repo, release_id: draft.id, per_page: 100 });
  for (const asset of assets) {
    const old = current.find(item => item.name === asset.name);
    if (old) await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: old.id });
    await github.rest.repos.uploadReleaseAsset({
      ...repo, release_id: draft.id, name: asset.name, data: asset.data,
      headers: { 'content-type': 'application/octet-stream', 'content-length': asset.data.length },
    });
  }
  return draft.html_url;
}
