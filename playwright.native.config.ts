import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/native', timeout: 45_000, workers: 1, reporter: 'list' });
