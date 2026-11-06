# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "Pillow"]
# ///
"""Refine low-fidelity logperch curves, retaining only measured improvements."""
import json, shutil, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'docs/character-system/references/pool'

def main():
    tracefile=REF/'vectorization.json'
    data=json.loads(tracefile.read_text())
    def refine(row):
        with tempfile.TemporaryDirectory(prefix='hearthold-refine-') as temporary:
            folder=Path(temporary);source=REF/row['input'];svg=REF/row['svg']
            mask=np.array(Image.open(source).convert('RGBA'))[:,:,3]>127
            def fidelity(vector):
                png=folder/'result.png'
                subprocess.run(['resvg',str(vector),str(png)],check=True,capture_output=True)
                result=np.array(Image.open(png).convert('RGBA'))[:,:,3]>127
                return float(np.count_nonzero(mask&result)/max(1,np.count_nonzero(mask|result)))
            before=fidelity(svg)
            row['mask_iou']=before
            if before>=.97 or np.count_nonzero(mask)<40:return row
            candidate=folder/'refined.svg'
            cmd=['uv','run','--script',data['tool'],str(source),'-o',str(candidate),
                 '--colors','8' if 'colour-' in source.stem else '3','--detail','1',
                 '--smooth','.1','--background','keep','--lines','fill','--progress']
            result=subprocess.run(cmd,check=True,capture_output=True,text=True)
            after=fidelity(candidate)
            if after>before:
                shutil.copyfile(candidate,svg)
                shutil.copyfile(candidate.with_suffix('.palette.json'),svg.with_suffix('.palette.json'))
                row.update(json.loads(result.stdout.splitlines()[-1]))
                row.update(svg=str(svg.relative_to(REF)),mask_iou=after,
                           settings={'detail':1,'smooth':.1,'lines':'fill'},previous_iou=before)
                print(f'{svg.name}: {before:.4f} -> {after:.4f}',flush=True)
            return row
    with ThreadPoolExecutor(max_workers=3) as pool:
        results=[]
        for row in pool.map(refine,data['results']):
            results.append(row)
            # Save incremental results without losing entries still being checked.
            updated={r['input']:r for r in results}
            data['results']=[updated.get(r['input'],r) for r in data['results']]
            tracefile.write_text(json.dumps(data,indent=2)+'\n')
    print('Refinement complete:',len(results),'traces')

if __name__=='__main__':main()
