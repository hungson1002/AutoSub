# Báo cáo chẩn đoán lỗi tải Bilibili bị EOF sớm

> Thời gian: 2026-08-27
> Loại lỗi: runtime/network
> Phạm vi: nhánh tải dự phòng bằng FFmpeg

## Hiện tượng

Video Bilibili dừng ở khoảng 35,9 MB dù máy chủ khai báo khoảng 406,1 MB. FFmpeg báo `Stream ends prematurely` và `Error opening input files: End of file`.

## Bằng chứng và xác minh

| Giả thuyết | Kết quả |
| --- | --- |
| Link hoặc metadata Bilibili không hợp lệ | Bác bỏ: tiêu đề, ảnh bìa và dung lượng kỳ vọng đều đã được lấy thành công. |
| File trả về rỗng hoặc sai định dạng | Bác bỏ: luồng đã tải được hàng chục MB trước khi bị ngắt. |
| CDN kết thúc luồng sớm nhưng FFmpeg không coi EOF là điều kiện reconnect | Xác nhận từ thông báo `Stream ends prematurely` và cấu hình FFmpeg hiện tại. |

## Nguyên nhân gốc (xác minh lần hai)

CDN đóng mỗi phản hồi Range sau khoảng 359 KB. Downloader vẫn ghi được phần dữ liệu đó và biết offset để tải tiếp, nhưng tăng bộ đếm lỗi sau mỗi lần ngắt. Sau sáu phản hồi có tiến triển, nó bỏ tải Range và chuyển sang FFmpeg; FFmpeg cũng bị CDN cắt tương tự. Thiếu `reconnect_at_eof` chỉ là vấn đề ở nhánh dự phòng, không phải nguyên nhân chính.

Xác minh trực tiếp lần ba cho thấy URL Akamai trả 206 rồi ngắt đúng tại 359.465 byte; mọi Range tiếp theo trả 503. Request `playurl` có `platform=html5` khiến Bilibili không trả `backup_url`. Bỏ tham số này trả thêm CDN `upos-sz-mirrorcosov.bilivideo.com`, đã đọc đủ cả Range đầu và Range bắt đầu từ byte 359.465.

## Bản sửa

- Bộ đếm Range giờ chỉ tăng khi một lần thử không tải thêm được byte nào.
- Nếu phản hồi bị ngắt nhưng đã ghi thêm dữ liệu, downloader tiếp tục từ offset mới.
- Giữ `-reconnect_at_eof 1` cho nhánh FFmpeg dự phòng.
- Bỏ `platform=html5` khỏi API Bilibili để nhận và thử CDN dự phòng hoạt động.

## Xác minh

- Test hồi quy mô phỏng CDN ngắt mọi phản hồi sau 256 KB: đạt và hoàn tất đủ file sau hơn sáu lần ngắt.
- Toàn bộ nhóm test tải phân đoạn Bilibili: 4/4 đạt.
- Test extractor và downloader: 15/15 đạt.
- `npm run build`: TypeScript và Vite build thành công.

## Rủi ro còn lại

Nếu mọi CDN chính và dự phòng đều ngắt liên tục quá giới hạn retry, tác vụ vẫn thất bại và cần thử lại sau.
