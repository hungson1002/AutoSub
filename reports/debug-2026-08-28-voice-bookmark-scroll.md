# Debug report: bookmark giọng chưa hiện ở đầu ngay

## Phân loại

Lỗi UI state/scroll trong voice picker.

## Bằng chứng

- State bookmark được cập nhật và comparator đã đưa voice bookmark lên đầu ngay trong lần render kế tiếp.
- `.voice-picker-list` là vùng cuộn độc lập với `overflow-y: auto`.
- Khi các node được sắp lại, trình duyệt giữ nguyên `scrollTop`; vì vậy voice đã lên đầu nhưng nằm ngoài vùng đang nhìn.
- Đóng và mở dropdown tạo lại vùng danh sách tại `scrollTop = 0`, nên lúc đó người dùng mới thấy voice ở đầu.

## Bản sửa

- Gắn ref vào vùng danh sách.
- Sau khi thêm bookmark và React cập nhật thứ tự, cuộn vùng danh sách về đầu ở animation frame kế tiếp.
- Khi bỏ bookmark không ép cuộn, tránh làm gián đoạn vị trí đang duyệt.

## Xác minh

TypeScript/build là kiểm tra hồi quy tối thiểu; hành vi cần xác nhận bằng thao tác bookmark một voice đang nằm thấp trong danh sách đã cuộn.
