import importlib.util
import pathlib
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('actions', pathlib.Path(__file__).with_name('douyin-actions.py'))
actions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(actions)


class ActionTests(unittest.TestCase):
    def test_unknown_action_cannot_call_arbitrary_method(self):
        api = Mock()
        with self.assertRaises(ValueError):
            actions.dispatch(api, None, 'get_identity_security_token', {}, '0')
        self.assertEqual(api.mock_calls, [])

    def test_reply_mapping(self):
        api = Mock()
        actions.dispatch(api, 'auth', 'replies', {'video': '123456', 'comment': '987654'}, '20')
        api.get_work_inner_comment.assert_called_once_with('auth', {'aweme_id': '123456', 'cid': '987654'}, '20', '20')

    def test_message_creates_conversation_and_sends_once(self):
        api = Mock()
        api.create_conversation.return_value = ('conversation', 123, 'ticket')
        actions.dispatch(api, 'auth', 'message', {'uid': '456', 'content': 'test'}, '0')
        api.send_msg.assert_called_once_with('auth', 'conversation', 123, 'ticket', 'test')

    def test_unlike_is_not_like(self):
        api = Mock()
        actions.dispatch(api, 'auth', 'unlike', {'video': '123456'}, '0')
        api.digg.assert_called_once_with('auth', '123456', digg_type='0')

    def test_conversation_does_not_expose_ticket_or_send_message(self):
        api = Mock()
        api.create_conversation.return_value = ('conv', 123, 'private-ticket')
        result = actions.dispatch(api, 'auth', 'conversation', {'uid': '456'}, '0')
        self.assertEqual(result, {'conversation_id': 'conv', 'conversation_short_id': '123'})
        api.send_msg.assert_not_called()

    def test_all_rest_mappings_have_valid_upstream_signatures(self):
        import inspect
        import sys
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'workdir/tools/DouYin_Spider'))
        from dy_apis.douyin_api import DouyinAPI
        class SignatureOnly:
            def __getattr__(self, name):
                signature = inspect.signature(getattr(DouyinAPI, name))
                def invoke(*args, **kwargs):
                    signature.bind(*args, **kwargs)
                    return ('conv', 123, 'ticket') if name == 'create_conversation' else {}
                return invoke
        p = {'query': 'test', 'video': '123456', 'user': 'MS4wLjABtest', 'uid': '123456', 'comment': '123456', 'live': '123456', 'room': '123456', 'content': 'test', 'collection': '123456', 'name': 'test', 'product': '123456', 'shop': '123456'}
        for operation in ['users', 'lives', 'profile', 'works', 'detail', 'comments', 'replies', 'followers', 'following', 'favorites', 'collections', 'notices', 'feed', 'live-info', 'like', 'unlike', 'collect', 'uncollect', 'move-collection', 'remove-collection', 'comment', 'live-like', 'live-message', 'message', 'conversation', 'live-products', 'product-comments', 'product-ratings']:
            with self.subTest(operation=operation):
                actions.dispatch(SignatureOnly(), None, operation, p, '0')


if __name__ == '__main__':
    unittest.main()
