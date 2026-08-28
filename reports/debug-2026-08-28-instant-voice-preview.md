# Debug report: nghe thử voice có độ trễ

## Phân loại

UI/API latency trong voice picker.

## Bằng chứng

- Lần nghe đầu gọi `/api/dubbing/test` và phải chờ TTS tổng hợp audio.
- Cache frontend trước đây chỉ được ghi sau khi người dùng bấm play.
- Cache server có hiệu lực trong phiên nhưng không loại bỏ độ trễ của lần tạo đầu tiên.

## Bản sửa

- Khi mở dropdown, chuẩn bị nền giọng đang chọn và tối đa 6 giọng bookmark.
- Khi con trỏ hoặc bàn phím focus nút play, chuẩn bị đúng giọng đó.
- Các lượt chuẩn bị và lượt bấm dùng chung một Promise theo cache key, không gửi request trùng.
- Dùng câu mẫu tiếng Việt ngắn hơn để giảm thời gian tổng hợp mà vẫn nhận biết được chất giọng.
- Không preload toàn bộ danh sách để tránh chiếm CPU/RAM và làm nghẽn VieNeu.

## Kỳ vọng

Giọng đã chọn/bookmark hoặc đã được hover sẽ phát gần như ngay khi bấm. Lần đầu bấm một voice chưa từng được chuẩn bị vẫn phải chờ TTS thực hiện; đây là giới hạn vật lý của tổng hợp giọng.
