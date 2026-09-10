"""Adapter contract tests, no network or real login cookie required."""
import importlib.util
import io
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('adapter', pathlib.Path(__file__).with_name('douyin-search.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class SearchTests(unittest.TestCase):
    def run_pages(self, pages):
        from curl_cffi.requests import Session
        original = Session.request
        auth = types.ModuleType('builder.auth')
        auth.DouyinAuth = Mock()
        api = types.ModuleType('dy_apis.douyin_api')
        api.DouyinAPI = Mock()
        api.DouyinAPI.search_video_work.side_effect = pages
        try:
            with patch.dict(sys.modules, {'builder.auth': auth, 'dy_apis.douyin_api': api}), patch('sys.stdin', io.StringIO(json.dumps({'keyword': 'test', 'sort': '0', 'publishTime': '0', 'cookie': 'fixture'}))), patch.object(sys, 'argv', ['adapter', '.']):
                return adapter.main(), api.DouyinAPI.search_video_work
        finally:
            Session.request = original

    def test_partial_failure_keeps_rows_and_resume_cursor(self):
        result, api = self.run_pages([('first', [], {'data': [{'aweme_id': '123456', 'video': {'duration': 1000}}], 'has_more': 1, 'cursor': 25}), RuntimeError('secret-must-not-leak')])
        self.assertEqual(len(result['data']), 1)
        self.assertEqual(result['nextOffset'], 25)
        self.assertEqual(result['searchId'], 'first')
        self.assertEqual(result['warning'], 'partial_error')
        self.assertTrue(result['hasMore'])
        self.assertNotIn('secret-must-not-leak', json.dumps(result))
        self.assertEqual(api.call_args.kwargs['offset'], '25')

    def test_duplicate_rows_are_removed_and_exhaustion_is_distinct(self):
        row = {'aweme_id': '123456', 'video': {'duration': 1000}}
        result, _ = self.run_pages([('first', [], {'data': [row, {'aweme_info': None}], 'has_more': 1, 'cursor': 25}), ('second', [], {'data': [row, {'aweme_id': '654321', 'video': {'duration': 1000}}], 'has_more': 0, 'cursor': 50})])
        self.assertEqual(len(result['data']), 2)
        self.assertFalse(result['hasMore'])
        self.assertEqual(result['warning'], '')

    def test_page_limit_does_not_claim_exhaustion(self):
        result, api = self.run_pages([('id', [], {'data': [], 'has_more': 1, 'cursor': i * 25}) for i in range(1, 7)])
        self.assertEqual(api.call_count, 6)
        self.assertTrue(result['hasMore'])
        self.assertEqual(result['warning'], 'page_limit')

    def test_requires_cookie_without_starting_login(self):
        with patch('sys.stdin', io.StringIO('{}')), patch.dict('os.environ', {'DY_COOKIES': ''}):
            self.assertIn('error', adapter.main())

    def test_calls_video_search_once_with_filters_and_no_creator_bootstrap(self):
        from curl_cffi.requests import Session
        original = Session.request
        auth = types.ModuleType('builder.auth')
        auth.DouyinAuth = Mock()
        api = types.ModuleType('dy_apis.douyin_api')
        api.DouyinAPI = Mock()
        api.DouyinAPI.search_video_work.return_value = ('id', [], {'status_code': 0, 'data': [{'aweme_info': {'aweme_id': '123456', 'video': {'duration': 1000}}}]})
        request = {'keyword': '动画', 'sort': '2', 'publishTime': '7', 'cookie': 'fixture-cookie', 'offset': 25, 'count': 25, 'searchId': 'previous-id', 'filterDuration': '1-5', 'searchRange': '2'}
        try:
            with patch.dict(sys.modules, {'builder.auth': auth, 'dy_apis.douyin_api': api}), patch('sys.stdin', io.StringIO(json.dumps(request))), patch.object(sys, 'argv', ['adapter', '.']):
                result = adapter.main()
            auth.DouyinAuth.from_cookie.assert_called_once_with('fixture-cookie', bootstrap_creator=False)
            api.DouyinAPI.search_video_work.assert_called_once_with(auth.DouyinAuth.from_cookie.return_value, '动画', offset='25', count='25', sort_type='2', publish_time='7', filter_duration='1-5', search_range='2', search_id='previous-id')
            self.assertFalse(result['hasMore'])
            self.assertEqual(result['searchId'], 'id')
            self.assertEqual(len(result['data']), 1)
            self.assertNotIn('fixture-cookie', json.dumps(result))
        finally:
            Session.request = original


if __name__ == '__main__':
    unittest.main()
