const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const {svgPathProperties} = require('svg-path-properties');

const num = v => Number(v.toFixed(2));
const point = p => `${num(p.x)} ${num(p.y)}`;
function hash(text) {
  let v = 2166136261;
  for (const c of text) v = Math.imul(v ^ c.charCodeAt(0), 16777619);
  return (v >>> 0) / 4294967296 * Math.PI * 2;
}

// Filled vector contours allow a visibly uneven pen width without raster filters.
// This is a static art study; the small contour variation never changes with time.
function inkContour(d, width) {
  return (d.match(/[Mm][^Mm]*/g) || []).map(segment => {
    const curve = new svgPathProperties(segment);
    const length = curve.getTotalLength();
    if (length < .1) return '';
    const closed = /[zZ]\s*$/.test(segment);
    const count = Math.max(6, Math.ceil(length / .55));
    const samples = Array.from({length:count + (closed ? 0 : 1)}, (_, i) => curve.getPointAtLength(length * i / count));
    const phase = hash(segment);
    const left = [], right = [], radii = [];
    samples.forEach((p, i) => {
      const prev = samples[closed ? (i + samples.length - 1) % samples.length : Math.max(0, i - 1)];
      const next = samples[closed ? (i + 1) % samples.length : Math.min(samples.length - 1, i + 1)];
      let dx = next.x - prev.x, dy = next.y - prev.y;
      const size = Math.hypot(dx, dy) || 1;
      dx /= size; dy /= size;
      const s = length * i / count;
      const a = closed ? s / length * Math.PI * 2 * Math.max(1, Math.round(length / 100)) : s * .075;
      const pressure = 1 + .11 * Math.sin(a + phase) + .025 * Math.sin(a * 3 + phase * 1.8);
      const radius = width * .5 * pressure;
      const uneven = (width > 4 ? .14 : .06) * (Math.sin(a * 2 + phase) + .25 * Math.sin(a * 7 + phase));
      left.push({x:p.x - dy * (radius + uneven), y:p.y + dx * (radius + uneven)});
      right.push({x:p.x + dy * (radius - uneven), y:p.y - dx * (radius - uneven)});
      radii.push(radius);
    });
    if (closed) return `M${left.map(point).join('L')}Z M${right.reverse().map(point).join('L')}Z`;
    const end = num(radii.at(-1)), start = num(radii[0]);
    return `M${left.map(point).join('L')}A${end} ${end} 0 0 0 ${point(right.at(-1))}L${right.slice(0,-1).reverse().map(point).join('L')}A${start} ${start} 0 0 0 ${point(left[0])}Z`;
  }).join(' ');
}

function withPenContours(svg) {
  const inherited = [{}];
  let count = 0;
  const result = svg.replace(/<!--[\s\S]*?-->|<\/?g\b[^>]*>|<(?:path|circle)\b[^>]*\/>/g, tag => {
    if (tag.startsWith('<!--')) return tag;
    if (tag.startsWith('</g')) {inherited.pop(); return tag;}
    const attrs = Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), m=>[m[1],m[2]]));
    const style = {...inherited.at(-1), ...attrs};
    if (tag.startsWith('<g')) {inherited.push(style);return tag;}
    if (!tag.startsWith('<path') || !style.stroke || style.stroke === 'none') return tag;
    const d = inkContour(attrs.d, Number(style['stroke-width'] || 1));
    const fillShape = tag.replace(/\s+stroke="[^"]*"/, '').replace(/\s+stroke-width="[^"]*"/, '')
      .replace('/>', ` stroke="${style.stroke}" stroke-width="${num(Number(style['stroke-width'] || 1) * .45)}"/>`);
    count++;
    return `${fillShape}\n<path fill="${style.stroke}" fill-rule="evenodd" stroke="none" d="${d}"/>`;
  });
  if (!count) throw new Error('No contours created');
  return result;
}

// Native SVG source, matched to the woman at 04:06 in the supplied reference.
// This exact vector is imported by the tool; the preview is not a second artist.
const woman = `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1420" viewBox="0 0 195 355">
<g id="character" stroke="#0e0c0b" stroke-width="5.1" stroke-linecap="round" stroke-linejoin="round">
<g id="body">
<path fill="#654958" d="M75 183 Q105 189 135 181 C139 195 144 210 141 224 Q135 240 137 257 Q141 283 148 317 Q153 339 139 344 L66 345 Q51 343 54 328 Q65 290 68 256 Q70 221 72 201 Q73 188 75 183Z"/>
<path fill="#4e3b49" stroke="none" d="M75 188 Q73 220 74 251 Q71 290 62 332 L56 330 Q66 282 68 256 Q70 218 75 188Z"/>
<path fill="#28272d" stroke-width="3.4" d="M65 283 Q102 294 143 282 Q146 300 148 317 Q154 339 139 344 L66 345 Q52 342 54 329 Q60 305 65 283Z"/>
<path fill="#654958" stroke-width="3.4" d="M75 187 Q103 190 135 181 Q143 211 138 232 Q133 249 136 268 L140 315 Q103 318 66 313 Q72 283 72 259 Q72 222 75 187Z"/>
<path fill="#4e3b49" stroke-width="3" d="M82 184 Q108 188 132 181 L135 193 Q117 204 99 199 Q86 195 82 184Z"/>
<path fill="none" stroke-width="3" d="M129 196 Q111 201 95 211 Q84 217 78 229"/>
<path fill="none" stroke-width="1.8" d="M73 283 Q72 296 71 306 M133 276 Q136 293 135 306"/>
</g>
<g id="hair-back">
<path fill="#18171d" d="M70 53 C61 41 64 14 78 7 Q96 0 109 11 Q118 30 112 45 Q106 58 90 57Z"/>
<path fill="none" stroke="#47434c" stroke-width="1.6" d="M73 25 Q91 17 110 31"/>
<path fill="#18171d" d="M44 101 Q28 117 34 139 Q36 157 48 168 L61 151 L65 105Z"/>
</g>
<g id="head">
<path fill="#f2d8ce" d="M51 111 Q70 87 96 80 Q115 78 133 88 Q157 96 173 113 L179 105 C182 118 180 132 175 145 C170 163 153 176 131 182 Q110 187 89 182 C68 179 50 170 43 158 Q36 147 41 137 Q43 122 51 111Z"/>
<path fill="#f2d8ce" d="M45 113 C42 107 35 108 32 113 Q28 119 31 128 C33 136 38 140 43 138 C48 137 51 131 50 125 Q50 118 45 113Z"/>
<path fill="none" stroke-width="2.6" d="M38 117 Q43 121 42 125 Q42 129 39 132"/>
</g>
<g id="hair-front">
<path fill="#18171d" d="M31 129 C24 97 35 70 58 56 Q87 38 119 49 C151 56 177 75 181 105 L181 153 Q176 170 169 175 Q172 156 169 138 L163 110 Q145 94 114 82 Q97 81 80 90 Q60 100 55 110 L51 120 Q49 109 43 106 Q34 102 29 113Z"/>
<path fill="none" stroke="#47434c" stroke-width="1.7" d="M45 85 Q66 55 97 55 Q118 56 137 65"/>
</g>
<g id="head-wrap"></g>
<g id="expression">
<g id="brows" fill="none" stroke-width="2.7"><path d="M92 116 Q99 113 106 116 M136 116 Q143 113 150 117"/></g>
<g id="eyes" fill="#fff3da" stroke-width="4.7">
<path d="M93 118 C87 120 87 131 92 135 Q99 141 105 135 C110 128 108 119 103 116 Q97 114 93 118Z"/>
<path d="M137 118 C132 121 132 131 137 135 Q143 140 149 135 C154 129 152 120 147 117 Q142 114 137 118Z"/>
</g>
<g id="pupils" fill="#262522" stroke="none"><circle cx="99" cy="126.5" r="2.7"/><circle cx="143" cy="126.5" r="2.7"/></g>
<g id="lashes" fill="none" stroke-width="2.4"><path d="M90 120 L86 117 M92 117 L89 113 M96 116 L95 112"/><path d="M150 120 L154 117 M148 117 L151 113 M145 116 L146 112"/></g>
<g id="fear-mouth" stroke="none" fill="#0e0c0b"><path d="M119 158 C115 157 114 161 116 164 Q120 168 123 164 Q126 160 122 158Z"/></g>
<g id="stubble"></g>
</g>
</g></svg>`;
async function main(){
 const dir=path.resolve(process.argv[2]||'tmp/character-svg-study/woman');await fs.mkdir(dir,{recursive:true});
 const source=withPenContours(woman),neutral=source.replace(/<g id="fear-mouth"[\s\S]*?<\/g>/,'');
 await fs.writeFile(path.join(dir,'character.svg'),source);
 await fs.writeFile(path.join(dir,'character-neutral.svg'),neutral);
 await sharp(Buffer.from(source)).png().toFile(path.join(dir,'character.png'));
 await sharp(Buffer.from(neutral)).png().toFile(path.join(dir,'character-neutral.png'));
 console.log(dir);
}
main().catch(e=>{console.error(e);process.exitCode=1});
