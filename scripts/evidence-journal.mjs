import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Each receipt has its own immutable file. The line-oriented convenience
// exports are derived at shutdown, not repeatedly reopened for live appends.
export class EvidenceJournal {
  #counts = new Map();
  constructor(root) { this.root = resolve(root); }
  async write(kind, value) {
    if (!/^[a-z-]+$/.test(kind)) throw new Error('invalid-journal-kind');
    const directory = resolve(this.root, 'journal', kind);
    if (!this.#counts.has(kind)) await mkdir(directory, { recursive: true });
    const index = (this.#counts.get(kind) ?? 0) + 1;
    await writeFile(resolve(directory, String(index).padStart(7, '0') + '.json'), JSON.stringify(value) + '\n', { flag: 'wx' });
    this.#counts.set(kind, index);
  }
  async export() {
    for (const [kind, count] of this.#counts) {
      const lines = [];
      for (let index = 1; index <= count; index++) {
        const text = await readFile(resolve(this.root, 'journal', kind, String(index).padStart(7, '0') + '.json'), 'utf8');
        JSON.parse(text); lines.push(text);
      }
      await writeFile(resolve(this.root, kind + '.jsonl'), lines.join(''));
    }
    const counts = Object.fromEntries(this.#counts);
    await writeFile(resolve(this.root, 'journal-counts.json'), JSON.stringify(counts, null, 2));
    return counts;
  }
}
