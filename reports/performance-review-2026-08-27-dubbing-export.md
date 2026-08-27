# Báo cáo tối ưu hiệu năng lồng tiếng và xuất video

> Thời gian: 2026-08-27  
> Luồng: hoàn tất dub track và xuất video sau lồng tiếng  
> Máy kiểm tra: Ryzen 7 5800H, Radeon RX 5500M, Windows

## Mục tiêu

- Giảm thời gian hậu xử lý sau khi TTS đạt 100%, đặc biệt khi retry một cue.
- Giảm thời gian xuất video khi hình ảnh không cần chỉnh sửa.
- Không đổi PCM 48 kHz, mastering, timeline hoặc chất lượng video.

## Baseline và nút thắt

| Hạng mục | Trước tối ưu | Bằng chứng |
| --- | --- | --- |
| Segment dub | Render tuần tự toàn bộ khoảng 70 segment | `buildTimeline` xóa thư mục timeline rồi gọi FFmpeg từng batch |
| Metadata | Ghi tuần tự mọi cue | Hơn 2.000 lần ghi JSON sau mỗi lần dựng timeline |
| Xuất video không hiệu ứng | Vẫn decode và encode H.264 | Nhánh `null[videoout]` luôn đi qua encoder |

## Thay đổi

- Cache segment bằng chữ ký gồm file audio, timeline, âm lượng và fade; chỉ render segment đổi.
- Render tối đa hai segment song song, có thể chỉnh bằng `AUTOSUB_TIMELINE_CONCURRENCY` từ 1 đến 4.
- Chỉ ghi metadata của cue có timeline thay đổi và giới hạn 16 ghi đồng thời.
- Khi không burn subtitle, blur, logo, crop, đổi tỷ lệ hoặc độ phân giải, copy nguyên video stream và chỉ xử lý audio.
- Giữ nguyên bước trộn cuối và mastering.

## Xác minh

- Test dubbing tập trung và build TypeScript/Vite.
- `git diff --check` để kiểm tra lỗi bản vá.

## Rủi ro còn lại

- Video có burn subtitle, blur hoặc logo vẫn phải encode toàn bộ; máy tiếp tục dùng AMD AMF khi benchmark nhanh hơn x264.
- Lần dựng dub đầu tiên vẫn phải tạo tất cả segment nhưng chạy song song; cache có lợi lớn nhất khi retry hoặc dựng lại.
