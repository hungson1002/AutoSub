export type DouyinField = { key: string; label: string; kind?: 'id' | 'text' | 'user' | 'video'; optional?: boolean };
export type DouyinTool = { id: string; label: string; group: string; write?: boolean; fields: DouyinField[]; paged?: boolean };
const keyword: DouyinField = { key: 'query', label: 'Từ khóa' };
const user: DouyinField = { key: 'user', label: 'Sec UID hoặc URL hồ sơ Douyin', kind: 'user' };
const video: DouyinField = { key: 'video', label: 'ID hoặc URL video Douyin', kind: 'video' };
const uid: DouyinField = { key: 'uid', label: 'UID người dùng (dạng số)', kind: 'id' };
const room: DouyinField = { key: 'room', label: 'Room ID nội bộ (từ thông tin livestream)', kind: 'id' };
const content: DouyinField = { key: 'content', label: 'Nội dung', kind: 'text' };
const collection: DouyinField[] = [{ key: 'collection', label: 'ID bộ sưu tập', kind: 'id' }, { key: 'name', label: 'Tên bộ sưu tập' }];
export const douyinTools: DouyinTool[] = [
  { id: 'users', label: 'Tìm người dùng', group: 'Khám phá', fields: [keyword], paged: true },
  { id: 'lives', label: 'Tìm livestream', group: 'Khám phá', fields: [keyword], paged: true },
  { id: 'profile', label: 'Hồ sơ người dùng', group: 'Khám phá', fields: [user] },
  { id: 'works', label: 'Tác phẩm của người dùng', group: 'Khám phá', fields: [user], paged: true },
  { id: 'detail', label: 'Chi tiết video / ảnh', group: 'Khám phá', fields: [video] },
  { id: 'comments', label: 'Bình luận video', group: 'Bình luận', fields: [video], paged: true },
  { id: 'replies', label: 'Trả lời bình luận', group: 'Bình luận', fields: [video, { key: 'comment', label: 'ID bình luận', kind: 'id' }], paged: true },
  { id: 'followers', label: 'Danh sách người theo dõi', group: 'Tài khoản', fields: [user, uid], paged: true },
  { id: 'following', label: 'Danh sách đang theo dõi', group: 'Tài khoản', fields: [user, uid], paged: true },
  { id: 'favorites', label: 'Video đã thích (nếu được phép xem)', group: 'Tài khoản', fields: [user], paged: true },
  { id: 'collections', label: 'Bộ sưu tập của tôi', group: 'Tài khoản', fields: [] },
  { id: 'notices', label: 'Thông báo của tôi', group: 'Tài khoản', fields: [], paged: true },
  { id: 'feed', label: 'Video được đề xuất', group: 'Tài khoản', fields: [] },
  { id: 'live-info', label: 'Thông tin livestream', group: 'Livestream', fields: [{ key: 'live', label: 'ID trên URL live.douyin.com', kind: 'id' }] },
  { id: 'live-products', label: 'Sản phẩm đang giới thiệu trên live', group: 'Livestream', fields: [{ key: 'live', label: 'ID trên URL live.douyin.com', kind: 'id' }, room, uid] },
  { id: 'product-comments', label: 'Đánh giá sản phẩm', group: 'Livestream', fields: [{ key: 'product', label: 'Product ID', kind: 'id' }, { key: 'shop', label: 'Shop ID', kind: 'id' }], paged: true },
  { id: 'product-ratings', label: 'Thống kê đánh giá sản phẩm', group: 'Livestream', fields: [{ key: 'product', label: 'Product ID', kind: 'id' }, { key: 'shop', label: 'Shop ID', kind: 'id' }] },
  { id: 'conversation', label: 'Tạo / mở cuộc trò chuyện', group: 'Tin nhắn', write: true, fields: [uid] },
  { id: 'live-events', label: 'Thu sự kiện livestream trong 20 giây', group: 'Livestream', fields: [{ key: 'live', label: 'ID trên URL live.douyin.com', kind: 'id' }] },
  { id: 'inbox-events', label: 'Nhận tin nhắn mới trong 20 giây', group: 'Tin nhắn', fields: [] },
  { id: 'like', label: 'Thích video', group: 'Tương tác', write: true, fields: [video] },
  { id: 'unlike', label: 'Bỏ thích video', group: 'Tương tác', write: true, fields: [video] },
  { id: 'collect', label: 'Lưu video vào yêu thích', group: 'Tương tác', write: true, fields: [video] },
  { id: 'uncollect', label: 'Bỏ lưu video', group: 'Tương tác', write: true, fields: [video] },
  { id: 'move-collection', label: 'Chuyển video vào bộ sưu tập', group: 'Tương tác', write: true, fields: [video, ...collection] },
  { id: 'remove-collection', label: 'Bỏ video khỏi bộ sưu tập', group: 'Tương tác', write: true, fields: [video, ...collection] },
  { id: 'comment', label: 'Đăng bình luận / trả lời', group: 'Tương tác', write: true, fields: [video, content, { key: 'reply', label: 'ID bình luận cần trả lời (tùy chọn)', kind: 'id', optional: true }] },
  { id: 'live-like', label: 'Thích livestream một lần', group: 'Tương tác', write: true, fields: [room] },
  { id: 'live-message', label: 'Gửi bình luận livestream', group: 'Tương tác', write: true, fields: [room, content] },
  { id: 'message', label: 'Gửi tin nhắn văn bản', group: 'Tin nhắn', write: true, fields: [uid, content] },
];
