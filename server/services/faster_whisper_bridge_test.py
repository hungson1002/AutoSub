import unittest
from faster_whisper_bridge import regroup_segment


class RegroupTests(unittest.TestCase):
    def test_split_keeps_real_times_words_and_confidence(self):
        words = [{'word': ' Xin', 'start': 2., 'end': 2.3, 'probability': .9},
                 {'word': ' chào.', 'start': 2.4, 'end': 2.8, 'probability': .8},
                 {'word': ' Tạm', 'start': 4.5, 'end': 4.8, 'probability': .95},
                 {'word': ' biệt.', 'start': 4.9, 'end': 5.2, 'probability': .94}]
        segment = {'start': 2., 'end': 5.2, 'text': ' Xin chào. Tạm biệt.', 'words': words,
                   'avg_logprob': -.2, 'no_speech_prob': .01, 'compression_ratio': 1.}
        grouped = regroup_segment(segment)
        self.assertEqual(len(grouped), 2)
        self.assertEqual([{key: w[key] for key in ['word', 'start', 'end', 'probability']}
                          for s in grouped for w in s['words']], words)
        self.assertEqual(grouped[0]['end'], 2.8)
        self.assertEqual(grouped[1]['start'], 4.5)
        self.assertTrue(all(s['avg_logprob'] == -.2 for s in grouped))


if __name__ == '__main__':
    unittest.main()
