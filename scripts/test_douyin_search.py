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
    def run_pages(self, pages, **filters):
        from curl_cffi.requests import Session
        original = Session.request
        auth = types.ModuleType('builder.auth')
        auth.DouyinAuth = Mock()
        api = types.ModuleType('dy_apis.douyin_api')
        api.DouyinAPI = Mock()
        api.DouyinAPI.search_video_work.side_effect = pages
        try:
            with patch.dict(sys.modules, {'builder.auth': auth, 'dy_apis.douyin_api': api}), patch('sys.stdin', io.StringIO(json.dumps({'keyword': 'test', 'sort': '0', 'publishTime': '0', 'cookie': 'fixture', **filters}))), patch.object(sys, 'argv', ['adapter', '.']):
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

    def test_hour_filter_scans_more_pages_and_maps_supported_provider_filter(self):
        rows = [{'aweme_id': str(123456 + i), 'video': {'duration': value}} for i, value in enumerate([3600000, 3599999, None, 'bad', 'NaN', 'Infinity'])]
        result, api = self.run_pages([('one', [], {'data': rows, 'has_more': 1, 'cursor': 20}), ('two', [], {'data': [{'aweme_id': '999999', 'video': {'duration': 3601000}}], 'has_more': 0, 'cursor': 40})], filterDuration='60+')
        self.assertEqual([row['aweme_id'] for row in result['data']], ['999999'])
        self.assertEqual(api.call_count, 2)
        self.assertEqual(api.call_args.kwargs['filter_duration'], '5-10000')
        self.assertEqual(api.call_args.kwargs['count'], '20')

    def test_exact_phrase_and_exclusions_are_literal_unicode_normalized(self):
        filters = {'keyword': '动画', 'exactKeyword': True, 'excludeKeywords': '广告, 直播'}
        self.assertTrue(adapter.matches_filters({'desc': '精彩 #动画 合集'}, filters))
        self.assertFalse(adapter.matches_filters({'desc': '旅游风景'}, filters))
        self.assertFalse(adapter.matches_filters({'desc': '动画 直播'}, filters))
        self.assertTrue(adapter.matches_filters({'desc': 'ＷＨＡＴ  IF test'}, {'keyword': 'what if', 'exactKeyword': True}))

    def test_filtered_rows_do_not_satisfy_target(self):
        result, api = self.run_pages([('one', [], {'data': [{'aweme_id': '123456', 'desc': 'wrong', 'video': {'duration': 1000}}], 'has_more': 1, 'cursor': 20}), ('two', [], {'data': [{'aweme_id': '999999', 'desc': 'test', 'video': {'duration': 1000}}], 'has_more': 0, 'cursor': 40})], exactKeyword=True)
        self.assertEqual([row['aweme_id'] for row in result['data']], ['999999'])
        self.assertEqual(api.call_count, 2)

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
