#!/usr/bin/env node
/**
 * Dumps the MySQL database defined by backend/.env DATABASE_URL to the Desktop.
 * Output: ~/Desktop/testifi-db-dump-YYYY-MM-DD.sql
 *
 * Usage: node scripts/dump-db-to-desktop.mjs [--dry-run]
 * Or:    ./scripts/dump-db-to-desktop.sh [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, 'backend', '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('Error: backend/.env not found. Create it from docs/env.backend.example and set DATABASE_URL.');
    process.exit(1);
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = value;
  }
  return env;
}

function parseDatabaseUrl(url) {
  if (!url || !url.startsWith('mysql://')) {
    console.error('Error: DATABASE_URL in backend/.env must be set and start with mysql://');
    process.exit(1);
  }
  try {
    const parsed = new URL(url);
    const auth = parsed.username ? decodeURIComponent(parsed.username) : '';
    const password = parsed.password ? decodeURIComponent(parsed.password) : '';
    const host = parsed.hostname || 'localhost';
    const port = parsed.port || '3306';
    const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    if (!database) {
      console.error('Error: DATABASE_URL must include a database name (path).');
      process.exit(1);
    }
    return { user: auth, password, host, port, database };
  } catch (e) {
    console.error('Error: DATABASE_URL could not be parsed:', e.message);
    process.exit(1);
  }
}

function getDesktopPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    console.error('Error: HOME or USERPROFILE not set.');
    process.exit(1);
  }
  return path.join(home, 'Desktop');
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const env = loadEnv();
  const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL is not set in backend/.env');
    process.exit(1);
  }

  const { user, password, host, port, database } = parseDatabaseUrl(databaseUrl);
  const date = new Date().toISOString().slice(0, 10);
  const desktop = getDesktopPath();
  const outFile = path.join(desktop, `testifi-db-dump-${date}.sql`);

  const args = [
    '-h', host,
    '-P', port,
    '-u', user,
    '--single-transaction',
    '--routines',
    '--triggers',
    database,
  ];

  const cmd = `mysqldump ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')} > "${outFile}"`;
  if (dryRun) {
    console.log('Would run (password hidden):');
    console.log(`MYSQL_PWD=*** mysqldump -h ${host} -P ${port} -u ${user} --single-transaction --routines --triggers ${database} > ${outFile}`);
    return;
  }

  const child = spawn('mysqldump', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MYSQL_PWD: password },
    shell: false,
  });

  const out = fs.createWriteStream(outFile);
  child.stdout.pipe(out);
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('mysqldump failed:', stderr || code);
      process.exit(1);
    }
    console.log(`Dump written to ${outFile}`);
  });

  child.on('error', (err) => {
    console.error('Failed to run mysqldump:', err.message);
    console.error('Ensure mysqldump is on your PATH (e.g. MySQL client or Homebrew mysql-client).');
    process.exit(1);
  });
}

main();
