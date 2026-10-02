export type FilmRecipeId = 'vui-ve' | 'ma-xo' | 'editorial';

export type FilmRecipe = {
  id: FilmRecipeId;
  name: string;
  description: string;
  narrationSpeed: number;
  visualMode: 'procedural' | 'ai-fallback';
  /** Chỉ thị đạo diễn chèn vào brief, không cần đổi server. */
  briefDirective: string;
};

export const FILM_RECIPES: FilmRecipe[] = [
  {
    id: 'vui-ve',
    name: 'Hoạt hình kể chuyện',
    description: 'Nhân vật chibi, biểu cảm sinh động. Hợp lịch sử, kiến thức và chuyện vui.',
    narrationSpeed: 1,
    visualMode: 'procedural',
    briefDirective: 'Phong cách Vui Vẻ: nhân vật chibi đơn giản, đứng yên phần lớn thời gian, chỉ cử động đúng hành động theo beat (nói/chỉ/ngạc nhiên/ăn mừng) rồi giữ pose. Cắt khô hard-cut giữa các scene, không transition. Ảnh tư liệu trình bày khung polaroid viền trắng dán băng dính + caption. Tiêu đề trắng viền đen gạch đỏ. Nhịp kể vui, nhanh.',
  },
  {
    id: 'ma-xo',
    name: 'Truyện kể bí ẩn',
    description: 'Nền tối, nhịp chậm, ít chuyển động. Hợp truyện ma và truyền thuyết.',
    narrationSpeed: 0.9,
    visualMode: 'procedural',
    briefDirective: 'Phong cách Ma Xó (truyện ma đêm): nền tối với vignette và vũng sáng đèn pin, nhân vật và ma tối giản đứng yên, sub trắng viền đen cháy hình kèm tag tên vàng khi thoại, giữ mỗi shot lâu, tuyệt đối không chuyển động lặp vô nghĩa. Giọng kể chậm, rờn rợn.',
  },
  {
    id: 'editorial',
    name: 'Minh họa chi tiết',
    description: 'Tranh vẽ tay và ảnh tư liệu. Hợp video tài liệu, cần tạo ảnh AI.',
    narrationSpeed: 1,
    visualMode: 'ai-fallback',
    briefDirective: 'Phong cách editorial vẽ tay: dùng tranh AI chi tiết làm nền và chân dung nhân vật, ảnh tư liệu lớn có credit, chuyển động vừa phải, nhịp kể chuẩn tài liệu.',
  },
];

export function filmRecipeById(id: string | undefined): FilmRecipe {
  return FILM_RECIPES.find((recipe) => recipe.id === id) || FILM_RECIPES[2]!;
}

export function applyRecipeToBrief(brief: string, recipe: FilmRecipe): string {
  const clean = String(brief || '').trim();
  if (clean.includes(recipe.briefDirective)) return clean;
  return `${clean}\n\n${recipe.briefDirective}`;
}
