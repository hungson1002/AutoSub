# Debug report: khôi phục cadence cân bằng theo cụm

## Triệu chứng

Sau thay đổi giữ cue vừa ở 1.00x, các cue dài không còn chia áp lực nhẹ sang cue lân cận. Độ trễ vì thế tích lũy và lời thoại nghe chậm so với cảnh.

## Đối chiếu

- `kyma-dub` neo từng chunk vào timestamp nguồn, chỉ tăng tốc để vừa slot và không kéo chậm vì kéo chậm tạo cảm giác trễ.
- `sub-to-audio` có chế độ overflow dùng cả khoảng trống trước subtitle kế tiếp và giới hạn mức tăng tốc.
- Logic cũ của AutoSub kết hợp hai ý này: dùng gap ngắn, giữ hard pause, blend nhẹ tempo trong cụm và giới hạn 1.18x.

## Xử lý

- Hoàn tác riêng thay đổi cadence giữ 1.00x cứng.
- Khôi phục blend tempo theo cue trước/sau.
- Giữ nguyên quy tắc không cue nào bắt đầu trước timestamp SRT.
- Giữ các sửa độc lập: fade chống bụp, SRT chống overlap, bookmark và preview voice.

## Xác minh

- 39/39 test `server/services/dubbingJobs.test.ts` thành công.
- Test bao phủ: không nói sớm, không chồng cue, giữ scene gap, chia tempo trong cụm, giới hạn tốc độ và chống trễ tích lũy.
