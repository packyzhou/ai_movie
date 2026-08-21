'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Per-user JSON file storage under resources/datas.
 * Files are named "<username>_<suffix>.json" (e.g. admin_myproject.json).
 */

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function fileFor(username, suffix) {
  if (!USERNAME_RE.test(username)) throw new Error('Invalid username for storage');
  return path.join(config.dataDir, `${username}_${suffix}.json`);
}

function readAll(username, suffix, key) {
  const file = fileFor(username, suffix);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    return Array.isArray(parsed) ? parsed : parsed[key] || [];
  } catch (err) {
    throw new Error(`Corrupt data file ${path.basename(file)}: ${err.message}`);
  }
}

function writeAll(username, suffix, key, items) {
  const file = fileFor(username, suffix);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write to a sibling temp file then rename, so a crash mid-write cannot
  // truncate the user's project list.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ [key]: items, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
  return items;
}

/** Sort newest-first and slice one page out. */
function paginate(items, { page = 1, pageSize = 10, keyword = '', searchFields = [] } = {}) {
  let rows = [...items];
  const q = String(keyword || '').trim().toLowerCase();
  if (q && searchFields.length) {
    rows = rows.filter((it) => searchFields.some((f) => String(it[f] || '').toLowerCase().includes(q)));
  }
  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  const size = Math.min(Math.max(Number(pageSize) || 10, 1), 100);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  return {
    items: rows.slice((current - 1) * size, current * size),
    page: current,
    pageSize: size,
    total,
    pages,
  };
}

/** A tiny CRUD collection bound to one user + one file suffix. */
function collection(suffix, key, idField = 'id') {
  return {
    file: (username) => fileFor(username, suffix),
    list: (username) => readAll(username, suffix, key),
    page: (username, opts) => paginate(readAll(username, suffix, key), opts),
    find(username, id) {
      return readAll(username, suffix, key).find((it) => it[idField] === id) || null;
    },
    insert(username, item) {
      const items = readAll(username, suffix, key);
      if (items.some((it) => it[idField] === item[idField])) {
        throw new Error(`${key.slice(0, -1)} "${item[idField]}" already exists`);
      }
      const now = new Date().toISOString();
      const row = { ...item, createdAt: now, updatedAt: now };
      items.push(row);
      writeAll(username, suffix, key, items);
      return row;
    },
    update(username, id, patch) {
      const items = readAll(username, suffix, key);
      const idx = items.findIndex((it) => it[idField] === id);
      if (idx === -1) throw new Error(`Not found: ${id}`);
      // The id is immutable by design - the UI shows it read-only.
      const row = { ...items[idx], ...patch, [idField]: id, updatedAt: new Date().toISOString() };
      items[idx] = row;
      writeAll(username, suffix, key, items);
      return row;
    },
    remove(username, id) {
      const items = readAll(username, suffix, key);
      const idx = items.findIndex((it) => it[idField] === id);
      if (idx === -1) throw new Error(`Not found: ${id}`);
      const [row] = items.splice(idx, 1);
      writeAll(username, suffix, key, items);
      return row;
    },
  };
}

module.exports = {
  paginate,
  projects: collection('myproject', 'projects', 'projectId'),
  templates: collection('template', 'templates', 'templateId'),
};
