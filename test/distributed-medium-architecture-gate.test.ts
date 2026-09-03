import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

const ROOT = resolve('src');
const PRODUCTION_ROOTS = [
  resolve(ROOT, 'main.ts'),
  resolve(ROOT, 'worker.ts'),
  resolve(ROOT, 'control/controller.ts'),
  resolve(ROOT, 'evaluation/distributed-g5-neutral-control-v1.ts'),
  resolve(ROOT, 'evaluation/minecraft-distributed-g6-continuous-capture-v1.ts'),
  resolve(ROOT, 'evaluation/minecraft-distributed-g6-live-v1.ts'),
];
const FORBIDDEN_PRODUCTION_MODULES: readonly string[] = Object.freeze([
  'memory.ts',
  'hierarchical-memory.ts',
  'legacy/audit-control-contracts.ts',
  'distance-embedding.ts',
  'core/learning/r2-atom-measurement.ts',
  'core/learning/path-projector.ts',
  'core/physics/physical-medium.ts',
  'core/physics/potential-page.ts',
  'core/prediction/prediction-clone.ts',
]);

async function localDependencyClosure(roots: readonly string[]): Promise<readonly string[]> {
  const pending = [...roots];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/g)]
      .map(match => match[1]!);
    for (const specifier of imports) {
      const absolute = resolve(dirname(file), specifier);
      const candidate = extname(absolute) === '.js' ? `${absolute.slice(0, -3)}.ts` : absolute;
      if (candidate.startsWith(ROOT)) pending.push(candidate);
    }
  }
  return [...visited].sort();
}

function relativeSource(file: string): string {
  return file.slice(ROOT.length + 1).replaceAll('\\', '/');
}

test('G0 production memory closure no longer reaches point-compression, page, or legacy clone modules', async () => {
  const closure = await localDependencyClosure(PRODUCTION_ROOTS);
  const relative = closure.map(relativeSource);
  assert.deepEqual(relative.filter(file => FORBIDDEN_PRODUCTION_MODULES.includes(file)), [],
    `legacy point/page modules remain in production closure:\n${relative
      .filter(file => FORBIDDEN_PRODUCTION_MODULES.includes(file)).join('\n')}`);
  for (const required of [
    'core/physics/distributed-physical-medium.ts',
    'core/learning/self-organizing-afferent.ts',
    'core/learning/distributed-r1.ts',
    'core/learning/distributed-r2a-physical.ts',
    'core/prediction/distributed-prediction-clone.ts',
    'core/prediction/distributed-reasoning-contracts.ts',
  ]) {
    assert(relative.includes(required), `distributed production module is not reachable: ${required}`);
  }
});

test('G0 distributed substrate source exposes one continuous lattice instead of event/result pages', async () => {
  const [medium, r1, r2aPhysical, memory] = await Promise.all([
    readFile(resolve(ROOT, 'core/physics/distributed-physical-medium.ts'), 'utf8'),
    readFile(resolve(ROOT, 'core/learning/distributed-r1.ts'), 'utf8'),
    readFile(resolve(ROOT, 'core/learning/distributed-r2a-physical.ts'), 'utf8'),
    readFile(resolve(ROOT, 'distributed-hierarchical-memory.ts'), 'utf8'),
  ]);
  const production = `${medium}\n${r1}\n${r2aPhysical}\n${memory}`;
  assert.doesNotMatch(production, /createPage|pageFor|pageId|routePage|resultPage/,
    'the distributed substrate reintroduced isolated pages');
  assert.doesNotMatch(production, /DistanceEmbedding|R2AtomMeasurementAdapter|patternCoordinate/,
    'a complete experience is still collapsed to a Vec3 point');
  assert.match(medium, /tileSize[^\n]*32|maxTiles[^\n]*32|DEFAULT[^\n]*32/,
    'the explicit 32^3/32-tile capacity contract is absent');
  assert.match(medium, /localBondCount|six|6-neigh|neighbor/i,
    'cross-tile six-neighbour continuity is not auditable');
});

test('G0 production reasoning DTOs contain no fabricated legacy page, point, or clone sample carrier', async () => {
  const files = [
    'core/prediction/distributed-reasoning-adapter.ts',
    'core/prediction/distributed-reasoning-contracts.ts',
    'control/contracts.ts',
    'control/controller.ts',
    'control/workspace.ts',
  ];
  for (const relative of files) {
    const source = await readFile(resolve(ROOT, relative), 'utf8');
    assert.doesNotMatch(source, /distributed-(?:R1|R2)-audit-carrier/,
      `${relative} still manufactures a legacy audit carrier`);
    assert.doesNotMatch(source, /\b(?:pageId|coordinate|positions|kernelIndex)\s*:/,
      `${relative} still exposes a legacy point/page/sample field`);
    assert.doesNotMatch(source,
      /from\s+['"][^'"]*\/(?:prediction-clone|physical-medium|potential-page)\.js['"]/,
      `${relative} imports a legacy point/page prediction implementation`);
  }
});

test('G0 package keeps hierarchical runners audit-only and production commands distributed-only', async () => {
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
  const unscoped = Object.keys(pkg.scripts).filter(name => name.startsWith('minecraft:hierarchical-'));
  assert.deepEqual(unscoped, [], `legacy hierarchical commands remain production-shaped: ${unscoped.join(',')}`);
  const auditCommands = Object.keys(pkg.scripts)
    .filter(name => name.startsWith('audit:legacy:minecraft-hierarchical-'));
  assert.equal(auditCommands.length, 4, 'all four sealed hierarchical runners must be explicit legacy audits');
  for (const name of ['start', 'g5:neutral:canary', 'g5:neutral:matrix',
    'minecraft:distributed-g6-continuous-capture-v1']) {
    const command = pkg.scripts[name];
    assert(command, `missing production command:${name}`);
    assert.doesNotMatch(command, /hierarchical-(?:short|button|multilevel|continuous)|audit:legacy/,
      `${name} imports or dispatches a legacy hierarchical runner`);
  }
});

test('G0 learning sources cannot consume scorer labels, arm names, or expected outcomes', async () => {
  const files = [
    'core/learning/self-organizing-afferent.ts',
    'core/learning/distributed-r1.ts',
    'core/learning/distributed-r2.ts',
    'core/learning/distributed-r2a.ts',
  ];
  for (const relative of files) {
    const source = await readFile(resolve(ROOT, relative), 'utf8');
    assert.doesNotMatch(source,
      /expected(?:Outcome|Result)|trainingArm|contrastArm|targetArm|scorerLabel|groundTruth/,
      `${relative} reads an experiment-only label`);
    assert.doesNotMatch(source, /world(?:X|Y|Z)|absoluteWorld|worldToR1|r1ToWorld/,
      `${relative} converts a world coordinate into a medium coordinate`);
  }
});
