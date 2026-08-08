# AutoSub Studio

Ứng dụng cá nhân chạy local để xử lý subtitle, dịch, OCR/STT và chuẩn bị dubbing video. Không có login, billing, cloud storage hay database server.

## Chạy trên Windows

```powershell
npm install
npm run dev
```

Mở `http://localhost:5173`. Backend chạy ở `http://127.0.0.1:8787` và tự kiểm tra `ffmpeg` / `ffprobe` khi khởi động.

Provider được nhập tại **Cài đặt → AI Providers**. Provider ưu tiên giao thức OpenAI-compatible (`/models`, `/chat/completions`, `/audio/transcriptions`); API key chỉ đi qua request cần thiết và không được log.

## Luồng đã có

- Import và parse `.srt` / `.vtt`, dịch theo batch tối đa 30 cue, validate ID và export SRT.
- Provider manager: test connection, refresh models, model nhập tay khi `/models` không có.
- OCR video theo ROI, sampling 1–4 FPS, crop frame bằng FFmpeg, nhận dạng Vision, group/deduplicate và lọc watermark lặp lại.
- STT video/audio: tách audio bằng FFmpeg rồi gọi `/audio/transcriptions`.
- Editor dùng chung `SubtitleCue[]`: video preview, subtitle overlay, list editable, timestamp, CPS, G1/G2/G3, timeline và autosave local.
- Style subtitle và sinh ASS; modal blur region; modal dubbing/provider workflow; export SRT/ASS.

Các capability AI không được provider hỗ trợ sẽ trả lỗi rõ ràng thay vì hiển thị dữ liệu giả.
