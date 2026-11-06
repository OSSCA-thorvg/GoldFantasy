"""Check source integrity, exact bilateral construction and production release status."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    data=json.loads((ROOT/'src/game/assets/characters/character-pool.json').read_text())
    source=json.loads((ROOT/'docs/character-system/references/pool/clean/manifest.json').read_text())
    for r in source['results'].values():
        for path,key in [('source','sourceSha256'),('input','inputSha256')]:assert hashlib.sha256((ROOT/r[path]).read_bytes()).hexdigest()==r[key],r[path]
        if r.get('parentSource'):assert hashlib.sha256((ROOT/r['parentSource']).read_bytes()).hexdigest()==r['parentSourceSha256']
    for f in data['faces']:
        for l,r in zip(f['anchors'][1:13:2],f['anchors'][2:14:2]):assert l[0]==-r[0] and l[1]==r[1]
        assert f['ear_roots'][0][0]==-f['ear_roots'][1][0] and f['ear_roots'][0][1]==f['ear_roots'][1][1]
        assert len(f['paths'])==1 and f['paths'][0]['outline']
        for l,r in zip(f['ears'][0],f['ears'][1]):
            assert len(l['commands'])==len(r['commands'])
            for a,b in zip(l['commands'],r['commands']):
                assert a[0]==b[0]
                for j,(x,y) in enumerate(zip(a[1:],b[1:])):assert x==(-y if j%2==0 else y)
    ready=[i for i,h in enumerate(data['looks']) if h['ready']]
    assert ready==[i for i in range(20) if i!=10]+[49]
    assert data['looks'][10]['retired'] and data['looks'][10]['fallback']==17
    for h in data['looks']:assert h['fallback'] in ready
    report={'symmetricFaces':len(data['faces']),'mirroredEarPairs':len(data['faces']),'sourceHashesVerified':len(source['results']),'readyReferences':ready,'archivedReferences':len(data['looks'])-len(ready),'outerStroke':.075,'innerStroke':.055}
    out=ROOT/'docs/character-system/references/pool/derived/finish-audit.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
