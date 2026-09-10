# Douyin Search

## Search reliability

Video search targets 10/20/25 valid videos per action, scanning at most six upstream pages with a 70-second adapter deadline inside the backend's 90-second deadline. Provider exhaustion is distinct from a page/time limit. A later-page error returns the accumulated videos with a warning and the last successful pagination cursor/search ID; it does not discard earlier pages or advance past the failed page. No automatic CAPTCHA solving is performed.

The UI retains the previous successful search if a replacement search fails, preserves selection on load-more, and guards rapid repeated submissions. The count selector is a target, not a promise that Douyin has that many results.

## Bản vá phản hồi thiếu gợi ý

Một số truy vấn trả video nhưng thiếu `guide_search_words`. Đã vá bản repo local để dùng danh sách gợi ý rỗng thay vì ném KeyError. Sau khi cài lại upstream, áp dụng từ thư mục AutoSub:

```powershell
git -C workdir/tools/DouYin_Spider apply ../../../scripts/douyin-spider-optional-suggestions.patch
```

Bản vá nằm trong source AutoSub; không chứa cookie. Đã kiểm tra trực tiếp truy vấn `搜索历史v`, trang đầu và trang tiếp theo đều trả video sau khi vá.

Trang tải Douyin/Bilibili có mục **Tìm video Douyin**. Nhập từ khóa, chọn thứ tự/thời gian, chọn kết quả rồi thêm link vào quy trình tải hiện có. Mỗi lần tìm tối đa 20 video, không tự tải, bình luận, thích hoặc nhắn tin.

## Nguồn tích hợp

Adapter gọi trực tiếp `DouyinAPI.search_video_work` và `DouyinAuth.from_cookie` của https://github.com/cv-cat/DouYin_Spider tại commit `9afaf79580b1ee84e8954ff906ff26869d5b7f1f`. Repo được cài riêng trong workdir, không sao chép code upstream vào source AutoSub. Không chạy `main.py` upstream (có ví dụ tương tác ngoài phạm vi tìm kiếm). Kiểm tra điều kiện sử dụng và quyền tác giả upstream trước khi phân phối bản tích hợp.

## Cài trên Windows

Chạy tại thư mục AutoSub, chỉ clone khi thư mục đích chưa tồn tại:

```powershell
git clone https://github.com/cv-cat/DouYin_Spider.git workdir/tools/DouYin_Spider
git -C workdir/tools/DouYin_Spider checkout --detach 9afaf79580b1ee84e8954ff906ff26869d5b7f1f
python -m venv workdir/tools/douyin-search-venv
workdir/tools/douyin-search-venv/Scripts/python.exe -m pip install curl_cffi beautifulsoup4 loguru "protobuf>=5.27" python-dotenv cryptography ecdsa requests pillow qrcode
```

Đây là tập dependency cho đường tìm kiếm, không cài các gói livestream/media không dùng. Node.js phải có trong PATH để upstream tính chữ ký. Có thể cấu hình `DOUYIN_SPIDER_PATH` và `DOUYIN_SEARCH_PYTHON` bằng đường dẫn tuyệt đối nếu cài ở nơi khác.

## Đăng nhập và dữ liệu

Trong trình duyệt đăng nhập douyin.com, mở DevTools → Network, chọn request cùng miền và sao chép giá trị header Cookie. Dán vào trường mật khẩu trong phần tìm kiếm. Cookie chỉ giữ trong state của trang; backend truyền qua stdin cho Python, không đưa vào argv, lịch sử hoặc response. Có thể dùng biến môi trường backend `DY_COOKIES` thay thế. Không chia sẻ cookie trong chat hoặc commit vào Git.

Adapter giữ xác minh TLS, chỉ một tìm kiếm đồng thời, timeout 90 giây, không tự retry và không vượt CAPTCHA. Lỗi xác minh phải được xử lý thủ công trên Douyin. Endpoint dùng cấu hình truy cập hiện có của AutoSub: không phơi backend ra Internet khi chưa có xác thực.

Đã kiểm tra import dependency, validation, chuẩn hóa kết quả và lỗi route. Tìm kiếm thực tế cần cookie người dùng hợp lệ; chưa được coi là nghiệm thu live nếu chưa chạy với cookie. API không chính thức có thể thay đổi.
