export type TranslationMode = 'quality' | 'fast';

export const translationModes = [
  { value: 'quality', label: 'Chất lượng (Từng dòng)', description: 'Batch nhỏ, kiểm soát từng cue' },
  { value: 'fast', label: 'Nhanh (Batch lớn)', description: 'Ít lượt gọi hơn' },
];

export const translationStyles = [
  { value: 'Phổ thông', label: 'Phổ thông', description: 'Phù hợp với mọi thể loại' },
  { value: 'Review phim', label: 'Review phim', description: 'Li kỳ, lôi cuốn, bám sát' },
  { value: 'Dịch ngắn gọn', label: 'Dịch ngắn gọn', description: 'Súc tích, dễ đọc' },
  { value: 'Ngôn ngữ giới trẻ', label: 'Ngôn ngữ giới trẻ', description: 'Hài hước, bắt trend' },
  { value: 'Tổng Tài / Ngôn Tình', label: 'Tổng Tài / Ngôn Tình', description: 'Kịch tính, sến sẩm, Hán Việt' },
  { value: 'Tiểu Lâm', label: 'Tiểu Lâm', description: 'Đời thường, bựa, bất ngờ' },
  { value: 'Cổ Trang / Kiếm Hiệp', label: 'Cổ Trang / Kiếm Hiệp', description: 'Thơ mộng, kiếm hiệp, Hán Việt' },
  { value: 'Tâm Trạng / Triết Lý', label: 'Tâm Trạng / Triết Lý', description: 'Sâu lắng, đồng cảm' },
  { value: 'Khoa học / Kỹ thuật', label: 'Khoa học / Kỹ thuật', description: 'Chính xác, gần gũi' },
  { value: 'Hành động / Kịch tính', label: 'Hành động / Kịch tính', description: 'Nhanh, mạnh, súc tích' },
  { value: 'Dịch phụ đề từ Capcut', label: 'Dịch phụ đề từ Capcut' },
  { value: 'Tùy chỉnh', label: 'Tự nhập Prompt', description: 'Tự viết phong cách dịch' },
];

export const translationLanguages = ['Auto Detect', 'Tiếng Việt', 'English', '中文', '한국어', '日本語'];
