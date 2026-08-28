# Debug report: tiếng bụp tại biên cue

## Phân loại

Lỗi runtime/audio trong pipeline dựng dubbing timeline.

## Bằng chứng

- Mỗi cue đã có micro-fade 12 ms trước khi được đặt lên timeline.
- Fade-out dùng `st = durationMs - fadeDuration`, trong khi `durationMs` lấy từ kết quả probe và được biểu diễn theo mili-giây.
- Sai số làm tròn vài sample có thể khiến fade-out kết thúc trước hoặc sau sample cuối thực tế, để lại biên waveform khác 0.
- Timeline segment cache cũ có thể giữ lại audio đã render bằng filter trước đó.

## Giả thuyết và xác minh

- Xác nhận: fade-out phụ thuộc timestamp làm tròn, không phụ thuộc trực tiếp sample cuối.
- Bản sửa dùng `areverse → fade-in → areverse`, vì vậy fade đuôi luôn bắt đầu từ sample cuối thật của stream.
- Cache version được tăng để segment cũ được render lại.

## Bản sửa

- Thêm `cueBoundaryFadeFilter` dùng fade đầu bình thường và fade cuối theo chiều đảo audio.
- Dùng filter mới khi render từng cue vào timeline.
- Tăng `TIMELINE_SEGMENT_CACHE_VERSION` từ 2 lên 3.
- Thêm assertion cho chuỗi filter click-safe.

## Rủi ro còn lại

Micro-fade 12 ms được giữ nguyên để không nuốt phụ âm đầu/cuối. Nếu nguồn TTS tự chứa transient lớn bên trong audio, lỗi đó không thuộc biên ghép cue và cần mẫu audio cụ thể để phân tích tiếp.
