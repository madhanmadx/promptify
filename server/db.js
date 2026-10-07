import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { execSync } from 'node:child_process';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from './config.js';

let memoryServer = null;

/**
 * A force-killed mongod leaves lock files behind. If the PID recorded in
 * `mongod.lock` is gone, the locks are stale and startup would fail — remove
 * them. `WiredTiger.lock` gets the same treatment, but only when no mongod
 * process is alive at all, so a live instance is never unlocked out from
 * under its own database.
 */
function anyMongodRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq mongod.exe" /NH', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return /mongod\.exe/i.test(out);
    }
    execSync('pgrep -x mongod', { stdio: 'ignore' });
    return true;
  } catch {
    return false; // tasklist finds nothing, or pgrep exits 1 when no match
  }
}

function clearStaleLock(dbPath) {
  const lockFile = path.join(dbPath, 'mongod.lock');
  const wtLock = path.join(dbPath, 'WiredTiger.lock');

  if (fs.existsSync(lockFile)) {
    const raw = fs.readFileSync(lockFile, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);

    if (Number.isNaN(pid) || pid <= 0) {
      fs.rmSync(lockFile, { force: true });
    } else {
      try {
        process.kill(pid, 0); // still alive → leave the lock alone
        return;
      } catch {
        fs.rmSync(lockFile, { force: true });
      }
    }
    console.log('✔ cleared a stale MongoDB lock file');
  }

  // mongod.lock is gone, but an orphaned WiredTiger.lock can still make the
  // next start fail with an opaque "fassert() failure".
  if (fs.existsSync(wtLock) && !anyMongodRunning()) {
    fs.rmSync(wtLock, { force: true });
    console.log('✔ cleared a stale WiredTiger lock file');
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Give a leftover mongod time to finish exiting (max ~8 s). */
async function settleMongod(timeoutMs = 8000) {
  const t0 = Date.now();
  while (anyMongodRunning() && Date.now() - t0 < timeoutMs) await wait(400);
  return !anyMongodRunning();
}

/**
 * Connects to MongoDB.
 *  - If MONGODB_URI is set (Atlas / local server)  -> use it.
 *  - Otherwise                                     -> boot a local MongoDB that
 *    downloads on first run and persists in ./data, so the app runs with
 *    zero manual setup.
 */
export async function connectDB() {
  mongoose.set('strictQuery', true);

  // Node sometimes inherits a resolver that refuses everything (loopback with
  // nothing on :53). `DNS_SERVERS` lets the operator point this process at a
  // working one — only relevant for mongodb+srv / Atlas.
  if (config.dnsServers) {
    const servers = config.dnsServers.split(/[,\s]+/).filter(Boolean);
    if (servers.length) {
      dns.setServers(servers);
      console.log(`✔ DNS servers for this process: ${servers.join(', ')}`);
    }
  }

  if (config.mongoUri) {
    // A network blip during boot (venue Wi-Fi, mobile hotspot, VPN) used to
    // exit the whole process — which is exactly how the QR board went dark.
    // Retry with backoff so a transient timeout never takes the event down.
    const attempts = 5;
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
        // Print WHICH database: two instances quietly writing to different
        // databases cost an event its entries once already.
        const dbName = mongoose.connection?.db?.databaseName || 'unknown';
        console.log(`✔ Connected to MongoDB → database "${dbName}"`);
        return;
      } catch (err) {
        lastErr = err;
        const reason = String(err.message || err).split('\n')[0].slice(0, 120);
        console.warn(`⚠ MongoDB unreachable (attempt ${attempt}/${attempts}): ${reason}`);
        if (attempt < attempts) await wait(5000);
      }
    }
    throw lastErr;
  }

  try {
    fs.mkdirSync(config.dbPath, { recursive: true });

    // The very first start after a force-killed mongod can fail with an opaque
    // "fassert() failure" while WiredTiger is still recovering — wait for the
    // old process, clear whatever locks it left behind and try again rather
    // than telling the operator to reinstall MongoDB.
    const attempts = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        clearStaleLock(config.dbPath);
        memoryServer = await MongoMemoryServer.create({
          instance: { dbName: 'promptify', dbPath: config.dbPath, storageEngine: 'wiredTiger' },
        });
        break;
      } catch (err) {
        if (attempt >= attempts) throw err;
        console.warn(`⚠ local MongoDB did not start (attempt ${attempt}/${attempts}): ${
          String(err.message || err).split('\n')[0].slice(0, 120)
        }`);
        await settleMongod();
        if (memoryServer) {
          try { await memoryServer.stop(); } catch { /* already gone */ }
          memoryServer = null;
        }
        await wait(2500);
      }
    }

    await mongoose.connect(memoryServer.getUri('promptify'));
    console.log(`✔ Local MongoDB ready (data persisted in ${config.dbPath})`);
  } catch (err) {
    console.error('');
    console.error('✖ Could not start a local MongoDB.');
    console.error('  Fix one of the following:');
    console.error('   1. Check your internet connection — the MongoDB binary is');
    console.error('      downloaded once and cached.');
    console.error('   2. Or set MONGODB_URI in a .env file to an existing cluster.');
    console.error('');
    console.error(err.message);
    throw err;
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}
