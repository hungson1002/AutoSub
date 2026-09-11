"""Read-only adapter for cv-cat/DouYin_Spider (see docs/DOUYIN_SEARCH.md)."""
import contextlib
import json
import os
import sys
import time
import unicodedata


def matches_filters(item, request):
    # Literal title/hashtag matching, not an invented semantic relevance score.
    normalize = lambda text: ' '.join(unicodedata.normalize('NFKC', str(text)).casefold().split())
    title = normalize(item.get('desc', ''))
    if request.get('exactKeyword') and normalize(request['keyword']) not in title:
        return False
    if any(normalize(term) in title for term in request.get('excludeKeywords', '').split(',') if term.strip()):
        return False
    if request.get('filterDuration') == '60+':
        video = item.get('video')
        duration = video.get('duration', item.get('duration', 0)) if isinstance(video, dict) else 0
        try:
            if not 3_600_000 < float(duration) < float('inf'):
                return False
        except (TypeError, ValueError):
            return False
    return True


def main():
    deadline = time.monotonic() + 70
    request = json.load(sys.stdin)
    cookie = request.pop('cookie', '') or os.environ.get('DY_COOKIES', '')
    if not cookie.strip():
        return {'error': 'Cần cookie Douyin đã đăng nhập. Nhập cookie trong mục tìm kiếm.'}
    sys.path.insert(0, sys.argv[1])
    # Upstream can log requests/session material. Never forward its logs.
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        from loguru import logger
        logger.remove()
        from curl_cffi.requests import Session
        original_request = Session.request

        def verified_request(self, method, url, **kwargs):
            kwargs['verify'] = True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            kwargs['timeout'] = min(25, remaining)
            return original_request(self, method, url, **kwargs)

        Session.request = verified_request
        from builder.auth import DouyinAuth
        from dy_apis.douyin_api import DouyinAPI
        auth = DouyinAuth.from_cookie(cookie, bootstrap_creator=False)
        offset = request.get('offset', 0)
        target = request.get('count', 20)
        search_id = request.get('searchId', '')
        rows, seen = [], set()
        has_more = True
        warning = ''
        # Bounded read-only pagination. Keep all returned videos, never discard
        # the tail of a provider page (which would lose them on Load more).
        for _ in range(6):
            if time.monotonic() >= deadline:
                if not rows:
                    raise TimeoutError()
                warning = 'time_limit'
                break
            count = target
            try:
                next_search_id, _, result = DouyinAPI.search_video_work(
                    auth, request['keyword'], offset=str(offset), count=str(count),
                    sort_type=request['sort'], publish_time=request['publishTime'],
                    filter_duration='5-10000' if request.get('filterDuration') == '60+' else request.get('filterDuration', ''), search_range=request.get('searchRange', '0'),
                    search_id=search_id)
            except Exception:
                if not rows:
                    raise
                warning = 'partial_error'
                break
            if not isinstance(result, dict) or result.get('status_code', 0) != 0:
                if rows:
                    warning = 'partial_error'
                    break
                return {'error': 'Douyin từ chối tìm kiếm. Kiểm tra đăng nhập và xác minh trong trình duyệt.'}
            if not isinstance(result.get('data'), list):
                if rows:
                    warning = 'partial_error'
                    break
                return {'error': 'Douyin không trả danh sách video hợp lệ. Kiểm tra đăng nhập hoặc xác minh.'}
            search_id = next_search_id
            for row in result['data']:
                item = row.get('aweme_info', row) if isinstance(row, dict) else {}
                if not isinstance(item, dict):
                    continue
                identifier = str(item.get('aweme_id', ''))
                if identifier.isdigit() and 5 <= len(identifier) <= 30 and item.get('video') and not item.get('images') and identifier not in seen:
                    seen.add(identifier)
                    if matches_filters(item, request):
                        rows.append(row)
            cursor = result.get('cursor')
            offset = cursor if isinstance(cursor, int) and cursor > offset else offset + count
            has_more = result.get('has_more') == 1 and offset <= 10000
            if len(rows) >= target or not has_more:
                break
        if not warning and has_more and len(rows) < target:
            warning = 'page_limit'
        return {'data': rows, 'hasMore': has_more, 'searchId': search_id, 'nextOffset': offset, 'warning': warning}


if __name__ == '__main__':
    try:
        result = main()
    except ModuleNotFoundError:
        result = {'error': 'Thiếu dependency Python. Chạy hướng dẫn cài Douyin Search trong docs/DOUYIN_SEARCH.md.'}
    except Exception as error:
        # Do not include exception text: upstream may embed cookies/headers.
        kind = type(error).__name__
        messages = {
            'KeyError': 'Phản hồi Douyin thiếu trường dữ liệu mà repo yêu cầu.',
            'JSONDecodeError': 'Douyin trả phản hồi rỗng hoặc không phải JSON.',
            'Timeout': 'Kết nối Douyin quá thời gian.',
            'ConnectionError': 'Không kết nối được Douyin.',
            'SSLError': 'Không xác minh được chứng chỉ kết nối Douyin.',
        }
        result = {'error': messages.get(kind, 'Adapter Douyin gặp lỗi xử lý; chưa thể kết luận cookie hết hạn.')}
        # Only code locations, never exception values, headers or local variables.
        trace = error.__traceback__
        locations = []
        while trace:
            locations.append(f'{os.path.basename(trace.tb_frame.f_code.co_filename)}:{trace.tb_lineno}')
            trace = trace.tb_next
        result['error'] += ' [' + kind + ' ' + ' > '.join(locations[-3:]) + ']'
    print(json.dumps(result, ensure_ascii=False))
