export const ZEROTTS_VIETNAMESE_VOICES = [
  { id: 'maichi', name: 'Mai Chi · Nữ trẻ · kể chuyện', language: 'vi-VN', description: 'Nhẹ nhàng · thân thiện · kể chuyện', source: 'preset' as const },
  { id: 'baotrang', name: 'Bảo Trang · Nữ trưởng thành', language: 'vi-VN', description: 'Tin tức · rõ ràng · trung tính', source: 'preset' as const },
  { id: 'kimoanh', name: 'Kim Oanh · Nữ trung niên', language: 'vi-VN', description: 'Ấm áp · truyền cảm · kể chuyện', source: 'preset' as const },
  { id: 'hamy', name: 'Hà My · Nữ trẻ · biểu cảm', language: 'vi-VN', description: 'Hoạt hình · cao · biểu cảm', source: 'preset' as const },
  { id: 'giahuy', name: 'Gia Huy · Nam trẻ · kể chuyện', language: 'vi-VN', description: 'Trầm ấm · tâm tình · kể chuyện', source: 'preset' as const },
  { id: 'huuduc', name: 'Hữu Đức · Nam lớn tuổi', language: 'vi-VN', description: 'Trầm · điềm đạm · kể chuyện', source: 'preset' as const },
  { id: 'quangminh', name: 'Quang Minh · Nam trẻ · rõ', language: 'vi-VN', description: 'Tin tức · rõ ràng · dứt khoát', source: 'preset' as const },
  { id: 'tiendat', name: 'Tiến Đạt · Nam trẻ · năng lượng', language: 'vi-VN', description: 'Bình luận · sôi nổi · năng lượng cao', source: 'preset' as const },
] as const;

export type ZeroTtsVoiceId = typeof ZEROTTS_VIETNAMESE_VOICES[number]['id'];
