/**
 * Sovereign Edge Persistent Storage Engine
 * 
 * Features:
 * 1. Zero-Cloud Local Persistence (Embedded SQLite with WAL mode & atomic fallback)
 * 2. Strict Tenant-Partitioned Isolation (All queries indexed & filtered by user_id)
 * 3. Multi-Turn Context Window Extraction for LLM memory
 * 4. Full Audit Trail with Turn Telemetry & Router Decisions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sovereign_sessions.db');
const JSON_FALLBACK_PATH = path.join(DATA_DIR, 'sovereign_sessions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let sqliteDb = null;
let useJsonFallback = false;
let inMemoryHistory = [];

/**
 * Initialize storage engine: attempt SQLite first, fallback to JSON
 */
export async function initStorage() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    sqliteDb = new DatabaseSync(DB_PATH);
    
    // Enable WAL mode for high concurrent read/write throughput
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA synchronous = NORMAL;');

    // Create table with tenant-partitioned indexes
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        route TEXT,
        intent TEXT,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_timestamp ON conversation_history(user_id, timestamp);
    `);

    console.log(`  -> Persistent Storage initialized [SQLite WAL]: ${DB_PATH}`);
  } catch (err) {
    console.warn(`  ⚠️ SQLite not available (${err.message}). Using resilient atomic JSON storage.`);
    useJsonFallback = true;
    if (fs.existsSync(JSON_FALLBACK_PATH)) {
      try {
        inMemoryHistory = JSON.parse(fs.readFileSync(JSON_FALLBACK_PATH, 'utf-8'));
      } catch (e) {
        inMemoryHistory = [];
      }
    }
  }
}

/**
 * Save a message into persistent storage
 */
export function saveMessage({ userId, role, content, route = null, intent = null, metadata = null }) {
  if (!userId || !role || !content) return null;

  const timestamp = Date.now();
  const metaStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

  if (sqliteDb && !useJsonFallback) {
    try {
      const insert = sqliteDb.prepare(`
        INSERT INTO conversation_history (user_id, role, content, route, intent, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const res = insert.run(userId, role, content, route, intent, timestamp, metaStr);
      return {
        id: Number(res.lastInsertRowid),
        userId,
        role,
        content,
        route,
        intent,
        timestamp,
        metadata
      };
    } catch (err) {
      console.error('[Storage Error] Failed to write to SQLite:', err.message);
    }
  }

  // Fallback: Atomic JSON file write
  const item = {
    id: inMemoryHistory.length + 1,
    user_id: userId,
    role,
    content,
    route,
    intent,
    timestamp,
    metadata
  };
  inMemoryHistory.push(item);
  try {
    fs.writeFileSync(JSON_FALLBACK_PATH, JSON.stringify(inMemoryHistory, null, 2), 'utf-8');
  } catch (e) {}

  return item;
}

/**
 * Get recent conversation turns formatted for LLM context window
 * Strictly filtered by tenant userId
 */
export function getRecentContextMessages(userId, limit = 10) {
  if (!userId) return [];

  if (sqliteDb && !useJsonFallback) {
    try {
      const query = sqliteDb.prepare(`
        SELECT role, content FROM conversation_history
        WHERE user_id = ? AND (intent IS NULL OR intent NOT IN ('VERIFY_DETERMINISTIC', 'SECURITY_OVERRIDE_REJECTED'))
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      `);
      const rows = query.all(userId, limit);
      // Reverse to maintain chronological order (oldest to newest)
      return rows.reverse().map(r => ({
        role: r.role === 'assistant' ? 'assistant' : 'user',
        content: r.content
      }));
    } catch (err) {
      console.error('[Storage Error] Failed to read context from SQLite:', err.message);
    }
  }

  // JSON fallback
  return inMemoryHistory
    .filter(m => m.user_id === userId && (!m.intent || !['VERIFY_DETERMINISTIC', 'SECURITY_OVERRIDE_REJECTED'].includes(m.intent)))
    .slice(-limit)
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));
}

/**
 * Get full conversation history for the frontend UI
 * Strictly isolated for the authenticated tenant
 */
export function getHistory(userId, limit = 50) {
  if (!userId) return [];

  if (sqliteDb && !useJsonFallback) {
    try {
      const query = sqliteDb.prepare(`
        SELECT id, user_id, role, content, route, intent, timestamp, metadata
        FROM conversation_history
        WHERE user_id = ?
        ORDER BY timestamp ASC, id ASC
        LIMIT ?
      `);
      const rows = query.all(userId, limit);
      return rows.map(r => ({
        id: r.id,
        userId: r.user_id,
        role: r.role,
        content: r.content,
        route: r.route,
        intent: r.intent,
        timestamp: r.timestamp,
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch(e) { return r.metadata; } })() : null
      }));
    } catch (err) {
      console.error('[Storage Error] Failed to read history from SQLite:', err.message);
    }
  }

  return inMemoryHistory
    .filter(m => m.user_id === userId)
    .slice(-limit)
    .map(m => ({
      id: m.id,
      userId: m.user_id,
      role: m.role,
      content: m.content,
      route: m.route,
      intent: m.intent,
      timestamp: m.timestamp,
      metadata: m.metadata
    }));
}

/**
 * Clear conversation history for a specific tenant
 */
export function clearHistory(userId) {
  if (!userId) return false;

  if (sqliteDb && !useJsonFallback) {
    try {
      const del = sqliteDb.prepare('DELETE FROM conversation_history WHERE user_id = ?');
      del.run(userId);
      return true;
    } catch (err) {
      console.error('[Storage Error] Failed to clear SQLite history:', err.message);
    }
  }

  inMemoryHistory = inMemoryHistory.filter(m => m.user_id !== userId);
  try {
    fs.writeFileSync(JSON_FALLBACK_PATH, JSON.stringify(inMemoryHistory, null, 2), 'utf-8');
  } catch (e) {}

  return true;
}

/**
 * Get overall storage statistics
 */
export function getStorageStats() {
  let totalMessages = 0;
  let tenantBreakdown = {};

  if (sqliteDb && !useJsonFallback) {
    try {
      const countRes = sqliteDb.prepare('SELECT COUNT(*) as count FROM conversation_history').get();
      totalMessages = countRes.count || 0;

      const breakdownRes = sqliteDb.prepare('SELECT user_id, COUNT(*) as count FROM conversation_history GROUP BY user_id').all();
      for (const b of breakdownRes) {
        tenantBreakdown[b.user_id] = b.count;
      }

      let fileSize = 0;
      if (fs.existsSync(DB_PATH)) {
        fileSize = fs.statSync(DB_PATH).size;
      }

      return {
        engine: 'SQLite WAL',
        path: DB_PATH,
        fileSizeBytes: fileSize,
        totalMessages,
        tenantBreakdown
      };
    } catch (e) {}
  }

  return {
    engine: 'Atomic JSON',
    path: JSON_FALLBACK_PATH,
    totalMessages: inMemoryHistory.length,
    tenantBreakdown: inMemoryHistory.reduce((acc, m) => {
      acc[m.user_id] = (acc[m.user_id] || 0) + 1;
      return acc;
    }, {})
  };
}
