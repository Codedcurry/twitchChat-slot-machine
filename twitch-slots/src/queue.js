import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Saved spins waiting for the streamer, oldest first. When a file is given,
// every change is written to it so redeems survive a restart.
export class SpinQueue {
  #entries = [];
  #file;

  constructor({ file } = {}) {
    this.#file = file ?? null;
    if (this.#file) this.#entries = load(this.#file);
  }

  get count() {
    return this.#entries.length;
  }

  list() {
    return this.#entries.map((e) => ({ ...e }));
  }

  add(user, at = Date.now()) {
    const name = typeof user === 'string' ? user.trim() : '';
    if (!name) throw new Error('A username is required');
    const entry = { id: randomUUID(), user: name, at };
    this.#entries.push(entry);
    this.#save();
    return { ...entry };
  }

  next() {
    const entry = this.#entries.shift();
    if (!entry) return null;
    this.#save();
    return entry;
  }

  remove(id) {
    const i = this.#entries.findIndex((e) => e.id === id);
    if (i === -1) return false;
    this.#entries.splice(i, 1);
    this.#save();
    return true;
  }

  #save() {
    if (!this.#file) return;
    mkdirSync(dirname(this.#file), { recursive: true });
    // Write then rename so a crash mid-write never leaves a half-written file.
    const tmp = `${this.#file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#entries, null, 2));
    renameSync(tmp, this.#file);
  }
}

function load(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(data)) return [];
    return data.filter((e) => e && typeof e.id === 'string' && typeof e.user === 'string' && e.user.trim());
  } catch {
    return [];
  }
}
