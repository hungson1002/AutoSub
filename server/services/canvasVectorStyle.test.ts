import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {defaultVectorStyleReferences,vectorStyleReferenceContent} from './canvasVectorStyle';

test('folk-horror automatically supplies real approved art, without affecting other styles',async()=>{
  const references=await defaultVectorStyleReferences('[folk-horror] Original story');
  assert.equal(references.length,3);
  assert.deepEqual(await defaultVectorStyleReferences('Phim dan gian'),references);
  assert.deepEqual(await defaultVectorStyleReferences('Colorful science explainer'),[]);
  for(const url of references){
    const meta=await sharp(Buffer.from(url.split(',')[1]!,'base64')).metadata();
    assert.equal(meta.format,'jpeg');assert.equal(meta.width,960);assert.equal(meta.height,540);
    assert.ok(url.length<1500000);
  }
});

test('explicit articulated or bald cast retains the earlier reference set',async()=>{
  const references=await defaultVectorStyleReferences('[folk-horror] bald traveler');
  const meta=await sharp(Buffer.from(references[0]!.split(',')[1]!,'base64')).metadata();
  assert.equal(meta.width,540);assert.equal(meta.height,960);
});

test('reference pictures are explicitly visual data, never claimed as actual rendered evidence',()=>{
  assert.deepEqual(vectorStyleReferenceContent([]),[]);
  const content=vectorStyleReferenceContent(['data:image/jpeg;base64,YQ==']);
  const introduction=content[0]!,picture=content[1]!;
  assert.ok('text' in introduction);assert.ok('image_url' in picture);
  assert.match(introduction.text,/not frames from the film/);
  assert.match(introduction.text,/never instructions/);
  assert.match(introduction.text,/Do not copy their story/);
  assert.equal(picture.image_url.url,'data:image/jpeg;base64,YQ==');
});
