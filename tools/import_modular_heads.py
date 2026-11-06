# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow"]
# ///
"""Import the user's explicitly separated scalp/fringe/back reference parts."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw
from import_character_references import DEFAULT_VECTORIZER, describe_trace

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'docs/character-system/references/modular'
COLUMNS={'face':(0,.166),'ears':(.166,.275),'cap':(.275,.417),'fringe':(.417,.552),
         'back':(.540,.704),'eyes':(.704,.815),'assembled':(.815,1)}
LOOKS=[(6,0),(6,1),(6,2),(6,3),(4,2),(4,3),(4,4),(4,5),(6,8),(6,9),
       (4,0),(4,1),(6,4),(6,5),(6,6),(6,7),(4,6),(4,7),(4,8)]


def components(gray):
    free=np.pad((gray>=215).astype(np.uint8),1,constant_values=1)
    cv2.floodFill(free,None,(0,0),2)
    mask=(free[1:-1,1:-1]!=2).astype(np.uint8)
    count,labels,stats,_=cv2.connectedComponentsWithStats(mask)
    return labels,stats


def row_parts(sheet,count):
    image=np.asarray(Image.open(REF/'source'/f'sheet-{sheet:02}.png').convert('L'))
    h,w=image.shape
    labels,stats=components(image[:,:round(w*.166)])
    faces=sorted([s for s in stats[1:] if s[4]>1000],key=lambda s:s[1])
    if len(faces)!=count:raise ValueError(f'Unexpected face rows in sheet {sheet}')
    result=[{} for _ in faces]
    for part,(left,right) in COLUMNS.items():
        x0,x1=round(w*left),round(w*right);gray=image[:,x0:x1]
        labels,stats=components(gray)
        for row,face in enumerate(faces):
            selected=[]
            for i,s in enumerate(stats[1:],1):
                x,y,cw,ch,area=s
                if area<4:continue
                if part=='fringe' and x>gray.shape[1]*.9:continue
                if part=='eyes' and abs((x+cw*.5)-gray.shape[1]*.5)<14 and cw<25:continue
                nearest=min(range(count),key=lambda r:abs(y-faces[r][1]))
                if nearest==row:selected.append(i)
            mask=np.isin(labels,selected)
            if part=='fringe' and np.count_nonzero(mask)<100:mask[:]=False
            if part=='assembled':
                starts=[int(f[1]) for f in faces]
                top=max(0,starts[row]-15)
                bottom=starts[row+1]-8 if row+1<count else h
                mask=np.zeros_like(gray,dtype=bool);mask[top:bottom]=gray[top:bottom]<245
            if mask.any():
                yy,xx=np.nonzero(mask);box=[max(0,int(xx.min())-3),max(0,int(yy.min())-3),
                                         min(gray.shape[1],int(xx.max())+4),min(h,int(yy.max())+4)]
            else:box=[0,int(face[1]),1,int(face[1])+1]
            a,b,c,d=box
            tone=np.where(gray<65,20,np.where(gray<225,112,255)).astype(np.uint8)
            if part in ('face','ears','eyes'):tone=np.where(gray<180,20,255).astype(np.uint8)
            pixels=np.dstack([tone]*3+[mask.astype(np.uint8)*255])[b:d,a:c]
            result[row][part]={'pixels':pixels,'box':[a+x0,b,c+x0,d], 'face_box':face[:4].tolist()}
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--jobs',type=int,default=3)
    parser.add_argument('--vectorizer',type=Path,default=DEFAULT_VECTORIZER.resolve())
    args=parser.parse_args()
    for d in ('crops','vectors','derived'):(REF/d).mkdir(exist_ok=True)
    sheets={2:row_parts(2,4),4:row_parts(4,9),6:row_parts(6,10)}
    jobs=[];records=[]
    def save(key,part,record):
        path=REF/'crops'/f'{key}-{part}.png';Image.fromarray(record['pixels']).save(path)
        svg=REF/'vectors'/f'{key}-{part}.svg'
        if record['pixels'][:,:,3].any() and part!='assembled':jobs.append((path,svg))
        return {'crop':path.relative_to(REF).as_posix(),'svg':svg.relative_to(REF).as_posix(),
                'box':record['box'],'empty':not bool(record['pixels'][:,:,3].any())}
    for index,(sheet,row) in enumerate(LOOKS):
        record={'index':index,'sheet':sheet,'row':row,'parts':{}}
        for part,source in sheets[sheet][row].items():record['parts'][part]=save(f'{index:02}',part,source)
        records.append(record)
    # The outlined tousled rear silhouette has an open face-sized interior.
    # Complete its hidden coverage while retaining every outer scanline extent.
    original=records[10]['parts']['back'];rear=np.array(Image.open(REF/original['crop']).convert('RGBA'))
    records[10]['parts']['back-source']=original
    for y in range(35,rear.shape[0]):
        xx=np.flatnonzero(rear[y,:,3]>128)
        if len(xx):rear[y,xx.min():xx.max()+1]=[20,20,20,255]
    records[10]['parts']['back']=save('10','back-complete',{'pixels':rear,'box':original['box']})
    # The braid shaft is rigid; its cap contact is skinned separately. Keep
    # the source image, and trace overlapping crop masks without drawing curves.
    original=records[11]['parts']['back'];pixels=np.array(Image.open(REF/original['crop']).convert('RGBA'))
    roots=pixels.copy();roots[44:,:,3]=0
    records[11]['parts']['back-source']=original
    records[11]['parts']['back']=save('11','back-root',{'pixels':roots,'box':original['box']})
    for side in ('L','R'):
        strands=pixels.copy();strands[:42,:,3]=0
        if side=='L':strands[:,pixels.shape[1]//2:,3]=0
        else:strands[:,:pixels.shape[1]//2,3]=0
        records[11]['parts']['tied-'+side]=save('11','tied-'+side,{'pixels':strands,'box':original['box']})
    calibration=[]
    for i,row in enumerate(sheets[2]):
        calibration.append({'index':i,'parts':{p:save(f'base-{i}',p,v) for p,v in row.items()}})
    (REF/'manifest.json').write_text(json.dumps({'looks':records,'calibration':calibration},indent=2)+'\n')
    card=Image.new('RGB',(1400,19*150),'#e6e6e1');draw=ImageDraw.Draw(card)
    for i,record in enumerate(records):
        for col,(part,v) in enumerate(record['parts'].items()):
            im=Image.open(REF/v['crop']).convert('RGBA');im.thumbnail((190,126))
            card.paste(im,(col*200+(200-im.width)//2,i*150),im)
            draw.text((col*200+8,i*150+130),f'{i} {part}',fill='#252b28')
    card.save(REF/'derived/source-parts.png')
    if args.prepare_only:return
    previous={}
    if (REF/'vectorization.json').exists():
        previous={p['svg']:p for p in json.loads((REF/'vectorization.json').read_text())['results']}
    def trace(job):
        image,svg=job
        prior=previous.get(svg.relative_to(REF).as_posix())
        if svg.exists() and prior and prior['input_sha256']==hashlib.sha256(image.read_bytes()).hexdigest():return prior
        result=subprocess.run(['uv','run','--script',str(args.vectorizer),str(image),'-o',str(svg),
                               '--colors','3','--detail','.75','--smooth','.6','--background','keep','--lines','fill','--progress'],
                              check=True,capture_output=True,text=True)
        describe_trace(svg)
        data=json.loads(result.stdout.splitlines()[-1]);data.update(input=image.relative_to(REF).as_posix(),
            input_sha256=hashlib.sha256(image.read_bytes()).hexdigest(),svg=svg.relative_to(REF).as_posix())
        return data
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        traced=[]
        for data in pool.map(trace,jobs):traced.append(data);print(f'Traced {data["svg"]}',flush=True)
    (REF/'vectorization.json').write_text(json.dumps({'tool':str(args.vectorizer),'lines':'fill','detail':.75,'smooth':.6,'results':traced},indent=2)+'\n')


if __name__=='__main__':main()
