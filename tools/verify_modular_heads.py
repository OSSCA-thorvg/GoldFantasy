#!/usr/bin/env python3
"""Independent source/provenance and path-transform checks for modular heads."""
import hashlib,json,math,re,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];REF=ROOT/'docs/character-system/references/modular'
TOKEN=re.compile(r'[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')
def paths(file):
 result=[]
 for n in ET.parse(file).getroot().iter():
  assert n.tag.rsplit('}',1)[-1]!='image','Raster embedded in vector asset'
  if n.tag.rsplit('}',1)[-1]!='path':continue
  t=TOKEN.findall(n.attrib['d']);i=0;commands=[]
  while i<len(t):
   c=t[i];i+=1;count={'M':2,'L':2,'C':6,'Z':0}[c];commands.append([c]+list(map(float,t[i:i+count])));i+=count
  result.append(commands)
 return result

def mapped(commands,at):
 result=[]
 for c in commands:
  out=[c[0]]
  for j in range(1,len(c),2):out+=list(at(c[j],c[j+1]))
  result.append(out)
 return result

def equal(a,b):
 return len(a)==len(b) and all(x[0]==y[0] and len(x)==len(y) and all(abs(u-v)<.000011 for u,v in zip(x[1:],y[1:])) for x,y in zip(a,b))

def main():
 source=json.loads((REF/'source-manifest.json').read_text()) if (REF/'source-manifest.json').exists() else json.loads((REF.parent/'modular/source-manifest.json').read_text())
 for row in source:
  assert hashlib.sha256((ROOT/row['file']).read_bytes()).hexdigest()==row['sha256'],'Original sheet changed'
 traces=json.loads((REF/'vectorization.json').read_text())['results']
 for row in traces:assert hashlib.sha256((REF/row['input']).read_bytes()).hexdigest()==row['input_sha256'],'Trace input changed'
 manifest=json.loads((REF/'manifest.json').read_text());data=json.loads((ROOT/'src/game/assets/characters/modular-heads.json').read_text());verified=0
 for head,row in zip(data['looks'],manifest['looks']):
  r=head['registration'];cx,base=r['origin'];scale=r['scale'];crown=r['crown_y'];yscale=r['contact_y_scale']
  def cap(x,y):return ((x-cx)*scale,(y-base)*yscale if y>=crown else -3.5+(y-crown)*scale)
  candidates=[mapped(p,cap) for p in paths(REF/row['parts']['cap']['svg'])]
  for p in head['cap']:assert any(equal(p['commands'],q) for q in candidates),'Cap source path changed';verified+=1
  r=head['registration']['fringe']
  if r:
   if r['kind']=='similarity':
    def fringe(x,y):return ((x-r['origin'][0])*r['scale'],(y-r['origin'][1])*r['scale'])
   else:
    def fringe(x,y):
     f=r['frames'][0 if x<r['middle'] else 1];vx=x-f['origin'][0];vy=y-f['origin'][1];co=f['cos_scale'];si=f['sin_scale']
     return (co*vx-si*vy,-3.5+si*vx+co*vy)
    for f in r['frames']:assert f['cos_scale']**2+f['sin_scale']**2>0,'Invalid similarity frame'
   candidates=[mapped(p,fringe) for p in paths(REF/row['parts']['fringe']['svg'])]
   for p in head['fringe']:assert any(equal(p['commands'],q) for q in candidates),'Fringe was sheared or redrawn';verified+=1
  for part in ('cap','fringe','back','tied'):
   for p in head[part]:assert all(math.isfinite(x) for c in p['commands'] for x in c[1:]),'Nonfinite vector control'
  assert len(paths(REF/'derived/parts'/f'{row["index"]:02}-hair.svg'))==sum(len(head[p]) for p in ('cap','fringe','back','tied'))
 report={'sourceSheets':len(source),'traceInputs':len(traces),'hairstyles':len(data['looks']),'cranialBases':len(data['bases']),'nativeCorrectives':len(data['correctives']),'independentlyCheckedCapAndFringePaths':verified,'result':'source hashes, editable vectors, cap contact transforms and similarity-only fringe registration verified'}
 (REF/'derived/source-check.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
