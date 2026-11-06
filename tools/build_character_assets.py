# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow"]
# ///
"""Compile logperch SVG traces into editable, embedded character construction data."""
from __future__ import annotations

import json
import math
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import cv2
import numpy as np
from PIL import Image
from character_reference_fit import reference_pose, hair_registration, FACE_LEVELS

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "docs/character-system/references"
OUT = ROOT / "src/game/assets/characters"
TOKEN = re.compile(r"[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")


def paths(svg: Path) -> list[dict]:
    result = []
    for node in ET.parse(svg).getroot().iter():
        if node.tag.rsplit("}", 1)[-1] != "path":
            continue
        color = node.get("stroke", node.get("fill", "#141414"))
        if color == "none":
            color = node.get("fill", "#141414")
        tone = int(color[1:3], 16)
        tokens = TOKEN.findall(node.attrib["d"])
        current = []
        i = 0
        while i < len(tokens):
            cmd = tokens[i]; i += 1
            count = {"M": 2, "L": 2, "C": 6, "Z": 0}[cmd]
            if cmd == "M" and current and float(node.get("stroke-width", 0)) > 0:
                result.append({"commands": current, "tone": tone, "stroke": float(node.get("stroke-width", 0)), "evenodd": node.get("fill-rule") == "evenodd"})
                current = []
            current.append([cmd] + [float(x) for x in tokens[i:i + count]])
            i += count
        if current:
            result.append({"commands": current, "tone": tone, "stroke": float(node.get("stroke-width", 0)), "evenodd": node.get("fill-rule") == "evenodd"})
    return result


def normalized(parts: list[dict], center: tuple[float, float], scale: float) -> list[dict]:
    output = []
    for part in parts:
        commands = []
        for command in part["commands"]:
            values = [round((value - center[j % 2]) * scale, 5) for j, value in enumerate(command[1:])]
            commands.append([command[0]] + values)
        output.append({**part, "commands": commands, "stroke": round(part["stroke"] * scale, 5)})
    return output


def points(part: dict) -> np.ndarray:
    values = []
    for command in part["commands"]:
        values.extend(zip(command[1::2], command[2::2]))
    return np.asarray(values, dtype=float)


def render(svg: Path) -> np.ndarray:
    destination = Path("/tmp") / ("hearthold-character-trace-" + svg.stem + ".png")
    subprocess.run(["resvg", str(svg), str(destination)], check=True, stdout=subprocess.DEVNULL)
    im = Image.open(destination).convert("RGBA")
    background = Image.new("RGBA", im.size, "white"); background.alpha_composite(im)
    return np.asarray(background.convert("L"))


def cubic_fit(samples: np.ndarray, clamp: bool = True) -> list[list[float]]:
    if len(samples) < 3:
        a, b = samples[0], samples[-1]
        return [list(a * 2 / 3 + b / 3), list(a / 3 + b * 2 / 3), list(b)]
    distance = np.r_[0, np.cumsum(np.linalg.norm(np.diff(samples, axis=0), axis=1))]
    t = distance / max(distance[-1], 1e-6)
    u = 1 - t
    basis = np.c_[3 * u * u * t, 3 * u * t * t]
    residual = samples - u[:, None] ** 3 * samples[0] - t[:, None] ** 3 * samples[-1]
    control = np.linalg.lstsq(basis, residual, rcond=None)[0]
    # Extreme noisy tangent handles are not part of the source's construction grammar.
    if clamp:
        # Each left/top/right/bottom quarter must stay monotone inside its
        # endpoint rectangle. Unconstrained least squares can create small
        # inward hooks at corners even when the sampled hull is convex.
        control = np.clip(control, np.minimum(samples[0], samples[-1]), np.maximum(samples[0], samples[-1]))
        for axis in range(2):
            direction = samples[-1, axis] - samples[0, axis]
            if (control[1, axis] - control[0, axis]) * direction < 0:
                control[:, axis] = control[:, axis].mean()
    return [list(control[0]), list(control[1]), list(samples[-1])]


def eye_model(gray: np.ndarray) -> dict:
    h, w = gray.shape
    mask = (gray[:, :w // 2] < 150).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask)
    selected = np.zeros_like(mask)
    for i in range(1, count):
        x, y, cw, ch, area = stats[i]
        if centroids[i][1] > h * .34 and x + cw < w * .46 and area > 3:
            selected[labels == i] = 1
    yy, xx = np.nonzero(selected)
    if len(xx) < 8:
        raise ValueError("No closed eye aperture in vectorized reference")
    # The ink can be a thin open ribbon, not a filled aperture. Its convex envelope
    # recovers the closed eye boundary without following both sides of that ribbon.
    contour = cv2.convexHull(np.c_[xx, yy].astype(np.int32))[:, 0].astype(float)
    x0, y0 = contour.min(axis=0); x1, y1 = contour.max(axis=0)
    cx, cy, rx = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2
    contour = (contour - [cx, cy]) / rx
    # A single four-cubic topology for every round/soft/almond/half-lidded eye.
    indices = [int(np.argmin(contour[:, 0])), int(np.argmin(contour[:, 1])), int(np.argmax(contour[:, 0])), int(np.argmax(contour[:, 1]))]
    # cv2 contours run clockwise in image coordinates only after this orientation correction.
    if ((indices[1] - indices[0]) % len(contour)) > ((indices[3] - indices[0]) % len(contour)):
        contour = contour[::-1]
        indices = [len(contour) - 1 - i for i in indices]
    fitted = [list(contour[indices[0]])]
    for i in range(4):
        a, b = indices[i], indices[(i + 1) % 4]
        segment = contour[a:b + 1] if b > a else np.r_[contour[a:], contour[:b + 1]]
        fitted.extend(cubic_fit(segment))
    # Read pupil size from the traced black area inside the outline, using its distance peak.
    inner = np.zeros_like(mask)
    polygon = np.rint(contour * rx + [cx, cy]).astype(np.int32)
    cv2.fillPoly(inner, [polygon], 1)
    dist = cv2.distanceTransform(mask * inner, cv2.DIST_L2, 5)
    dist[:max(0, int(y0 + 3))] = 0
    _, radius, _, pupil = cv2.minMaxLoc(dist)
    brows = [i for i in range(1, count) if centroids[i][1] < y0 and
             stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] < w * .46 and
             stats[i, cv2.CC_STAT_WIDTH] > rx * .65]
    if not brows:
        raise ValueError("No eyebrow above the traced eye")
    brow = labels == max(brows, key=lambda i: stats[i, cv2.CC_STAT_WIDTH])
    samples = np.asarray([(x, np.median(np.flatnonzero(brow[:, x]))) for x in range(brow.shape[1]) if brow[:, x].any()])
    samples = (samples - [cx, cy]) / rx
    brow_curve = [list(samples[0]), *cubic_fit(samples, clamp=False)]
    return {"points": [[round(float(x), 5) for x in p] for p in fitted],
            "brow": [[round(float(x), 5) for x in p] for p in brow_curve],
            "aspect": round((y1 - y0) / (x1 - x0), 5), "pupil_radius": round(float(np.clip(radius / rx, .45, .75)), 5),
            "pupil_x": round(float(np.clip((pupil[0] - cx) / rx, -.18, .18)), 5)}


def face_model(gray: np.ndarray, raw: list[dict]) -> dict:
    h, w = gray.shape
    ink = gray < 180
    yy, xx = np.nonzero(ink)
    scale = 6.4 / (yy.max() - yy.min())
    center = ((xx.min() + xx.max()) / 2, (yy.min() + yy.max()) / 2)
    canonical = normalized(raw, center, scale)
    # The scan above the ears gives a temple measurement without including the pinnae.
    row = int(center[1] - 1.35 / scale)
    xs = np.flatnonzero(ink[max(0, row - 1):row + 2].any(axis=0))
    temple = (xs.max() - xs.min()) * .5 * scale * 1.06
    output = []
    mouth = None
    for part in canonical:
        p = points(part)
        if not len(p): continue
        lo, hi = p.min(axis=0), p.max(axis=0)
        if max(abs(lo[0]), abs(hi[0])) < .65 and lo[1] > .9:
            if lo[1] > 1.65 and hi[0] - lo[0] > .09:
                mouth = {"width": float(hi[0] - lo[0]), "y": float((lo[1] + hi[1]) / 2), "curve": float((hi[1] - lo[1]) * .3)}
            continue
        output.append(part)
    return {"paths": output, "temple": round(float(temple), 5), "mouth": mouth or {"width": .3, "y": 2.04, "curve": 0}}


def separated_face(raw: list[dict], ears: list[list[dict]], record: dict, mouth: dict) -> dict:
    crown, chin = np.asarray(record['crown']), np.asarray(record['chin'])
    scale=6.4/(chin[1]-crown[1]);origin=(crown+chin)*.5
    rows=np.asarray(record['skull_rows'])
    def side(y):
        row=rows[np.abs(rows[:,0]-(origin[1]+y/scale)).argmin()]
        return ((row[1:]-origin[0])*scale).tolist()
    anchors=[[0,-3.2]]
    for y in FACE_LEVELS:
        left,right=side(y);anchors.extend([[left,y],[right,y]])
    anchors.append([0,3.2])
    roots=[((np.asarray(p)-origin)*scale).tolist() for p in record['ear_roots']]
    scalp_widths=[[-side(y)[0],side(y)[1]] for y in np.linspace(-2.8,-.7,8)]
    anchors.extend(roots)
    normalized_ears=[normalized(parts,tuple(root),scale) for parts,root in zip(ears,record['ear_roots'])]
    return {'paths':normalized(raw,tuple(origin),scale),'temple':float((side(-.4)[1]-side(-.4)[0])*.5),
            'mouth':mouth,'anchors':anchors,'scalp_widths':scalp_widths,'ear_roots':roots,'ears':normalized_ears,
            'copy_transform':{'origin':origin.tolist(),'scale':scale}}


def hair_model(gray: np.ndarray, raw: list[dict], back: list[dict], figure: np.ndarray, controls: dict, pose: dict) -> dict:
    registration=hair_registration(gray,figure,controls,pose)
    scale=registration['scale'];offset=np.asarray(registration['offset'])
    canonical=normalized(raw,tuple(-offset/scale),scale)
    canonical=[p for p in canonical if p['tone']<235]
    cloud=np.concatenate([points(p) for p in canonical])
    lo,hi=cloud.min(axis=0),cloud.max(axis=0)
    front_end=3.5  # The layer hand-off is below the chin, never across a cheek.
    return {'paths':canonical,'back':normalized(back,tuple(-offset/scale),scale),
            'front_end':front_end,'registration':registration,'ears_visible':controls['ears_front'],
            'ear_y':float(((np.asarray(controls['figure_ears'])[:,1].mean()-pose['origin'][1])*pose['scale'])),
            'bounds':[float(lo[0]),float(lo[1]),float(hi[0]),float(hi[1])]}


def outfit_model(gray: np.ndarray, raw: list[dict], pose: dict) -> dict:
    # Verbatim compound fills from the original figure, with a single uniform
    # coordinate transform. The renderer only clips off the original head.
    top=(pose['controls']['figure_outfit_top']-pose['origin'][1])*pose['scale']
    contours,_=cv2.findContours(cv2.dilate(pose['skin_mask'].astype(np.uint8),np.ones((5,5),np.uint8)),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    contour=max(contours,key=cv2.contourArea)[:,0].astype(float)
    contour=(contour-pose['origin'])*pose['scale']
    # Clip only the old head silhouette out of the copied costume. A horizontal
    # chin crop alone either keeps a second jaw or cuts off the fur collar.
    hole=[]
    for a,b in zip(contour,np.roll(contour,-1,axis=0)):
        if a[1]>=top:hole.append(a.tolist())
        if (a[1]>=top)!=(b[1]>=top):hole.append((a+(b-a)*(top-a[1])/(b[1]-a[1])).tolist())
    coverage={'commands':[['M',-40,top],['L',40,top],['L',40,100],['L',-40,100],['Z']],
              'tone':255,'stroke':0,'evenodd':True}
    if len(hole)>=3:coverage['commands'] += [['M',*hole[0]]]+[['L',*p] for p in hole[1:]]+[['Z']]
    copied=normalized(raw,tuple(pose['origin']),pose['scale'])
    return {'paths':copied,'coverage':coverage,
            'bottom':float((gray.shape[0]-pose['origin'][1])*pose['scale']),
            'copy_transform':{'scale':pose['scale'],'origin':pose['origin'].tolist()}}


def code_path(path: dict) -> str:
    return "".join(c[0] + " ".join(f"{v:.5f}".rstrip('0').rstrip('.') if v else "0" for v in c[1:]) for c in path["commands"])


def eye_reference_card(heads: list[dict]) -> None:
    """Review the shared eye topology independently of hair and face framing."""
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    root = ET.Element("{http://www.w3.org/2000/svg}svg", {"viewBox": "0 0 960 650", "width": "960", "height": "650", "role": "img"})
    ET.SubElement(root, "title").text = "Nineteen recipes for one four-cubic eye construction"
    ET.SubElement(root, "desc").text = "Measured from the user's traced eye references. Each recipe uses the same thirteen-point aperture topology and a source-fitted eyebrow."
    card = ET.SubElement(root, "g", {"id": "CHAR_eye_reference_root"})
    ET.SubElement(card, "rect", {"width": "960", "height": "650", "fill": "#e6e6e1"})
    for i, head in enumerate(heads):
        x, y = (i % 4) * 240, (i // 4) * 130
        row = ET.SubElement(card, "g", {"id": f"eye-reference-{i:02}", "transform": f"translate({x} {y})"})
        ET.SubElement(row, "rect", {"x": "6", "y": "6", "width": "228", "height": "118", "rx": "3", "fill": "#d4dcd4"})
        ET.SubElement(row, "text", {"x": "16", "y": "27", "font-family": "DejaVu Sans", "font-size": "12", "fill": "#252b28"}).text = f"{i}  {head['name']}"
        eye = head["eye"]
        p = eye["points"]
        commands = [["M", *p[0]]] + [["C", *p[j + 1], *p[j + 2], *p[j + 3]] for j in range(0, 12, 3)] + [["Z"]]
        data = code_path({"commands": commands})
        brow = code_path({"commands": [["M", *eye['brow'][0]], ["C", *sum(eye['brow'][1:], [])]]})
        for side in [-1, 1]:
            group = ET.SubElement(row, "g", {"id": f"eye-{i:02}-{'L' if side < 0 else 'R'}", "transform": f"translate({120 + side * 38} 78) scale({-side * 23} 23)"})
            clip_id = f"aperture-{i:02}-{side}"
            defs = ET.SubElement(group, "defs")
            clip = ET.SubElement(defs, "clipPath", {"id": clip_id})
            ET.SubElement(clip, "path", {"d": data})
            ET.SubElement(group, "path", {"d": data, "fill": "#fdfcf8", "stroke": "#191c1b", "stroke-width": ".06"})
            ET.SubElement(group, "ellipse", {"cx": str(eye['pupil_x']), "cy": ".02", "rx": str(eye['pupil_radius']), "ry": str(max(.5, eye['pupil_radius'])), "fill": "#191c1b", "clip-path": f"url(#{clip_id})"})
            ET.SubElement(group, "path", {"d": brow, "fill": "none", "stroke": "#191c1b", "stroke-width": ".065", "stroke-linecap": "round"})
    destination = REF / "derived/eye-recipes.svg"
    destination.parent.mkdir(exist_ok=True)
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)


def layered_head_cards(heads: list[dict]) -> None:
    directory=REF/'derived/layered-heads';directory.mkdir(exist_ok=True)
    for i,head in enumerate(heads):
        face,hair,eye,layout=head['face'],head['hair'],head['eye'],head['layout']
        left,top,right,bottom=hair['bounds'];left=min(-6,left);right=max(6,right);top=min(-4,top);bottom=max(4,bottom)
        root=ET.Element('svg',{'xmlns':'http://www.w3.org/2000/svg','viewBox':f'{left-1} {top-1} {right-left+2} {bottom-top+2}',
                               'width':'480','height':'640','role':'img'})
        ET.SubElement(root,'title').text=f'{i} {head["name"]}: separate back, skull, front and ears'
        ET.SubElement(root,'desc').text='Production rest geometry. Hidden back/scalp coverage is completed; ears are independent source parts. No animation or nonlinear source pre-warp.'
        defs=ET.SubElement(root,'defs')
        character=ET.SubElement(root,'g',{'id':f'CHAR_head_{i:02}_root'})
        front_clip=ET.SubElement(defs,'clipPath',{'id':'front-coverage'})
        ET.SubElement(front_clip,'rect',{'x':'-100','y':'-100','width':'200','height':str(100+hair['front_end'])})
        ear_clip=ET.SubElement(defs,'clipPath',{'id':'ear-coverage'})
        ET.SubElement(ear_clip,'path',{'d':'M-100 -100L100 -100L100 100L-100 100Z'+code_path(face['coverage']),'clip-rule':'evenodd','fill-rule':'evenodd'})
        def append(group,parts,kind):
            solid=all(p['tone']<90 for p in hair['paths'])
            for j,part in enumerate(parts):
                color=('#fbfaf6' if part['tone']>230 else '#191c1b') if kind=='skin' else '#1a1a1a' if kind=='back' else '#686867' if solid or part['tone']>=90 else '#212221'
                attrs={'id':f'{group.attrib["id"]}-path-{j}','d':code_path(part),'fill':color}
                if part['evenodd']:attrs['fill-rule']='evenodd'
                if part['stroke']>0:attrs.update(fill='none',stroke=color,**{'stroke-width':str(part['stroke']),'stroke-linecap':'round','stroke-linejoin':'round'})
                ET.SubElement(group,'path',attrs)
        back=ET.SubElement(character,'g',{'id':'hair_back'})
        append(back,hair['back'],'back');append(ET.SubElement(back,'g',{'id':'hair_back_source'}),hair['paths'],'hair')
        append(ET.SubElement(character,'g',{'id':'head_base'}),face['paths'],'skin')
        features=ET.SubElement(character,'g',{'id':'face_features'})
        p=eye['points'];data=code_path({'commands':[['M',*p[0]]]+[['C',*sum(p[j+1:j+4],[])] for j in range(0,12,3)]+[['Z']]})
        for side in (-1,1):
            group=ET.SubElement(features,'g',{'id':f'eye_{side}','transform':f'translate({side*layout["eye_spacing"]} {layout["eye_y"]}) scale({-side*layout["eye_radius"]} {layout["eye_radius"]})'})
            aperture=ET.SubElement(defs,'clipPath',{'id':f'eye-clip-{side}'})
            ET.SubElement(aperture,'path',{'d':data})
            ET.SubElement(group,'path',{'d':data,'fill':'#fdfcf8','stroke':'#191c1b','stroke-width':'.06'})
            ET.SubElement(group,'ellipse',{'cx':str(eye['pupil_x']),'cy':'.02','rx':str(eye['pupil_radius']),'ry':str(max(.5,eye['pupil_radius'])),'fill':'#191c1b','clip-path':f'url(#eye-clip-{side})'})
            lid=code_path({'commands':[['M',*p[0]],['C',*sum(p[1:4],[])],['C',*sum(p[4:7],[])]]})
            ET.SubElement(group,'path',{'d':lid,'fill':'none','stroke':'#191c1b','stroke-width':'.09','stroke-linecap':'round'})
            brow=code_path({'commands':[['M',*eye['brow'][0]],['C',*sum(eye['brow'][1:],[])]]})
            ET.SubElement(group,'path',{'d':brow,'fill':'none','stroke':'#191c1b','stroke-width':'.065','stroke-linecap':'round'})
        ET.SubElement(features,'path',{'d':f'M0 {layout["nose_y"]}l.015 .1','fill':'none','stroke':'#191c1b','stroke-width':'.065','stroke-linecap':'round'})
        mouth=face['mouth'];half=max(.18,min(.45,mouth['width']))*.5
        ET.SubElement(features,'path',{'d':f'M{-half} {mouth["y"]}H{half}','stroke':'#191c1b','stroke-width':'.065','stroke-linecap':'round'})
        append(ET.SubElement(character,'g',{'id':'hair_front','clip-path':'url(#front-coverage)'}),hair['paths'],'hair')
        ears=ET.SubElement(character,'g',{'id':'ears','clip-path':'url(#ear-coverage)'})
        if not hair['ears_visible']:ears.set('display','none')
        ear_y=sum(p[1] for p in face['ear_roots'])*.5
        offset=max(-.5,min(.5,hair['ear_y']-ear_y))*.3
        for side in (0,1):
            x,y=face['ear_roots'][side]
            append(ET.SubElement(ears,'g',{'id':f'ear_{side}','transform':f'translate({x} {y+offset})'}),face['ears'][side],'skin')
        ET.ElementTree(root).write(directory/f'{i:02}-head.svg',encoding='utf-8',xml_declaration=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((REF / "flat-crops.json").read_text())
    layers=json.loads((REF/'layers/manifest.json').read_text())['heads']
    registration=json.loads((REF.parent/'reference-registration.json').read_text())['references']
    assets = {"version": 2, "source": "logperch vectorize.py output; separate skull, ears, completed back and front hair", "heads": [], "outfits": []}
    # Whole, unaltered body/costume groups from short-haired references; no original long hair is baked into them.
    outfit_refs = [0, 2, 3, 4, 5, 7, 8, 10, 13, 14, 15, 16, 17, 18]
    outfit_names = ["Traveller tunic", "Hood & breeches", "Fur mantle & cape", "Fur collar & coat", "Wrapped cape & trousers",
                    "Cape & leggings", "Short cape & boots", "Sleeveless tunic", "Round travel cloak", "Split hem tunic",
                    "Small shoulder cape", "Dark mantle & breeches", "High collar robe", "Wrapped robe"]
    for entry in manifest:
        index = entry["index"]
        def load(part):
            path = ROOT / entry["parts"][part]["svg"]
            return paths(path), render(path)
        figure=np.asarray(Image.open(REF/'crops'/f'{index:02}-figure.png').convert('L'))
        pose=reference_pose(figure,registration[index])
        raw, image = load("face")
        original_face=face_model(image,raw)
        face=separated_face(paths(REF/'layers'/f'{index:02}-skull.svg'),
                            [paths(REF/'layers'/f'{index:02}-ear-{side}.svg') for side in ('L','R')],layers[index],original_face['mouth'])
        transform=face['copy_transform']
        face['coverage']=normalized(paths(REF/'layers'/f'{index:02}-skull-mask.svg'),tuple(transform['origin']),transform['scale'])[0]
        raw=paths(REF/'layers'/f'{index:02}-hair.svg')
        original_hair=np.asarray(Image.open(REF/'crops'/f'{index:02}-hair.png').convert('L'))
        hair = hair_model(original_hair,raw,paths(REF/'layers'/f'{index:02}-back.svg'),figure,registration[index],pose)
        raw, image = load("eyes")
        eye = eye_model(image)
        layout={'eye_spacing':pose['eye_spacing'],'eye_y':pose['eye_y'],'eye_radius':pose['eye_radius'],
                'nose_y':pose['eye_y']+(3.2-pose['eye_y'])*.28}
        assets["heads"].append({"id": entry["id"], "name": entry["name"], "face": face, "hair": hair, "eye": eye,'layout':layout})
        if index in outfit_refs:
            raw, image = load("figure")
            assets["outfits"].append({"id": entry["id"], "name": outfit_names[outfit_refs.index(index)], "source_name": entry["name"], **outfit_model(image, raw,pose)})
        print(f"Compiled reference {index:02}: {entry['name']}", flush=True)
    (OUT / "character-library.json").write_text(json.dumps(assets, indent=2) + "\n")
    lines = ['// Generated by tools/build_character_assets.py from the recorded logperch SVG traces.']
    def paths_code(name, values):
        lines.append(f'static const RawPath {name}[] = {{')
        for part in values:
            lines.append('    {"' + code_path(part) + f'", {part["tone"]}, {part["stroke"]:.5f}f, ' + ('true' if part['evenodd'] else 'false') + '},')
        lines.append('};')
    for i, head in enumerate(assets['heads']):
        paths_code(f'face{i}', head['face']['paths'])
        paths_code(f'earL{i}',head['face']['ears'][0])
        paths_code(f'earR{i}',head['face']['ears'][1])
        paths_code(f'skullMask{i}',[head['face']['coverage']])
        paths_code(f'hair{i}', head['hair']['paths'])
        paths_code(f'hairBack{i}',head['hair']['back'])
    for i, outfit in enumerate(assets['outfits']):
        paths_code(f'outfit{i}', outfit['paths'])
        paths_code(f'outfitCoverage{i}', [outfit['coverage']])
    lines.append('static const HeadSource headSources[] = {')
    for i, head in enumerate(assets['heads']):
        mouth = head['face']['mouth']
        eye = head['eye']
        coords = ', '.join('{' + f'{p[0]:.5f}f, {p[1]:.5f}f' + '}' for p in eye['points'])
        brows = ', '.join('{' + f'{p[0]:.5f}f, {p[1]:.5f}f' + '}' for p in eye['brow'])
        anchors=', '.join('{' + f'{p[0]:.5f}f, {p[1]:.5f}f' + '}' for p in head['face']['anchors'])
        ear_roots=', '.join('{' + f'{p[0]:.5f}f, {p[1]:.5f}f' + '}' for p in head['face']['ear_roots'])
        scalp=', '.join('{' + f'{p[0]:.5f}f, {p[1]:.5f}f' + '}' for p in head['face']['scalp_widths'])
        bounds=', '.join(f'{v:.5f}f' for v in head['hair']['bounds'])
        layout=head['layout']
        lines.append(f'    {{"{head["name"]}", face{i}, hair{i}, hairBack{i}, earL{i}, earR{i}, {head["face"]["temple"]:.5f}f, ' +
                     '{{' + coords + '}}, {{' + brows + '}}, ' + f'{eye["pupil_radius"]:.5f}f, {eye["pupil_x"]:.5f}f, {mouth["width"]:.5f}f, {mouth["y"]:.5f}f, ' +
                     '{{'+anchors+'}}, {'+bounds+'}, '+f'{layout["eye_spacing"]:.5f}f, {layout["eye_y"]:.5f}f, {layout["eye_radius"]:.5f}f, {layout["nose_y"]:.5f}f, '+
                     '{{'+ear_roots+'}}, {{'+scalp+'}}, '+f'{head["hair"]["front_end"]:.5f}f, {head["hair"]["ear_y"]:.5f}f, skullMask{i}[0], '+str(head['hair']['ears_visible']).lower()+'},')
    lines.append('};')
    lines.append('static const OutfitSource outfitSources[] = {')
    for i, outfit in enumerate(assets['outfits']):
        lines.append(f'    {{"{outfit["name"]}", outfit{i}, {outfit["bottom"]:.5f}f, outfitCoverage{i}[0]}},')
    lines.append('};')
    (OUT / "character-library.inc").write_text('\n'.join(lines) + '\n')
    (REF / 'construction-analysis.json').write_text(json.dumps([{ 'id':h['id'], 'name':h['name'], 'temple_half_width':h['face']['temple'], 'eye_aspect':h['eye']['aspect'], 'mouth':h['face']['mouth'], 'hair_registration':h['hair']['registration'],'face_anchors':h['face']['anchors'],'layout':h['layout']} for h in assets['heads']],indent=2)+'\n')
    eye_reference_card(assets['heads'])
    layered_head_cards(assets['heads'])


if __name__ == '__main__':
    main()
