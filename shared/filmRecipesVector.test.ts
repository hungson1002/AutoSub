import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRecipeToBrief,filmRecipeById} from './filmRecipes';

test('folk vector direction preserves a dog story without injecting legacy ghost slots',()=>{
  const story='Quỷ Cẩu: chó đen ngẩng đầu và há hàm tru, sáng ra có dấu chân sau cổng.';
  const recipe=filmRecipeById('folk-horror');
  const brief=applyRecipeToBrief(story,recipe,'code-vector');
  assert.ok(brief.startsWith(story));
  assert.doesNotMatch(brief,/appearance:|focusTargetId|perchedOn|ma tóc đen|nạn nhân nằm/);
  assert.equal(applyRecipeToBrief(brief,recipe,'code-vector'),brief);
  assert.match(applyRecipeToBrief(story,recipe),/appearance:long-limbed-spirit/);
});
test('vector styles keep story art direction while editorial uses its existing image pipeline',()=>{
  for(const id of ['vui-ve','ma-xo'])assert.doesNotMatch(applyRecipeToBrief('Câu chuyện về con chó',filmRecipeById(id),'code-vector'),/polaroid|tag tên vàng|vũng sáng đèn pin/);
  const editorial=filmRecipeById('editorial');
  assert.equal(applyRecipeToBrief('Tài liệu lịch sử',editorial,'code-vector'),applyRecipeToBrief('Tài liệu lịch sử',editorial));
});
