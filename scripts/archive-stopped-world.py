"""Archive and verify the configured native world after its server has stopped."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tarfile

if len(sys.argv) != 3:
    raise SystemExit('required: STOPPED_NATIVE_OUTPUT NEW_ARCHIVE_TAR_GZ')
source, output = map(lambda value: Path(value).resolve(), sys.argv[1:])
report = json.loads((source / 'results.json').read_text())
if not report.get('stoppedAt') or not report.get('final') or report['status'] == 'running':
    raise SystemExit('native server has not recorded a completed shutdown')
root = Path(report['runtimeRoot']) / 'minecraft'
properties = root / 'server.properties'
level_name = next((line.split('=', 1)[1].strip() for line in properties.read_text().splitlines()
                   if line.startswith('level-name=')), 'world')
relative = Path(level_name)
if relative.is_absolute() or '..' in relative.parts or '\\' in level_name:
    raise SystemExit('unsupported configured world path')
world = root / relative
level = world / 'level.dat'
regions = sorted((world / 'region').glob('*.mca'))
if not level.is_file() or not regions or any(path.stat().st_size < 8192 for path in regions):
    raise SystemExit('configured world is missing level.dat or valid region files')
if gzip.decompress(level.read_bytes())[:1] != b'\x0a':
    raise SystemExit('level.dat is not a compressed NBT compound')
with tarfile.open(output, 'x:gz') as archive:
    archive.add(world, arcname=level_name)
    archive.add(properties, arcname='server.properties')
    if (root / 'logs').exists():
        archive.add(root / 'logs', arcname='logs')
with tarfile.open(output) as archive:
    names = set(archive.getnames())
    assert str(relative / 'level.dat') in names
    assert all(str(relative / 'region' / path.name) in names for path in regions)
    assert archive.extractfile(str(relative / 'level.dat')).read() == level.read_bytes()
result = {'source': str(source), 'stoppedAt': report['stoppedAt'], 'levelName': level_name,
          'regions': len(regions), 'output': str(output), 'bytes': output.stat().st_size,
          'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
with Path(str(output) + '.provenance.json').open('x') as file:
    json.dump(result, file, indent=2)
print(json.dumps(result))
