import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

/** Use one embedded public key for the updater and Tauri's package-signing validation. */
export function signingConfig(env) {
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) throw new Error('Missing TAURI_SIGNING_PRIVATE_KEY.');
  if (!env.TAURI_UPDATER_PUBLIC_KEY?.trim()) throw new Error('Missing TAURI_UPDATER_PUBLIC_KEY.');
  return { plugins: { updater: { pubkey: env.TAURI_UPDATER_PUBLIC_KEY.trim() } } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = signingConfig(process.env);
    const cli = fileURLToPath(new URL('../node_modules/@tauri-apps/cli/tauri.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'build', '--bundles', 'nsis', '--config', JSON.stringify(config), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
