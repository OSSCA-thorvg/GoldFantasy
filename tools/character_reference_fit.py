"""Uniform source registration and anatomy measurements; no path warping."""
from __future__ import annotations
import numpy as np
import cv2

FACE_LEVELS = [-2.15, -.65, .15, 1.15, 2.15, 2.8]


def reference_pose(gray, controls):
    crown, chin = np.asarray(controls['figure_crown']), np.asarray(controls['figure_chin'])
    scale = 6.4 / (chin[1] - crown[1])
    origin = np.array([crown[0], (crown[1] + chin[1])*.5])
    eyes = np.asarray(controls['figure_eyes'], dtype=float)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((gray > 220).astype(np.uint8))
    x, y = np.rint(chin).astype(int)
    nearby = labels[max(0,y-8):y-2, max(0,x-4):x+5]
    choices = sorted(range(1,count), key=lambda i: int((nearby==i).sum()), reverse=True)
    face = next(i for i in choices if stats[i,0]>0 and stats[i,1]>0 and
                stats[i,0]+stats[i,2]<gray.shape[1] and stats[i,1]+stats[i,3]<gray.shape[0])
    mask = labels == face
    eye_span = eyes[1,0]-eyes[0,0]
    eye_y = float(((eyes[:,1].mean()-origin[1])*scale))
    def edges(canonical_y):
        row = int(round(origin[1]+canonical_y/scale))
        xx = np.flatnonzero(mask[max(0,row-1):row+2].any(axis=0))
        if not len(xx): raise ValueError('Missing reference cheek/jaw contour')
        lo,hi = max(xx.min()-.8,crown[0]-eye_span*1.08),min(xx.max()+.8,crown[0]+eye_span*1.08)
        return (np.array([lo,hi])-origin[0])*scale
    samples = [edges(eye_y+(3.2-eye_y)*t) for t in [.08,.2,.35]]
    temple = [min(p[0] for p in samples), max(p[1] for p in samples)]
    return {'scale':float(scale), 'origin':origin, 'eye_y':eye_y,'skin_mask':mask,'controls':controls,
            'eye_spacing':float(eye_span*.5*scale), 'eye_radius':float(eye_span*.255*scale),
            'edges':edges, 'temple':temple}


def hair_registration(hair, figure, controls, pose):
    scale = controls['hair_to_figure_scale']
    if 'hair_to_figure_offset' in controls:
        offset = controls['hair_to_figure_offset'];score=1.0
    else:
        height=min(hair.shape[0],int(hair.shape[1]*(.45 if hair.shape[0]>hair.shape[1]*1.2 else .92)))
        patch=hair[:height];_,xx=np.nonzero(patch<210);crop_x=int(xx.min());patch=patch[:,crop_x:int(xx.max())+1]
        size=(int(patch.shape[1]*scale),int(patch.shape[0]*scale))
        patch=cv2.resize(patch,size,interpolation=cv2.INTER_AREA)
        target=figure[:min(figure.shape[0],int(controls['figure_chin'][1]+size[0]*.8))]
        match=cv2.matchTemplate(target,patch,cv2.TM_CCOEFF_NORMED)
        crown=controls['figure_crown'];span=pose['eye_spacing']/pose['scale']
        x0=max(0,int(crown[0]-size[0]*.5-span*.4));x1=min(match.shape[1],int(crown[0]-size[0]*.5+span*.4)+1)
        y1=min(match.shape[0],int(controls['figure_eyes'][0][1]*.65)+1)
        _,score,_,loc=cv2.minMaxLoc(match[:y1,x0:x1]);offset=[loc[0]+x0-crop_x*scale,loc[1]]
    return {'scale':float(scale*pose['scale']), 'offset':((np.asarray(offset)-pose['origin'])*pose['scale']).tolist(),
            'figure_scale':scale,'figure_offset':list(offset),'score':float(score)}
