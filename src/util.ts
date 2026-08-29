import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (ArrayBuffer.isView(item)) return Array.from(item as unknown as ArrayLike<number>);
    if (item !== null && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en')));
    return item;
  });
}
export const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export async function fileSha(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
export async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, canonical(value) + '\n', 'utf8');
  await rename(temporary, path);
}
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
