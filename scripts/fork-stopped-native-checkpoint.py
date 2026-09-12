"""Copy one verified stopped native world and its session for matched experiments.

The copies add no experience and are not new worlds or physical trials. No world
or inventory content is altered. The run harness records later actual actions.
"""
from pathlib import Path
import gzip
import hashlib
import json
import sys
import tarfile

if len(sys.argv) != 4:
    raise SystemExit('required: STOPPED_NATIVE_OUTPUT VERIFIED_WORLD_TAR_GZ NEW_PREDECESSOR')
source, archive, target = [Path(value).resolve() for value in sys.argv[1:]]
report_bytes = (source / 'results.json').read_bytes()
report = json.loads(report_bytes)
provenance = json.loads(Path(str(archive) + '.provenance.json').read_text())
hash_bytes = lambda data: hashlib.sha256(data).hexdigest()
if not report.get('stoppedAt') or not report.get('final') or report['status'] == 'running':
    raise SystemExit('source has not recorded a checkpointed shutdown')
if provenance['source'] != str(source) or provenance['stoppedAt'] != report['stoppedAt']:
    raise SystemExit('archive does not belong to this stopped run')
if hash_bytes(archive.read_bytes()) != provenance['sha256']:
    raise SystemExit('archive hash mismatch')
session_bytes = (source / 'session.json.gz').read_bytes()
session = json.loads(gzip.decompress(session_bytes))
if session['medium']['writes'] != report['final']['writes'] or session['steps'] != report['final']['decisions']:
    raise SystemExit('checkpoint does not match the final report')
target.mkdir(exist_ok=False)
runtime = target / 'runtime'
server = runtime / 'minecraft'
server.mkdir(parents=True)
with tarfile.open(archive) as package:
    package.extractall(server, filter='data')
world = server / provenance['levelName']
if not (world / 'level.dat').is_file() or not list((world / 'region').glob('*.mca')):
    raise SystemExit('archive did not contain a native world')
world_files = {str(path.relative_to(world)): hash_bytes(path.read_bytes())
               for path in sorted(world.rglob('*')) if path.is_file()}
record = {'version': 'ForkedStoppedNativeCheckpoint1', 'source': str(source),
          'sourceReportSha256': hash_bytes(report_bytes), 'sessionSha256': hash_bytes(session_bytes),
          'worldArchiveSha256': provenance['sha256'], 'worldFiles': world_files,
          'worldTreeSha256': hash_bytes(json.dumps(world_files, sort_keys=True).encode()),
          'newPhysicalTrials': 0, 'scope': 'identical stopped state for a matched continuation, not a new unfamiliar world'}
(target / 'session.json.gz').write_bytes(session_bytes)
report['runtimeRoot'] = str(runtime)
report['forkedCheckpoint'] = record
(target / 'results.json').write_text(json.dumps(report, indent=2))
(target / 'fork-provenance.json').write_text(json.dumps(record, indent=2))
print(json.dumps({'target': str(target), 'worldTreeSha256': record['worldTreeSha256'],
                  'sessionSha256': record['sessionSha256'], 'newPhysicalTrials': 0}))
