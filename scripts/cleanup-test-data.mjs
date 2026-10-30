#!/usr/bin/env node
// Removes data that older test runs wrote into the real database (before tests
// got their own OPEN_CODE_DATA_ROOT). Dry run by default; pass --yes to delete.
//
//   npm run cleanup:test-data          # list what would be removed
//   npm run cleanup:test-data -- --yes # remove it
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Names the unit tests give the projects they create (tests/phase2.test.ts)
const TEST_PROJECT_NAMES = ['Sharable Project', 'User Scoped Project'];
// Titles the e2e journeys give their conversations (e2e/tests/user-journeys.spec.ts)
const TEST_CONVERSATION_PREFIX = 'E2E Test Prompt';

const apply = process.argv.includes('--yes');
const root = process.env.OPEN_CODE_DATA_ROOT || process.cwd();
const dbPath = path.join(root, '.platform', 'open-code.db');
const workspacesDir = path.resolve(root, 'workspaces');

if (!fs.existsSync(dbPath)) {
  console.log(`No database at ${dbPath}; nothing to clean.`);
  process.exit(0);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON'); // project/conversation children cascade

const projects = db
  .prepare(`SELECT id, name, workspace FROM projects WHERE name IN (${TEST_PROJECT_NAMES.map(() => '?').join(',')})`)
  .all(...TEST_PROJECT_NAMES);
const conversations = db
  .prepare('SELECT id, title FROM conversations WHERE title LIKE ?')
  .all(`${TEST_CONVERSATION_PREFIX}%`);

console.log(`${projects.length} test projects, ${conversations.length} test conversations in ${dbPath}`);
for (const p of projects) console.log(`  project      ${p.id}  ${p.name}`);
for (const c of conversations) console.log(`  conversation ${c.id}  ${c.title}`);

if (!apply) {
  if (projects.length || conversations.length) console.log('\nDry run. Re-run with --yes to delete these.');
  process.exit(0);
}

db.transaction(() => {
  for (const p of projects) db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  for (const c of conversations) db.prepare('DELETE FROM conversations WHERE id = ?').run(c.id);
})();

// Only remove workspace folders that live under this data root's workspaces/
let removedDirs = 0;
for (const p of projects) {
  const ws = p.workspace && path.resolve(p.workspace);
  if (ws && path.dirname(ws) === workspacesDir && fs.existsSync(ws)) {
    fs.rmSync(ws, { recursive: true, force: true });
    removedDirs++;
  }
}
db.close();
console.log(`Deleted ${projects.length} projects, ${conversations.length} conversations, ${removedDirs} workspace folders.`);
