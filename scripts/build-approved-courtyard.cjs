const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {paintedPath} = require('./lib/approvedSceneryInk.cjs');
const {importScenery} = require('./lib/importScenery.cjs');
const {uprightCourtyardPath}=require('./lib/uprightCourtyard.cjs');
const upright=process.argv.includes('--upright');
const outputIndex=process.argv.indexOf('--output-dir');
if(upright&&outputIndex<0)throw new Error('An upright candidate needs --output-dir; do not overwrite accepted artwork.');
const parts = [];
let part='sky';
const ink = '#17120f';
let seed = 1503;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const n = x => +x.toFixed(1);
function draw(d, fill='none', width=3.1, color=ink) {
  const structural=upright&&['house','roof','door-opening','door-leaf'].includes(part);
  parts.push(`<g data-part="${part}">${paintedPath(upright?uprightCourtyardPath(d,part):d,fill,width,color,{structural})}</g>`);
}
function flower(x,y,size=1,angle=0) {
  parts.push(`<g transform="translate(${x} ${y}) rotate(${angle}) scale(${size})">`);
  draw('M-1-3 C-6-13-13-6-7 0 C-16 4-9 13-3 6 C-1 16 9 11 6 4 C17 4 14-7 6-5 C6-15-4-13-1-3Z','#e9bf3b',1.7);
  draw('M-2-1 Q2-3 4 1 Q2 5-1 3Z','#b6892c',1.1);
  parts.push('</g>');
}

// This is the same single yard, redrawn for the source shot's framing and ink.
const teeth = [];
let x=781;
while(x>-30) {
  const span=19+rand()*23, base=273+rand()*10;
  teeth.push([x,base],[x-span*(.28+rand()*.35),base+6+rand()*13]);
  x-=span;
}
let roof=upright?'M-35 278L85 30H615L781 278':'M-35 32 Q61 25 139 33 Q234 38 307 29 Q391 34 460 30 Q541 27 615 34 C642 77 663 98 681 127 Q726 189 781 271';
teeth.forEach(([x,y])=>roof+=` L${n(x)} ${n(y)}`);
roof+='Z';
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1280 720" role="img" aria-labelledby="title">
<title id="title">Sân nhà mái rơm — hình dáng và nét bút vẽ tay</title>
<defs><clipPath id="straw"><path d="${roof}"/></clipPath></defs>`);

draw('M0 0H1280V720H0Z','#a2cbd9',0);
part='backdrop';
// Tall overlapping mountain silhouettes, rather than small regular hill icons.
draw('M-20 290 Q71 130 158 19 L194-23 269 35 Q392 181 466 217 L600-34 Q651-42 681 5 Q743 101 819 154 L869 115 Q939 233 973 258 L1104-37 1169-22 1309 157 1300 471-20 472Z','#919e97',3.3);
draw('M869 115 Q902 174 933 226 M1104-15Q1133 65 1167 128','none',2,'#7a8c85');
part='earth';
draw('M-20 456 Q230 446 408 450 Q665 453 867 449 Q1101 454 1300 446 L1300 745-20 745Z','#bba57b',3.2);
part='backdrop';

// Background bamboo is partly occluded by the large, asymmetrical shrub.
draw('M969 450 Q973 234 949-19 L960-20 Q986 230 981 451Z','#8e9560',3.1);
draw('M1045 451 Q1055 250 1041-20 L1052-20 Q1067 250 1058 451Z','#939864',3.1);
draw('M1204 452Q1211 225 1209-18 L1220-18 Q1224 225 1218 451Z','#91915c',3);
draw('M961 101L973 100 M973 246L985 245 M1048 150L1062 150 M1053 325L1067 325 M1210 103L1222 103','none',2.2);
draw('M876 334L889 309 878 309 898 274 889 275 900 244 911 277 905 276 926 311 914 310 928 336Z','#526b4d',3.1);
draw('M916 452 C922 410 935 380 939 337 Q946 298 963 260 Q970 226 988 192 C1001 159 1016 146 1027 114 Q1043 80 1068 59 Q1088 38 1114 35 Q1147 22 1170 34 Q1188 34 1209 49 Q1232 60 1247 91 C1268 114 1272 140 1288 164 L1305 455 Q1213 449 1115 453 Q1019 448 916 452Z','#4b6044',3.9);
draw('M977 323 Q983 304 996 304 Q1004 302 1011 310 M1019 271Q1028 251 1042 253 M1105 222Q1116 203 1128 204 Q1135 203 1141 209 M1161 207Q1168 187 1182 185 Q1193 182 1201 184 M1222 216Q1234 200 1247 202 M1160 331Q1169 316 1181 319','none',3.2,'#293824');

// Uneven wall boards and full-height structure. Curves are drawn into the paths.
part='house';
draw('M-24 278 Q174 282 370 278 Q556 280 755 280 L760 522 Q579 519 386 523 Q184 518-23 521Z','#a57e53',3.4);
draw('M-20 302 Q73 308 166 303 Q259 307 369 301 Q470 308 562 302 Q655 298 754 302 L754 319 Q655 315 562 320 Q468 316 369 320 Q269 324 168 317 Q77 322-20 320Z','#84603b',2.8);
const boards=[5,41,72,113,144,175,213,245,285,317,353,389,426,464,498,532,574,606,648,678,711,745];
boards.forEach((bx,i)=>{
  const rawDx=(rand()<.5?-1:1)*(6+rand()*4),rawOffset=(rand()-.5)*5;
  const dx=rawDx*(upright?.09:1),offset=rawOffset*(upright?.15:1);
  draw(`M${n(bx+offset)} 319 C${n(bx+dx)} 365 ${n(bx-dx*.7)} 401 ${n(bx+offset*.6)} 435 Q${n(bx+dx*.7)} 474 ${n(bx+offset*.4)} 519`,'none',i%4===0?2.3:2,i%4===0?'#755335':'#8b643e');
  if(i%3===0) draw(`M${bx+14} ${345+i%4*22}q-3 17 0 29 m-1 12 1 10`,'none',1.8,'#956d44');
});
draw('M8 291L26 292 Q23 405 27 521 L7 522 Q10 405 8 291Z','#755235',3.3);
draw('M371 283 Q382 279 393 285 Q386 352 393 413 Q397 467 394 525 L370 524 Q376 460 369 410 Q367 348 371 283Z','#795436',3.4);
draw('M735 284L755 283 Q752 342 756 403 Q751 464 758 522 L737 524 Q741 462 736 409 Q740 343 735 284Z','#765133',3.4);
draw('M-20 523 Q96 520 217 523 Q371 520 509 522 Q643 526 772 521 L771 545 Q637 544 510 546 Q362 541 217 546 Q91 542-20 545Z','#9b9886',3.2);
draw('M76 523L76 542 M319 523L320 543 M410 523L409 544 M600 525L600 544 M721 524L720 543','none',2.3,'#626052');

// Wide doorway, slightly crooked door leaf, low timber lintel.
part='door-opening';
draw('M122 325 Q156 329 189 325 Q223 323 257 326 C253 389 261 456 259 520 Q190 525 121 520 C124 456 117 385 122 325Z','#39291f',3.3);
part='door-leaf';
draw('M126 330L95 341 Q89 381 95 426 Q91 472 95 521 L126 521 Q123 476 126 430 Q121 379 126 330Z','#b58c59',3);
part='door-leaf';
draw('M111 446L111 458 M119 451L119 462 M226 393L227 403 M233 392L234 401','none',2.2,'#86603b');
part='house';
draw('M118 311 Q186 313 265 312 L263 329 Q192 325 117 328Z','#765030',3.1);
// Small dark opening with hand-spaced wooden bars.
draw('M406 338 Q433 342 455 337 Q482 335 504 339 Q509 371 505 412 Q480 408 454 413 Q428 414 406 412 Q409 376 406 338Z','#b48e5d',3.1);
draw('M415 348Q454 345 494 348 Q497 375 494 402 Q453 406 415 402 Q418 374 415 348Z','#403321',2.7);
draw('M429 348Q434 375 428 403 M451 347Q449 374 452 403 M474 347Q479 371 475 402','none',4.2,'#b08a55');

// Two narrow red spring banners; their small knots are attached to the lintel.
draw('M31 326Q42 324 53 326 L52 472 Q42 474 31 472Z','#b4472f',2.8);
draw('M330 328L351 328 Q349 396 350 472 L330 474 Q332 398 330 328Z','#b7472e',2.8);
draw('M32 352l9-6 10 7-11 11Z','#3f3530',1.8);
draw('M332 353l9-6 9 7-9 10Z','#3f3530',1.8);

// One broad cropped straw roof, with varied eave lengths and spaced straw dashes.
part='roof';
draw(roof,'#c29849',3.6);
part='straw';
parts.push('<g clip-path="url(#straw)">');
for(let row=0;row<10;row++) {
  for(let col=0;col<33;col++) {
    if(rand()<.11)continue;
    const sx=col*24+(rand()-.5)*23, sy=44+row*24+(rand()-.5)*23;
    const len=6+rand()*17,lean=(rand()-.5)*5;
    draw(`M${n(sx)} ${n(sy)}c${n(lean)} ${n(len*.3)} ${n(-lean*.3)} ${n(len*.65)} ${n(lean*.35-1)} ${n(len)}`,'none',1.5+rand()*1.1,'#a37b33');
  }
}
parts.push('</g>');
part='roof';
draw(roof,'none',3.3);
draw('M-20 19 Q44 25 112 20 Q186 17 258 22 Q326 25 392 19 Q505 24 615 21 L615 37 Q505 33 392 38 Q322 35 258 37 Q187 31 112 36 Q44 33-20 38Z','#9c7338',3.2);
// Plaque belongs in front of the eave.
draw('M99 278 Q144 273 190 278 Q237 280 283 276 Q287 294 283 311 Q237 308 191 313 Q145 315 99 310 Q96 295 99 278Z','#b9472d',3.3);
draw('M126 297q10-4 17-12 l-1 11 19 6-35-1Z','#e9bd4c',1,'#e9bd4c');
draw('M228 289q7-5 14-1 l-8 7 1 10-8-5 4-7Z','#e9bd4c',1,'#e9bd4c');

// Tall, airy apricot branches. Flowers are scattered at branch tips, not a hedge.
part='tree';
const treeIndex=parts.length;
draw('M462 514 C459 486 466 458 466 432 C468 412 460 393 464 373 Q470 352 469 331 Q468 308 476 287 Q472 314 475 332 C476 355 468 366 470 384 Q470 408 475 431 C476 463 470 487 472 514Z','#78512f',1.8);
draw('M466 479 C450 460 452 443 436 429 Q422 417 410 403 Q428 414 441 425 C457 439 455 459 469 471Z','#78512f',1.7);
draw('M470 420 C484 398 505 389 523 369 Q542 349 565 331 C547 353 529 373 512 386 Q486 408 474 432Z','#78512f',1.8);
draw('M469 405 C452 402 452 385 436 375 Q407 353 379 364 Q404 352 435 368 C452 376 455 392 470 397Z','#78512f',1.5);
draw('M447 443Q428 441 417 426 M478 426Q496 426 518 404 Q533 391 545 389 M472 352Q487 338 488 321','none',3.8,'#78512f');
draw('M379 365Q365 364 351 349 Q341 348 330 352 M351 349Q365 338 363 327 M477 301Q466 302 456 299 M545 389Q560 384 568 387','none',2.9,'#78512f');
const blooms=[[477,284,.85],[456,299,.88],[465,308,.66],[473,345,.82],[430,366,.88],[411,355,.88],[379,365,.8],[363,327,.8],[330,352,.88],[375,355,.8],[429,385,.88],[421,409,.8],[433,438,.88],[447,433,.78],[460,444,.78],[476,460,.89],[480,443,.7],[482,420,.8],[482,396,.84],[519,389,.8],[530,382,.78],[541,388,.89],[554,378,.74],[568,380,.9],[575,393,.82],[566,405,.72]];
for(const [bx,by,size] of blooms)flower(bx,by,size,n(rand()*70-35));
flower(565,333,.64,18);
part='planter';
draw('M414 512 Q460 515 514 512 L503 586 Q460 589 428 585Z','#357687',3.4);
draw('M406 504 Q460 502 520 503 L519 518 Q460 520 407 518Z','#41818b',3.1);
draw('M421 535Q460 539 509 534','none',2.7,'#99b8ae');

// The source's person hides the broom base; with no person, draw its full support.
const handle=[];
handle.push('<path d="M549 529 Q563 477 576 442 Q580 433 584 437 Q587 439 584 445 L556 532Z" fill="#bea574" stroke="#30271e" stroke-width="3" stroke-linejoin="round"/>');
handle.push('<path d="M546 519L560 524 567 547Q552 552 536 545Z" fill="#ab9157" stroke="#30271e" stroke-width="2.8" stroke-linejoin="round"/><path d="M548 527L542 543M553 528L551 545M558 531L560 544" fill="none" stroke="#786138" stroke-width="1.8" stroke-linecap="round"/>');
// Insert before the tree trunk so the handle never overlays flowers or planter.
parts.splice(treeIndex,0,`<g data-part="broom">${handle.join('')}</g>`);

// Foreground bamboo pole: the base continues below the frame like the source.
part='bamboo';
draw('M796 744 Q802 536 804 345 Q807 233 807 149 L814 143 Q818 247 814 348 Q810 542 807 744Z','#c8b476',3);
draw('M804 246L816 247 M803 342L815 343 M802 438L813 438 M801 528L812 529 M798 600L811 599 M798 672L809 672','none',2.5);
draw('M809 153Q782 135 757 121 Q785 121 809 148Z','#8b9451',2.8);
draw('M809 153Q807 118 812 101 Q825 117 817 151Z','#8b9451',2.8);
draw('M813 154Q844 121 867 122 Q853 145 813 159Z','#8b9451',2.8);
draw('M811 159Q853 158 892 178 Q852 181 811 166Z','#8b9451',2.8);
draw('M807 159Q770 158 734 179 Q775 182 807 166Z','#8b9451',2.8);
draw('M778 238L811 224 Q812 263 813 309 L782 312Z','#bc4a2d',3.1);
draw('M817 289Q842 277 870 289 L865 302 Q843 296 819 305Z','#9c7145',3.1);
draw('M839 304L839 312 M833 314L855 313 858 329 830 330Z','#d1a548',2.6);
draw('M768 329Q780 326 793 330 L793 374 766 374Z','#d5a84c',2.6);
draw('M775 338q6-3 11 1 M774 349l12 1 M776 359l9 5','none',2.1);

// Irregular bamboo widths, a bowed rail, and subtle bends instead of cloned rectangles.
part='fence';
let fx=916;
let i=0;
while(fx<1300){
  const w=20+rand()*11,top=438+rand()*17,lean=(rand()<.5?-1:1)*(3+rand()*4),bottom=586+rand()*5;
  draw(`M${n(fx)} ${n(bottom)} C${n(fx+lean)} 557 ${n(fx-lean*.5)} 489 ${n(fx+1)} ${n(top+12)} Q${n(fx+w*.2)} ${n(top+8)} ${n(fx+w*.43)} ${n(top)} Q${n(fx+w*.75)} ${n(top+2)} ${n(fx+w-2)} ${n(top+10)} C${n(fx+w-lean*.6)} 493 ${n(fx+w+lean*.5)} 552 ${n(fx+w-3)} ${n(bottom)} Q${n(fx+w*.5)} ${n(bottom-2)} ${n(fx)} ${n(bottom)}Z`,i%3===0?'#dac183':'#d4b977',2.9);
  if(i%3===1)draw(`M${n(fx+8)} ${n(top+27)}q-2 17 0 34 m0 18 0 15`,'none',1.5,'#b59c64');
  fx+=w; i++;
}
draw('M910 493Q958 497 1006 491 Q1054 488 1108 494 Q1151 498 1197 492 Q1247 489 1304 494 M909 543Q958 538 1005 545 Q1057 548 1107 541 Q1156 538 1201 545 Q1250 548 1304 542','none',5.1,'#967a42');
draw('M927 493L926 508 M1046 491L1048 505 M1171 490L1171 504 M1278 492L1280 506','none',1.7,'#514829');

// Quiet squat jar; rim, neck, body and foot form one coherent silhouette.
part='jar';
draw('M839 631 Q824 608 826 586 Q825 566 839 548 L841 537 Q871 535 902 536 L904 548 Q919 566 919 588 Q919 612 906 632 Q873 635 839 631Z','#85816a',3.4);
draw('M840 535Q870 534 904 535 L904 545 Q869 544 840 546Z','#625d4c',2.9);
draw('M841 589 Q870 600 905 591','none',2.9,'#403f2d');

part='yard-marks';
draw('M77 602l1 14 M85 607l1 12 M178 700l23 0 M247 687l8 5-8 5 M827 653l8 5-8 5 M1089 691l17 0 M1173 616l2 9','none',2.6,'#826c44');
parts.push('</svg>');

async function main(){
  const palette={
    '#a57e53':'#a47849','#bba57b':'#baa071','#c29849':'#c1933d',
    '#a37b33':'#946928','#d4b977':'#c7aa67','#dac183':'#d0b270',
    '#4b6044':'#40583c','#919e97':'#87978e','#8b643e':'#795534',
    '#357687':'#276a79','#e9bf3b':'#e7b323','#30271e':'#17120f'
  };
  const svg=parts.join('\n').replace(/#[0-9a-f]{6}/g,color=>palette[color]||color);
  const target=path.resolve(outputIndex<0?'server/assets/vector-styles/folk-horror/approved-courtyard':process.argv[outputIndex+1]);
  fs.mkdirSync(target,{recursive:true});
  fs.writeFileSync(path.join(target,'source.svg'),svg,'utf8');
  fs.writeFileSync(path.join(target,'drawing.json'),JSON.stringify(importScenery(svg,{fullRoof:upright})));
  console.log('Approved courtyard imported as reusable native vector parts.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
