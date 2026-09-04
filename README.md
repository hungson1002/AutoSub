# AutoSub Studio

Ứng dụng chạy local để dịch và xử lý phụ đề video. AutoSub tập trung vào bản dịch tiếng Việt tự nhiên, nhất quán theo ngữ cảnh, đồng thời hỗ trợ trích xuất phụ đề, lồng tiếng và xuất video.

## Tính năng chính

- Dịch `.srt` / `.vtt` theo batch, giữ ngữ cảnh, tên nhân vật, cách xưng hô và thuật ngữ xuyên suốt video.
- Trích xuất phụ đề bằng OCR theo vùng ảnh hoặc STT từ audio/video.
- Chỉnh sửa nội dung, timestamp, style và xem trước trực tiếp trên timeline.
- Lồng tiếng theo từng cue, tự cân tốc độ và giới hạn chồng giọng để giữ nhịp tự nhiên.
- Xuất SRT, ASS, audio lồng tiếng hoặc video hoàn chỉnh.
- Tải video công khai từ Douyin, Bilibili và b23.tv để đưa thẳng vào quy trình xử lý.
- Hỗ trợ provider OpenAI-compatible, Whisper Local và Microsoft Edge TTS.

AutoSub không có tài khoản, billing, cloud storage hay database server. Cấu hình provider và dữ liệu dự án được giữ trên máy.

## Chạy trên Windows

Yêu cầu Node.js và FFmpeg/FFprobe có trong `PATH`.

```powershell
npm install
npm run dev
```

Mở `http://localhost:5173`. Backend chạy tại `http://127.0.0.1:8787`.

Thêm provider tại **Cài đặt → AI Providers**, kiểm tra kết nối rồi chọn model phù hợp cho Translation, Vision, STT hoặc TTS.

### Google Flow qua Flow Agent

AI Video Studio dùng [kodelyx/flow-agent](https://github.com/kodelyx/flow-agent) tại `http://127.0.0.1:8001`; AutoSub không còn yêu cầu bạn nhập Flow client key, access token hoặc cookie.

```powershell
git clone https://github.com/kodelyx/flow-agent.git
cd flow-agent\flow-agent
uv tool install --force .
flow
```

Sau đó mở `opera://extensions`, bật Developer mode, chọn **Load unpacked** và trỏ tới thư mục `flow-extension` của Flow Agent (trên máy hiện tại: `C:\Users\super\AppData\Local\AutoSub\flow-agent-runtime\flow-extension`). Giữ một tab Google Flow đã đăng nhập. Nút **Mở Google Flow** sẽ dùng phiên Opera GX hiện tại và AI Video Studio sẽ tự hiển thị trạng thái kết nối.

Có thể đổi địa chỉ backend bằng `FLOW_AGENT_URL` trong `.env`; nếu Flow Agent bật `SERVER_API_KEY`, đặt cùng khóa vào `FLOW_AGENT_API_KEY`.

Nếu Opera GX được cài ở vị trí khác, đặt đường dẫn file `opera.exe` bằng `OPERA_PATH` trong `.env`.

## Kiểm tra

```powershell
npm test
npm run build
```

Dữ liệu lâu dài nằm trong `workdir/`; file tạm nặng nằm trong `%LOCALAPPDATA%\AutoSub\temp`.
