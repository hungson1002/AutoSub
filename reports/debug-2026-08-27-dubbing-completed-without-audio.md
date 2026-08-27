# Chẩn đoán job dubbing 100% nhưng không có tiếng lồng

> Loại lỗi: runtime/state flow
> Phạm vi: job `completed_with_errors` và preview/export dub track

## Hiện tượng

Job hoàn tất 3259/3260 cue và hiển thị 100%, nhưng video preview không có lựa chọn hoặc âm thanh lồng tiếng.

## Nguyên nhân

Khi còn bất kỳ cue lỗi nào, runner đặt trạng thái `completed_with_errors` rồi thoát trước bước dựng `dub-track.wav`. Editor cũng chỉ tải kết quả khi trạng thái là `completed`. Vì vậy 3259 cue thành công không bao giờ được ghép hoặc nạp vào trình phát.

Ngoài ra, thao tác `Retry cue lỗi` trước đây chỉ đổi trạng thái cue đã lưu sang pending. Nội dung subtitle vừa sửa trong Editor không được gửi lại, nên provider tiếp tục nhận text cũ và lặp lại cùng lỗi.

## Bản sửa

- Dựng dub track từ tất cả cue thành công ngay cả khi còn cue lỗi; timestamp của cue lỗi trở thành khoảng im lặng.
- Editor nạp preview và cho phép export kết quả của cả `completed` và `completed_with_errors`.
- Khi retry cue lỗi, kết quả cũ được vô hiệu hóa và dựng lại sau lượt chạy mới.
- Thay mô tả hard-code `CapCut TTS` bằng `Provider TTS` để phản ánh đúng VieNeu hoặc provider đang chọn.
- Nếu toàn bộ cue đều lỗi thì không tạo track rỗng.
- Khi retry, Editor gửi text, timestamp, nội dung trước/sau và từ điển phát âm hiện tại cho đúng các cue lỗi; các cue hoàn tất không chạy lại.

## Xác minh

- 53/53 test dubbing, route và API đạt.
- TypeScript và Vite production build thành công.
