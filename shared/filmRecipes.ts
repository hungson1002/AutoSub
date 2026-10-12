export type FilmRecipeId = 'vui-ve' | 'ma-xo' | 'editorial' | 'folk-horror';

export type FilmRecipe = {
  id: FilmRecipeId;
  name: string;
  description: string;
  narrationSpeed: number;
  visualMode: 'procedural' | 'ai-fallback';
  /** Chỉ thị đạo diễn chèn vào brief, không cần đổi server. */
  briefDirective: string;
  /** Art direction for authored SVG; no legacy object slots or story-specific monsters. */
  vectorBriefDirective?: string;
};

export const FILM_RECIPES: FilmRecipe[] = [
  {
    id: 'folk-horror',
    name: 'Truyện ma dân gian 2D',
    description: 'Hình phẳng, mặt dạng sọ, nền đồng quê. Chuyển động kéo dài, quấn và kéo ngã theo lời kể.',
    narrationSpeed: 1,
    visualMode: 'procedural',
    vectorBriefDirective: '[folk-horror] MỤC TIÊU LÀ CHẤT LƯỢNG HÌNH VẼ VÀ DIỄN XUẤT CỦA MỘT PHIM KINH DỊ DÂN GIAN 2D CHUYÊN NGHIỆP, không sao chép cảnh làng quê hoặc nhân vật của phim tham chiếu. Thiết kế đúng nhân vật, địa điểm, niên đại, trang phục theo câu chuyện: nhân vật gọn, tỉ lệ có chủ đích, nét viền cong mềm và đồng nhất, mặt và mắt biểu cảm, người phụ cùng một ngôn ngữ tạo hình. Mỗi địa điểm phải thành một sân khấu có tiền-trung-hậu cảnh, kiến trúc/thiên nhiên/đạo cụ đặc trưng, chi tiết tại vùng nhìn thấy, ánh sáng và đường chân đất hợp lý; không dùng một nền gồm vài khối màu lớn. Bảng màu trầm nhưng mọi chủ thể phải đọc rõ. Đạo diễn xây chuỗi toàn cảnh xác lập địa điểm, cảnh nhân vật hành động, cận chi tiết và phản ứng; mỗi hành động có chuẩn bị, tiếp xúc/lực và kết quả. Ưu tiên limited animation 2D kiểu cutout: thân áo một khối không lộ tay chân dài, khi đi dùng walks để cả khối nhân vật tiến liên tục theo đường đi, lắc trái/phải nhẹ và nhấc nhẹ theo nhịp bước; đầu, áo và tay cầm đồ đi cùng thân, đến nơi dừng và giữ tư thế. Đường đi lên/xuống theo chiều sâu dùng followDepth:true. Khi đứng/nghe/chờ không chạy nhịp bước hay lắc đầu độc lập; không zoom theo từng câu. Khi chọn style này cho nhân vật mới dùng rig simple-puppet với finish:handdrawn và cho stage minh họa dùng finish:handdrawn (không áp đặt kiểu này lên nhân vật đã được duyệt có style khác). Nét vẽ tay đến từ đường bao hơi bất quy tắc, tóc/mắt có shape đẹp, chi tiết gỗ/mái/cây được tiết chế; không tạo chân tay rig người. Giữ không gian và vật thể giữa các góc. Chỉ cho nhân vật ma, nhà, cây, sông, đạo cụ khi câu chuyện thực sự có chúng. Không tự vẽ chữ/sub.',
    briefDirective: '[folk-horror] Truyện ma dân gian bằng hoạt hình 2D phẳng: màu xanh đen, xanh rêu, nâu đất, trắng ngà; nhân vật người mặt dạng sọ, áo có cổ và vạt; ma tóc đen dài ôm hai bên khuôn mặt, áo trắng rách gấu. Nền đồng quê và cây ít chi tiết, không phối cảnh phòng 3D hay đổ bóng bóng bẩy. Mỗi ý kể phải có hình minh họa phù hợp, không dùng cùng một toàn cảnh cho mọi câu. Dựng xen toàn cảnh cây, trung cảnh người đi đường, cận cành cây hoặc mặt ma, trung cảnh nạn nhân nằm trên cỏ và cảnh kết riêng. Cận mặt dùng camera.shot:extreme-close-up, chỉ một nhân vật focal; toàn cảnh phải có cây lớn và nhân vật đủ nhìn rõ. Người làng số nhiều cần ít nhất hai người riêng biệt; không minh họa bằng một nhân vật tí hon. Giữ cảnh 5-10 giây, chỉ diễn đúng hành động, không thêm nhún hay phóng to lặp vô nghĩa. Ma có bộ phận kéo dài dùng appearance:long-limbed-spirit; trong cùng một shot thấy cả hai người dùng grab để vươn và quấn vào cổ, pull để giật kéo nạn nhân ngã, release để thu lại. Mỗi hành động phải có focusTargetId của nạn nhân và speechCue đúng lời kể. Nhân vật trên cây dùng perchedOn chỉ đến cây. Phụ đề trắng phía trên; giữ nhân vật nhất quán và tái sử dụng bối cảnh.',
  },
  {
    id: 'vui-ve',
    name: 'Hoạt hình kể chuyện',
    description: 'Nhân vật chibi, biểu cảm sinh động. Hợp lịch sử, kiến thức và chuyện vui.',
    narrationSpeed: 1,
    visualMode: 'procedural',
    vectorBriefDirective: 'Phong cách Vui Vẻ: phim 2D có nhân vật chibi biểu cảm, vóc dáng, kiểu tóc, trang phục và nét vẽ đồng nhất trong mọi cảnh. Biểu cảm và tư thế đúng sự kiện; dùng đổi pose, tay chỉ, nhướng mày, xoay góc nhân vật, chuyển động đạo cụ có nhịp hài phù hợp; không lắc hoặc kéo lê sprite thay cho hành động. Bảng màu tươi sáng; nơi chốn theo đúng kịch bản, bối cảnh có đủ thông tin nơi cần thiết, cảnh đồ họa giải thích có thể có nền giản lược khi hữu ích. Đạo diễn cắt toàn-trung-cận với điểm nhấn, không thiết kế một mascot áo nâu giống mọi nhân vật. Giữ hình mẫu đã chọn, không tự vẽ chữ/sub.',
    briefDirective: 'Phong cách Vui Vẻ: nhân vật chibi đơn giản, đứng yên phần lớn thời gian, chỉ cử động đúng hành động theo beat (nói/chỉ/ngạc nhiên/ăn mừng) rồi giữ pose. Cắt khô hard-cut giữa các scene, không transition. Ảnh tư liệu trình bày khung polaroid viền trắng dán băng dính + caption. Tiêu đề trắng viền đen gạch đỏ. Nhịp kể vui, nhanh.',
  },
  {
    id: 'ma-xo',
    name: 'Truyện kể bí ẩn',
    description: 'Nền tối, nhịp chậm, ít chuyển động. Hợp truyện ma và truyền thuyết.',
    narrationSpeed: 0.9,
    visualMode: 'procedural',
    vectorBriefDirective: 'Phong cách Ma Xó: hoạt hình kinh dị 2D có bối cảnh hoàn chỉnh theo địa điểm câu chuyện, rõ tiền-trung-hậu cảnh, đèn sáng có nguồn, vật thể và kết cấu cụ thể, màu đêm trầm có tương phản đủ đọc. Nhân vật vẽ cùng hệ nét, đặc trưng khuôn mặt/trang phục bền vững qua các cảnh. Đạo diễn giữ nhịp chậm có chủ đích nhưng mọi sự kiện vẫn phải hiển thị bằng hành động/biểu cảm, không dùng cảnh tĩnh trống kéo dài trong lúc lời đọc nói sự kiện khác. Khi cần lùi, giật mình, chạm hoặc kéo thì diễn rõ nguyên nhân-lực-kết quả; không xoay nguyên sprite. Không tự thêm ma, đèn pin hoặc đạo cụ không thuộc kịch bản; không tự vẽ chữ/sub.',
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
  return FILM_RECIPES.find((recipe) => recipe.id === id) || FILM_RECIPES.find(recipe => recipe.id === 'editorial')!;
}

export function applyRecipeToBrief(brief: string, recipe: FilmRecipe, visualMode?: 'code-vector'): string {
  const clean = String(brief || '').trim();
  const directive=visualMode==='code-vector' ? recipe.vectorBriefDirective||recipe.briefDirective : recipe.briefDirective;
  if (clean.includes(directive)) return clean;
  return `${clean}\n\n${directive}`;
}
