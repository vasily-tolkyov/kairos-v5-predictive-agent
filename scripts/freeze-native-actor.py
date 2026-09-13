"""Create a new immutable execution copy after a completed build and gate.

This records file identity; it is not a test result or capability evidence.
The destination must not exist. Originals and earlier actors are untouched.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: NEW_ACTOR_DIRECTORY')
root = Path.cwd().resolve()
target = Path(sys.argv[1]).resolve()
if root not in target.parents or not (root / 'dist/src/prototype.js').is_file():
    raise SystemExit('require a new workspace destination and completed build')
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
target.mkdir(parents=True, exist_ok=False)
hash_bytes = lambda value: hashlib.sha256(value).hexdigest()
files = {}
for directory in ['dist', 'scripts']:
    for source in sorted((root / directory).rglob('*')):
        if not source.is_file():
            continue
        relative = source.relative_to(root)
        data = source.read_bytes()
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        digest = hash_bytes(data)
        if hash_bytes(destination.read_bytes()) != digest:
            raise SystemExit('execution-copy verification failed: ' + str(relative))
        files[relative.as_posix()] = digest
manifest = {'version': 'FrozenNativeActor1', 'sourceCommit': commit,
            'frozenAt': datetime.now(timezone.utc).isoformat(), 'files': files}
(target / 'freeze-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'target': str(target), 'sourceCommit': commit, 'verifiedFiles': len(files)}))
