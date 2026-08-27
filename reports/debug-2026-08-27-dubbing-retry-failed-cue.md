# Dubbing job mất nút thử lại khi một cue lỗi

## Phân loại

Runtime/UI state flow.

## Bằng chứng và nguyên nhân

- Job có cue lỗi đi vào nhánh dự kiến kết thúc với `completed_with_errors`.
- Nhánh này gọi `buildTimeline(cues)`, trong khi hàm đó từ chối mọi danh sách chưa đủ `totalCues`.
- Lỗi dựng timeline bị catch ở cấp job và đổi trạng thái thành `failed`.
- UI trước đây chỉ hiện nút retry khi trạng thái là `completed_with_errors`, nên job trong ảnh không có cách retry cue lỗi.

## Sửa chữa

- Không dựng timeline thiếu cue; giữ nguyên toàn bộ cue đã hoàn thành và kết thúc bằng `completed_with_errors`.
- Cho hiện `Thử lại cue lỗi` cho cả job mới `completed_with_errors` và job cũ đã bị ghi thành `failed`.
- Endpoint retry hiện có chỉ đưa cue lỗi về `pending`; các cue hoàn thành được tái sử dụng.

## Xác minh

- Chạy test tập trung của dubbing job.
- Chạy TypeScript/build để kiểm tra nhánh UI.

## Rủi ro còn lại

- Không tạo dub track tạm thời khi còn cue lỗi; timeline cuối chỉ được dựng sau khi retry thành công toàn bộ cue.
