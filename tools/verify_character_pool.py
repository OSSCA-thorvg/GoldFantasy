# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "Pillow"]
# ///
"""Measure actual logperch trace coverage against its recorded RGBA input."""
import json,hashlib,re,subprocess,tempfile
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];REF=ROOT/'docs/character-system/references/pool'
def main():
 traces=json.loads((REF/'vectorization.json').read_text());rows=[]
 sources=json.loads((REF/'source-manifest.json').read_text())
 for row in sources:assert hashlib.sha256((ROOT/row['file']).read_bytes()).hexdigest()==row['sha256'],row['file']
 old=(ROOT/'docs/portrait-style/reference_manifest.yaml').read_text()
 for name,sha in re.findall(r'file: (references/source/[^\n]+)\n\s+sha256: ([a-f0-9]+)',old):
  assert hashlib.sha256((ROOT/'docs/portrait-style'/name).read_bytes()).hexdigest()==sha,name
 with tempfile.TemporaryDirectory(prefix='hearthold-trace-qa-') as temporary:
  for i,row in enumerate(traces['results']):
   source=REF/row['input'];assert hashlib.sha256(source.read_bytes()).hexdigest()==row['input_sha256'],str(source)
   png=Path(temporary)/f'{i}.png';subprocess.run(['resvg',str(REF/row['svg']),str(png)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   a=np.array(Image.open(source).convert('RGBA'))[:,:,3]>127;b=np.array(Image.open(png).convert('RGBA'))[:,:,3]>127
   assert a.shape==b.shape
   union=np.count_nonzero(a|b);score=np.count_nonzero(a&b)/max(1,union)
   rows.append({'svg':row['svg'],'sourcePixels':int(np.count_nonzero(a)),'intersectionOverUnion':float(score)})
 report={'tool':traces['tool'],'settings':traces['settings'],'sourceImageHashes':14,'traces':len(rows),'meanIoU':sum(x['intersectionOverUnion'] for x in rows)/len(rows),'minimumIoU':min(x['intersectionOverUnion'] for x in rows),'results':rows}
 (REF/'derived/vector-fidelity.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k!='results'}))
 print('Lowest fidelity:',sorted(rows,key=lambda x:x['intersectionOverUnion'])[:8])
if __name__=='__main__':main()
