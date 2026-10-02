import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecipeToBrief, filmRecipeById, FILM_RECIPES } from './filmRecipes';

describe('filmRecipes', () => {
  it('3 preset đầy đủ, ma-xo kể chậm 0.9', () => {
    assert.equal(FILM_RECIPES.length, 3);
    assert.equal(filmRecipeById('ma-xo').narrationSpeed, 0.9);
    assert.equal(filmRecipeById('vui-ve').visualMode, 'procedural');
    assert.equal(filmRecipeById('la-ten-khong-co').id, 'editorial');
  });

  it('chèn chỉ thị 1 lần, không trùng', () => {
    const recipe = filmRecipeById('vui-ve');
    const once = applyRecipeToBrief('Làm video Bạch Đằng', recipe);
    assert.match(once, /Phong cách Vui Vẻ/);
    assert.equal(applyRecipeToBrief(once, recipe), once);
  });
});
