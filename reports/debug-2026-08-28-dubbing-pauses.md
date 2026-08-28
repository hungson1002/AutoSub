# Debug report: khoảng ngắt giữa các cue lồng tiếng

## Phân loại

Runtime/audio cadence. Kiểm tra read-only trên job gần nhất `dub-1787926872200-1973ee4c`.

## Bằng chứng

- Job hoàn thành 62/62 cue, không cue lỗi.
- Tốc độ trung bình: 1.041x; tốc độ lớn nhất: 1.156x; 7 cue vượt 1.10x.
- 13 cue được dời muộn, độ dời lớn nhất 59 ms.
- Không có khoảng âm giữa cue bị âm, tức không có hai cue chồng tiếng.
- Có 15 khoảng nghỉ audio lớn hơn 300 ms.
- Khoảng lớn nhất cue 4 → 5 là 2.294 giây, gần với khoảng SRT 2.358 giây nên đây là pause nguồn.
- Một số pause phát sinh do TTS đọc ngắn hơn cửa sổ: cue 39 → 40 có SRT gap 0 ms nhưng audio gap 380 ms; cue 61 → 62 có SRT gap 92 ms nhưng audio gap 380 ms.

## Logic hiện tại

- Cue không được bắt đầu trước `startMs` của SRT.
- Cue dài được tăng tốc theo cụm, giới hạn khoảng 1.18x.
- Cue sau được đẩy muộn nếu cue trước chưa kết thúc, nhưng không bao giờ chồng tiếng.
- Cue đọc ngắn không bị kéo chậm và cue tiếp theo không được kéo sớm để lấp khoảng trống.

## Kết luận

Thuật toán đang hoạt động đúng thiết kế bảo toàn timestamp SRT. Cảm giác bị ngắt còn lại chủ yếu đến từ pause có sẵn trong SRT và phần dư khi VieNeu đọc câu ngắn hơn cửa sổ subtitle, không phải lỗi chia batch hoặc cue bị chồng.

## Hướng cải thiện đề xuất

Thêm chế độ cadence liên tục cho lồng tiếng: chỉ với các cue thuộc cùng cụm hội thoại, cho cue sau bắt đầu sớm hơn SRT một lượng nhỏ hoặc kéo tốc độ cue ngắn về gần 1.0/nhẹ dưới 1.0. Cần giữ hard pause ở chuyển cảnh và không thay đổi timestamp subtitle xuất file.
