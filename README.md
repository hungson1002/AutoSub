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

- Import và parse `.srt` / `.vtt`, dịch theo batch, validate ID và export SRT.
- Provider manager: test connection, refresh models, model nhập tay khi `/models` không có.
- OCR video theo ROI, sampling 1–4 FPS, crop frame bằng FFmpeg, nhận dạng Vision, group/deduplicate và lọc watermark lặp lại.
- STT video/audio: tách audio bằng FFmpeg rồi gọi `/audio/transcriptions`.
- **Whisper Local**: STT miễn phí, không API key/quota; tự cài `whisper.cpp`, tự tải model lượng tử một lần và chạy CPU theo hàng đợi để giữ RAM ổn định.
- **Microsoft Edge TTS**: TTS tiếng Việt không cần API key với hai giọng `HoaiMyNeural` và `NamMinhNeural`; các lượt đọc được xếp hàng để hạn chế lỗi dịch vụ.
- Editor dùng chung `SubtitleCue[]`: video preview, subtitle overlay, list editable, timestamp, CPS, G1/G2/G3, timeline và autosave local.
- Style subtitle và sinh ASS; modal blur region; modal dubbing/provider workflow; export SRT/ASS.
- **Tải Douyin hàng loạt**: bóc tách video gốc không watermark/logo từ link chia sẻ hoặc link web Douyin, tải hàng loạt theo tiến trình và nạp trực tiếp vào OCR, Review tự động hoặc Lồng tiếng video.
- **Review tự động**: chép lời video nguồn, lập hồ sơ nhân vật, tạo kịch bản kể lại cốt truyện dài 5–45 phút, chọn/cắt cảnh theo timestamp, tạo giọng đọc, ghép hình + phụ đề và xuất MP4.
- Có thể tải bản dựng lên kênh YouTube thử nghiệm ở chế độ **Private**, theo dõi trạng thái xử lý và mở thẳng YouTube Studio để xác nhận Content ID.

Các capability AI không được provider hỗ trợ sẽ trả lỗi rõ ràng thay vì hiển thị dữ liệu giả.

## Dịch phụ đề theo ngữ cảnh

Luồng dịch subtitle không còn xử lý từng dòng hoàn toàn độc lập:

- Chế độ **Chất lượng** gửi 8 cue mỗi batch; chế độ **Nhanh** gửi 16 cue mỗi batch.
- Mỗi cue kèm tối đa 2 câu trước và 2 câu sau để model hiểu đại từ, câu bị cắt, chủ thể và mạch hành động.
- Với phong cách **Review phim**, AI tạo một translation bible trước để ghi nhớ tên nhân vật, vai trò, quan hệ, cách xưng hô và thuật ngữ lặp lại.
- Cách xưng hô được lưu thành bảng hai chiều giữa từng cặp nhân vật; nếu transcript không đủ dữ kiện xác định người nói, hệ thống ưu tiên cách gọi trung tính thay vì tự suy diễn “mày/tao”.
- Translation memory được chọn theo vị trí trong phim, giữ cả các mốc đầu và các câu gần batch hiện tại để hạn chế trôi cách gọi ở video dài.
- Từ điển dịch được gửi như quy tắc bắt buộc; thuật ngữ đã khai báo phải giữ đúng cách viết trong toàn bộ kết quả.
- Phong cách mặc định là **Review phim**, ưu tiên câu tiếng Việt tự nhiên như lời kể recap nhưng không tự thêm tình tiết ngoài nguồn.
- Auto-translate sau STT cũng dùng cùng pipeline Review phim theo batch, thay vì gửi toàn bộ transcript trong một request.

Nếu cần chạy lại phần kiểm tra sau khi chỉnh sửa:

```powershell
npm test
npm run build
```

## Review tự động và kiểm tra YouTube

1. Vào **Cài đặt → AI Providers**, cấu hình provider/model có STT, Vision, Chat và TTS.
2. Mở **Review tự động**, chọn video phim gốc, giọng đọc, thời lượng và tỉ lệ khung hình rồi bấm **Tạo video review**. Tên phim/nhân vật là ô sửa tay tùy chọn; mặc định AI tự suy ra từ lời thoại và các contact sheet lấy mẫu xuyên suốt phim. Kịch bản ưu tiên 95–98% kể lại cốt truyện, chỉ thêm nhận xét ngắn khi cần.
3. Xem trước hoặc tải MP4 sau khi job hoàn tất.

Trước khi viết kịch bản, pipeline đọc một đoạn mẫu bằng đúng giọng/tốc độ đã chọn để tính số từ theo tốc độ nói thực tế. Thời lượng tiếp tục được kiểm tra bằng chính toàn bộ audio TTS đã tạo; nếu lệch đáng kể so với mốc đã chọn, pipeline sẽ viết lại kịch bản và đọc lại một lần. Sai số nhỏ còn lại được chuẩn hóa trước khi render. Mỗi đoạn phim sau đó lấy cửa sổ hình có độ dài khớp audio và phát ở tốc độ gốc, còn phụ đề được chia theo từ và dấu câu để bám giọng đọc hơn.

Để gửi bản thử lên YouTube:

1. Trong Google Cloud Console, bật **YouTube Data API v3**, cấu hình OAuth consent screen và thêm tài khoản thử nghiệm nếu ứng dụng còn ở chế độ Testing.
2. Tạo OAuth client loại **Desktop app**, tải file JSON xuống.
3. Trong khu vực YouTube của trang **Review tự động**, chọn JSON đó và kết nối kênh phụ.
4. Bấm **Tải lên Private**. Khi YouTube xử lý xong, mở liên kết Studio và đánh dấu thủ công **Có claim** hoặc **Không thấy claim**.

Token YouTube được lưu cục bộ tại `workdir/secrets/youtube-oauth.json`. YouTube Data API thông thường không trả đầy đủ kết quả Content ID trong Studio, nên ứng dụng không tự tuyên bố video “sạch bản quyền”. Kết quả kiểm tra chỉ phản ánh thời điểm hiện tại, không phải giấy phép sử dụng và claim vẫn có thể xuất hiện sau.

Pipeline review mặc định giới hạn encoder ở 4 luồng và video giữ tỉ lệ được giới hạn tối đa 1080p để tránh chiếm toàn bộ CPU/RAM. Có thể đổi số luồng bằng biến môi trường `AUTOSUB_REVIEW_THREADS` (1–16); đặt `2` nếu máy vẫn bị lag.

## Whisper Local

Provider **Whisper Local** được thêm tự động trong **Cài đặt → AI Providers**. Chọn nó cho STT rồi test model cần dùng:

- `small-q5_1`: tải khoảng 181 MiB, nhanh hơn và là lựa chọn mặc định phù hợp đa số video.
- `medium-q5_0`: tải khoảng 514 MiB, nhận lời thoại/tên riêng tốt hơn nhưng chạy chậm hơn.

Runtime và model nằm trong `workdir/whisper/`, được giữ lại khi dọn file tạm. Mặc định Whisper chạy tuần tự, CPU tối đa 4 luồng và priority thấp để máy vẫn phản hồi. Có thể đặt `AUTOSUB_WHISPER_THREADS=2` nếu muốn giảm tải thêm, hoặc `AUTOSUB_WHISPER_CPP_PATH` để dùng một `whisper-cli` đã cài sẵn.

## Microsoft Edge TTS

Provider **Microsoft Edge TTS** cũng được thêm tự động trong **Cài đặt → AI Providers**. Cài bridge Python một lần rồi chọn provider này ở mục TTS:

```powershell
py -3 -m pip install -r requirements-edge-tts.txt
```

Edge TTS sử dụng dịch vụ đọc trực tuyến của Microsoft Edge, không phải API Azure có SLA. Nó cần Internet và endpoint có thể thay đổi; nếu dịch vụ tạm lỗi, ứng dụng thử lại tối đa ba lần rồi hiện nguyên nhân cụ thể. Khi dựng review, tối đa 24 đoạn được đọc chung trong một lượt rồi tách lại theo WordBoundary để giảm mạnh số kết nối mà vẫn giữ timestamp từng cảnh.

## VieNeu Local Clone

Provider **VieNeu Local Clone** được thêm tự động và chạy trên CPU bằng VieNeu-TTS v3 Turbo/ONNX. Mở mục **Clone giọng** ở thanh bên, tải một mẫu giọng sạch với một người nói liên tục khoảng 6–10 giây, không nhạc nền hoặc tiếng vang, đặt tên và xác nhận bạn sở hữu giọng hoặc đã được người nói cho phép. Mẫu được giữ ở 48 kHz, cắt im lặng hai đầu và khử nhiễu khi enrollment để giữ màu giọng tốt hơn. Sau khi tạo hồ sơ, bạn có thể nghe thử ngay hoặc dùng cùng giọng đó trong cả **Review tự động** và **Lồng tiếng video** bằng cách chọn TTS Provider **VieNeu Local Clone**.

AutoSub tự tạo môi trường Python 3.12 trong `workdir/vieneu/runtime/` bằng `uv`, cài VieNeu ONNX cùng `kaldi-native-fbank` và tải model ở lần tổng hợp đầu tiên. Nhánh local không cài PyTorch/torchaudio nhiều gigabyte. Giọng đã tạo nằm trong `workdir/voice-clones/vieneu/` và không bị xóa bởi nút dọn file tạm. Mặc định worker dùng 2 luồng CPU, xếp hàng các lượt tổng hợp và tự tắt toàn bộ cây tiến trình sau 45 giây rảnh để trả RAM; có thể đặt `AUTOSUB_VIENEU_THREADS=1` nếu máy yếu.

VieNeu-TTS được phát hành theo Apache-2.0, nhưng người dùng vẫn phải có quyền đối với mẫu giọng và nội dung đầu ra. Nếu clone giọng của người khác đã cho phép, hãy thực hiện khai báo nội dung tổng hợp theo quy định của nền tảng. Clone giọng chỉ thay phần thuyết minh; nó không loại bỏ hoặc né Content ID đối với hình ảnh/âm thanh phim.
