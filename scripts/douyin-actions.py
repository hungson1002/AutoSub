"""Explicit, single-operation adapter. Never execute upstream main.py."""
import contextlib
import json
import os
import sys


def dispatch(api, auth, operation, p, cursor):
    if operation in ('live-events', 'inbox-events'):
        import importlib.util
        spec = importlib.util.spec_from_file_location('douyin_events', os.path.join(os.path.dirname(__file__), 'douyin-events.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.capture(auth, p.get('live'))
    video = p.get('video', '')
    user = p.get('user', '')
    video_url = 'https://www.douyin.com/video/' + video
    user_url = 'https://www.douyin.com/user/' + user
    calls = {
        'users': lambda: api.search_user(auth, p['query'], offset=cursor, num='20'),
        'lives': lambda: api.search_live(auth, p['query'], offset=cursor, num='20'),
        'profile': lambda: api.get_user_info(auth, user_url),
        'works': lambda: api.get_user_work_info(auth, user_url, cursor),
        'detail': lambda: api.get_work_info(auth, video_url),
        'comments': lambda: api.get_work_out_comment(auth, video_url, cursor),
        'replies': lambda: api.get_work_inner_comment(auth, {'aweme_id': video, 'cid': p['comment']}, cursor, '20'),
        'followers': lambda: api.get_user_follower_list(auth, p['uid'], user, max_time=None if cursor == '0' else cursor, count='20'),
        'following': lambda: api.get_user_following_list(auth, p['uid'], user, max_time=cursor, count='20'),
        'favorites': lambda: api.get_user_favorite(auth, user, max_cursor=cursor, num='20'),
        'collections': lambda: api.get_collect_list(auth),
        'notices': lambda: api.get_notice_list(auth, max_time=cursor, count='20'),
        'feed': lambda: api.get_feed(auth, count='20'),
        'live-info': lambda: api.get_live_info(auth, p['live']),
        'live-products': lambda: api.get_live_production(auth, 'https://live.douyin.com/' + p['live'], p['room'], p['uid']),
        'product-comments': lambda: api.get_product_comments(auth, p['product'], p['shop'], cursor=cursor),
        'product-ratings': lambda: api.get_product_comment_counter(auth, p['product'], p['shop']),
        'like': lambda: api.digg(auth, video, digg_type='1'),
        'unlike': lambda: api.digg(auth, video, digg_type='0'),
        'collect': lambda: api.collect_aweme(auth, video, action='1'),
        'uncollect': lambda: api.collect_aweme(auth, video, action='0'),
        'move-collection': lambda: api.move_collect_aweme(auth, video, p['name'], p['collection']),
        'remove-collection': lambda: api.remove_collect_aweme(auth, video, p['name'], p['collection']),
        'comment': lambda: api.publish_comment(auth, video, p['content'], reply_id=p.get('reply', '')),
        'live-like': lambda: api.diggLiveRoom(auth, p['room'], count='1'),
        'live-message': lambda: api.sendMsgInRoom(auth, p['room'], p['content']),
    }
    if operation in ('message', 'conversation'):
        conversation, short_id, ticket = api.create_conversation(auth, int(p['uid']))
        if operation == 'conversation':
            return {'conversation_id': conversation, 'conversation_short_id': str(short_id)}
        return api.send_msg(auth, conversation, short_id, ticket, p['content'])
    if operation not in calls:
        raise ValueError('Unknown operation')
    return calls[operation]()


def main():
    request = json.load(sys.stdin)
    sys.path.insert(0, sys.argv[1])
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        from loguru import logger
        logger.remove()
        from curl_cffi.requests import Session
        original = Session.request
        def secure(self, method, url, **kwargs):
            kwargs['verify'] = True
            kwargs['timeout'] = 25
            return original(self, method, url, **kwargs)
        Session.request = secure
        from builder.auth import DouyinAuth
        from dy_apis.douyin_api import DouyinAPI
        auth = DouyinAuth.from_cookie(request['cookie'], bootstrap_creator=False)
        result = dispatch(DouyinAPI, auth, request['operation'], request['params'], request.get('cursor', '0'))
        if result is None or result is False:
            return {'error': 'Douyin không xác nhận thành công. Kiểm tra trực tiếp trước khi thử lại.'}
        if isinstance(result, dict) and result.get('status_code', 0) != 0:
            return {'error': 'Douyin từ chối thao tác. Kiểm tra quyền tài khoản hoặc xác minh trong trình duyệt.'}
        return {'data': result}


if __name__ == '__main__':
    try:
        result = main()
    except Exception as error:
        # No exception values: upstream embeds session material in some errors.
        result = {'error': 'Repo Douyin không hoàn tất thao tác [' + type(error).__name__ + ']. Không tự thử lại thao tác ghi; kiểm tra Douyin trước.'}
    print(json.dumps(result, ensure_ascii=False))
