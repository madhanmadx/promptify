#!/usr/bin/env node
/**
 * Rescue submissions that landed in the wrong database.
 *
 *   node scripts/rescue.mjs
 *
 * While a second Promptify copy is running with an unpatched MONGODB_URI it
 * writes to MongoDB's `test` database instead of `promptify`, so entries made
 * on those phones never reach the organizer dashboard. This copies them over.
 *
 * It is safe to run repeatedly:
 *   - entries already rescued are matched by their checkToken and skipped
 *   - ID collisions are impossible: each rescued entry gets the next free
 *     number from promptify's own counter
 *   - everything else (artwork, timing, device, status) is carried across
 *
 * The id each participant was shown is written to import-map.txt so the
 * organizer can tell them their new number.
 */
import dns from 'node:dns';
import fs from 'node:fs';

// same override the server needs on this network (SRV lookups die otherwise)
const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const dnsLine = env.match(/^DNS_SERVERS=(.*)$/m);
if (dnsLine) dns.setServers(dnsLine[1].split(',').map((s) => s.trim()).filter(Boolean));

const uri = (env.match(/^MONGODB_URI=(.*)$/m) || [])[1]?.trim();
if (!uri) {
  console.error('MONGODB_URI not found in .env');
  process.exit(1);
}

const base = uri.split('?')[0];
const qs = uri.includes('?') ? '?' + uri.split('?')[1] : '';
const targetDb = (base.match(/\/([^/?]+)(\?|$)/) || [])[1] || 'promptify';
const url = (db) => base.replace(/\/[^/?]+$/, '/' + db) + qs;

const { MongoClient } = await import('mongodb');
const from = new MongoClient(url('test'), { serverSelectionTimeoutMS: 10000 });
const to = new MongoClient(url(targetDb), { serverSelectionTimeoutMS: 10000 });
await from.connect();
await to.connect();

const source = from.db('test').collection('submissions');
const dest = to.db(targetDb).collection('submissions');
const counter = to.db(targetDb).collection('counters');

const stranded = await source.find({}).toArray();
const rescued = await dest.find({}, { projection: { checkToken: 1 } }).toArray();
const have = new Set(rescued.map((d) => d.checkToken).filter(Boolean));
const alreadyThere = await dest.countDocuments();

let moved = 0;
const mapping = [];

for (const doc of stranded) {
  if (doc.checkToken && have.has(doc.checkToken)) continue;

  const { _id, submissionId: oldId, ...rest } = doc;
  const seq = await counter.findOneAndUpdate(
    { _id: 'submission' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, returnDocument: 'after' }
  );
  const newId = `PF-2026-${String(seq.seq).padStart(3, '0')}`;

  await dest.insertOne({
    ...rest,
    submissionId: newId,
    importedFrom: oldId,
    importedAt: new Date(),
  });
  have.add(doc.checkToken);
  moved++;
  mapping.push(`${oldId} (shown on the phone)  ->  ${newId} (dashboard)\n    ${doc.fullName} · ${doc.college}`);
  console.log(`rescued ${oldId} -> ${newId} | ${doc.fullName} | ${doc.college}`);
}

if (moved && mapping.length) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(
    'import-map.txt',
    `\nRescue run ${stamp} — ${moved} entr${moved === 1 ? 'y' : 'ies'} moved\n` +
      mapping.join('\n') +
      '\n'
  );
}

const total = await dest.countDocuments();
console.log(
  moved
    ? `\nmoved ${moved} — ${targetDb} now holds ${total} entries (was ${alreadyThere})`
    : `nothing to rescue — ${targetDb} already holds all ${total} entries`
);

await from.close();
await to.close();
