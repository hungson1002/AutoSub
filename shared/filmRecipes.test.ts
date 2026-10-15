import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecipeToBrief, buildTetVillageBrief, filmRecipeById, FILM_RECIPES } from './filmRecipes';

describe('filmRecipes', () => {
  it('5 preset đầy đủ, ma-xo kể chậm 0.9', () => {
    assert.equal(FILM_RECIPES.length, 5);
    assert.equal(filmRecipeById('ma-xo').narrationSpeed, 0.9);
    assert.equal(filmRecipeById('vui-ve').visualMode, 'procedural');
    assert.equal(filmRecipeById('la-ten-khong-co').id, 'editorial');
    assert.equal(filmRecipeById('tet-village').name, 'Làng quê ngày Tết');
  });

  it('chèn chỉ thị 1 lần, không trùng', () => {
    const recipe = filmRecipeById('vui-ve');
    const once = applyRecipeToBrief('Làm video Bạch Đằng', recipe);
    assert.match(once, /Phong cách Vui Vẻ/);
    assert.equal(applyRecipeToBrief(once, recipe), once);
  });

  it('builder brief Tết giữ ý tưởng và khóa native, gọi lại không trùng', () => {
    const built = buildTetVillageBrief('Chợ Tết đầu làng, 30 giây.');
    assert.match(built, /Chợ Tết đầu làng/);
    assert.match(built, /MANDATORY NATIVE/);
    assert.match(built, /festival tet/);
    assert.match(built, /simple-chicken/);
    assert.match(built, /chicken height 40-60/);
    assert.match(built, /already supplies stalls/);
    assert.equal(buildTetVillageBrief(built), built);
    assert.equal(buildTetVillageBrief('  '), buildTetVillageBrief(''));
  });
});
