# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow"]
# ///
"""Separate reference skulls, ears and completed wigs before logperch tracing."""
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
from character_reference_fit import reference_pose, hair_registration

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "docs/character-system/references"
LAYERS = REF / "layers"
LONG_BACK = {1, 6, 11, 12}


def record_traces(vectorizer):
    entries=[]
    for svg in sorted(LAYERS.glob('*.svg')):
        source=svg.with_suffix('.png')
        entries.append({'svg':svg.relative_to(REF).as_posix(),'input':source.relative_to(REF).as_posix(),
                        'input_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                        'svg_sha256':hashlib.sha256(svg.read_bytes()).hexdigest(),
                        'background':'keep' if 'ear-' in svg.stem or svg.stem.endswith('skull') else 'auto'})
    (LAYERS/'vectorization.json').write_text(json.dumps({'tool':str(vectorizer),'colors':3,'detail':.65,'smooth':.65,
                                                       'lines':'fill','results':entries},indent=2)+'\n')


def opaque_shape(ink):
    free = np.pad((~ink).astype(np.uint8), 1, constant_values=1)
    cv2.floodFill(free, None, (0, 0), 2)
    return free[1:-1, 1:-1] != 2


def face_layers(gray, ear_band=None):
    ink = gray < 180
    full = opaque_shape(ink)
    yy, xx = np.nonzero(full)
    top, bottom = int(yy.min()), int(yy.max())
    height = bottom - top
    cx = float(np.median(np.flatnonzero(full[top + int(height*.18)])))
    left = np.full(gray.shape[0], cx); right = left.copy()
    for y in range(top, bottom+1):
        row = np.flatnonzero(full[y]); left[y], right[y] = row[0], row[-1]
    a,b=ear_band if ear_band is not None else (top+round(height*.30),top+round(height*.80))
    for values in (left, right):
        # Ear interiors are not skull edges. Interpolate only the concealed
        # side between the visible cranium and jaw, using their source tangents.
        step=max(3,round(height*.06))
        begin,end=values[a],values[b]
        da=(values[a]-values[a-step])/step;db=(values[b+step]-values[b])/step
        for y in range(a,b+1):
            t=(y-a)/(b-a)
            values[y]=(2*t**3-3*t*t+1)*begin+(t**3-2*t*t+t)*(b-a)*da+(-2*t**3+3*t*t)*end+(t**3-t*t)*(b-a)*db
        segment = values[top:bottom+1].astype(np.float32)
        values[top:bottom+1] = cv2.GaussianBlur(cv2.medianBlur(segment, 5), (1, 5), .8).reshape(-1)
    skull = np.zeros_like(full, dtype=np.uint8)
    contour = [(left[y], y) for y in range(top, bottom+1)] + [(right[y], y) for y in range(bottom, top-1, -1)]
    cv2.fillPoly(skull, [np.rint(contour).astype(np.int32)], 1)
    skull_image = np.full_like(gray, 255)
    boundary, _ = cv2.findContours(skull, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Only the concealed attachment is reconstructed; source ears and all
    # visible skull proportions come from the original blank-face drawing.
    cv2.drawContours(skull_image, boundary, -1, 20, max(2, round(height*.015)))
    skull_rgba = np.dstack([skull_image]*3 + [skull.astype(np.uint8)*255])
    ears = []
    roots = []
    for side, edge in ((-1, left), (1, right)):
        region = np.zeros_like(full)
        for y in range(top+int(height*.30), top+int(height*.79)):
            x = int(round(edge[y]))
            if side < 0: region[y, :x] = full[y, :x]
            else: region[y, x+1:] = full[y, x+1:]
        count, labels, stats, _ = cv2.connectedComponentsWithStats(region.astype(np.uint8))
        chosen = max(range(1,count), key=lambda i:stats[i,cv2.CC_STAT_AREA])
        region = labels == chosen
        ey, ex = np.nonzero(region)
        root_y = float((ey.min()+ey.max())*.5)
        root_x = float(edge[round(root_y)])
        # A short uninked overlap sits under the separate skull, not a box
        # cropped out of the already assembled face.
        for y in range(int(ey.min()), int(ey.max())+1):
            x = int(round(edge[y]))
            if side < 0: region[y, max(0,x-3):min(gray.shape[1],x+4)] = full[y,max(0,x-3):min(gray.shape[1],x+4)]
            else: region[y,max(0,x-3):min(gray.shape[1],x+4)] = full[y,max(0,x-3):min(gray.shape[1],x+4)]
        colors = np.where(ink, 20, 255).astype(np.uint8)
        ears.append(np.dstack([colors]*3+[region.astype(np.uint8)*255]))
        roots.append([root_x, root_y])
    return skull_rgba, ears, {"crown":[cx,top],"chin":[cx,bottom],"ear_roots":roots,
                              "skull_rows":[[float(y),float(left[y]),float(right[y])] for y in range(top,bottom+1)]}


def hair_layers(index, gray, registration, skull, face_record):
    # Twin loops' construction drawing contains two skin/ear cut-outs. These
    # are healed in source space, before any face or ear is selected.
    healed = gray.copy()
    if index == 3:
        for polygon in ([[62,108],[83,107],[88,137],[100,162],[64,153],[57,132]],
                        [[185,106],[204,107],[209,136],[177,160],[171,154],[181,133]]):
            cv2.fillPoly(healed,[np.asarray(polygon,np.int32)],112)
        for controls in (((83,109),(84,127),(87,144),(100,162)),
                         ((184,108),(182,129),(180,147),(172,158))):
            curve=np.asarray(controls,float);samples=[]
            for t in np.linspace(0,1,40):
                u=1-t;samples.append(curve[0]*u**3+curve[1]*3*u*u*t+curve[2]*3*u*t*t+curve[3]*t**3)
            cv2.polylines(healed,[np.rint(samples).astype(np.int32)],False,20,2)
    if index == 9:
        for polygon in ([[44,98],[73,97],[73,127],[70,154],[42,154],[39,123]],
                        [[198,96],[225,98],[231,126],[215,151],[207,151],[201,126]]):
            cv2.fillPoly(healed, [np.asarray(polygon,np.int32)], 112)
        for controls in (((72,99),(73,116),(73,134),(70,154)),
                         ((200,98),(200,117),(205,137),(208,151))):
            curve=np.asarray(controls,float)
            samples=[]
            for t in np.linspace(0,1,40):
                u=1-t;samples.append(curve[0]*u**3+curve[1]*3*u*u*t+curve[2]*3*u*t*t+curve[3]*t**3)
            cv2.polylines(healed,[np.rint(samples).astype(np.int32)],False,20,2,cv2.LINE_AA)
    mask = healed < 235
    yy, xx = np.nonzero(mask)
    # Complete the hidden back mass without moving its existing outside edge.
    # Twin tails/buns keep their separated tails; long loose hair has a full
    # curtain behind the head and copied outfit.
    back = np.zeros_like(mask)
    crown=(-3.2-registration['offset'][1])/registration['scale']
    chin=(3.2-registration['offset'][1])/registration['scale']
    end = yy.max() if index in LONG_BACK else min(yy.max(),int(chin))
    cx=gray.shape[1]*.5
    if index not in {9,15,18}:
        for y in range(max(0,int(crown)), int(end)+1):
            row = np.flatnonzero(mask[y]);left=row[row<cx];right=row[row>=cx]
            if len(left) and len(right):back[y,left[-1]:right[0]+1]=True
    # Keep source tufts and separated tips. The completion contributes only
    # unseen interior pixels; it never expands the source outer silhouette.
    back |= mask
    crown,chin=np.asarray(face_record['crown']),np.asarray(face_record['chin'])
    face_scale=6.4/(chin[1]-crown[1]);origin=(crown+chin)*.5
    factor=face_scale/registration['scale']
    offset=(-origin*face_scale-np.asarray(registration['offset']))/registration['scale']
    transform=np.array([[factor,0,offset[0]],[0,factor,offset[1]]])
    scalp=cv2.warpAffine(skull[:,:,3],transform,(gray.shape[1],gray.shape[0]),flags=cv2.INTER_NEAREST)>0
    back |= scalp
    shadow = np.where(back,20,255).astype(np.uint8)
    return healed, shadow


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vectorizer',type=Path,default=DEFAULT_VECTORIZER.resolve())
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--jobs',type=int,default=3)
    parser.add_argument('--only',type=int,nargs='+',help='Retrace selected reference indices; keep other SVGs')
    args=parser.parse_args()
    LAYERS.mkdir(exist_ok=True)
    jobs=[];metadata=[]
    contact=Image.new('RGB',(1200,19*160),'#d4dcd4');draw=ImageDraw.Draw(contact)
    controls=json.loads((REF.parent/'reference-registration.json').read_text())['references']
    for i in range(19):
        face=np.asarray(Image.open(REF/'flat-crops'/f'{i:02}-face.png').convert('L'))
        hair=np.asarray(Image.open(REF/'flat-crops'/f'{i:02}-hair.png').convert('L'))
        skull,ears,record=face_layers(face)
        figure=np.asarray(Image.open(REF/'crops'/f'{i:02}-figure.png').convert('L'))
        original_hair=np.asarray(Image.open(REF/'crops'/f'{i:02}-hair.png').convert('L'))
        registration=hair_registration(original_hair,figure,controls[i],reference_pose(figure,controls[i]))
        front,back=hair_layers(i,hair,registration,skull,record)
        record.update(index=i, source_face=f'flat-crops/{i:02}-face.png', source_hair=f'flat-crops/{i:02}-hair.png',
                      healed_hair_ears=i in {3,9}, full_length_back=i in LONG_BACK)
        metadata.append(record)
        for column,(name,pixels) in enumerate((('skull',skull),('ear-L',ears[0]),('ear-R',ears[1]),('hair',front),('back',back))):
            path=LAYERS/f'{i:02}-{name}.png';Image.fromarray(pixels).save(path)
            jobs.append((path,path.with_suffix('.svg')))
            im=Image.fromarray(pixels).convert('RGBA');im.thumbnail((218,132))
            x=column*240+(240-im.width)//2;y=i*160+4
            contact.paste(im,(x,y),im);draw.text((column*240+12,i*160+140),f'{i} {name}',fill='#252b28')
        mask=LAYERS/f'{i:02}-skull-mask.png'
        Image.fromarray(np.where(skull[:,:,3]>0,20,255).astype(np.uint8)).save(mask)
        jobs.append((mask,mask.with_suffix('.svg')))
    contact.save(REF/'derived/layer-extraction.png')
    (LAYERS/'manifest.json').write_text(json.dumps({'version':1,'notes':'Hidden skull attachments and back interiors are inferred; original source images are unchanged. Ears are separate source parts, not wig geometry.', 'heads':metadata},indent=2)+'\n')
    if args.prepare_only:return
    if args.only:jobs=[job for job in jobs if int(job[0].stem[:2]) in args.only]
    def trace(job):
        source,destination=job
        subprocess.run(['uv','run','--script',str(args.vectorizer),str(source),'-o',str(destination),
                        '--colors','3','--detail','.65','--smooth','.65','--background','keep' if 'ear-' in source.stem or source.stem.endswith('skull') else 'auto',
                        '--lines','fill'],check=True,capture_output=True,text=True)
        describe_trace(destination)
        return destination.name
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for name in pool.map(trace,jobs):print(f'Traced layer {name}',flush=True)
    record_traces(args.vectorizer)


if __name__=='__main__':main()
