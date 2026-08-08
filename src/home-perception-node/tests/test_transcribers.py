from __future__ import annotations

import unittest

from tarevis_home_node.audio.transcribers import extract_text


class TranscriberUtilityTests(unittest.TestCase):
    def test_extract_text_from_funasr_shape(self) -> None:
        self.assertEqual(extract_text([{"text": " 我没事 "}]), "我没事")


if __name__ == "__main__":
    unittest.main()
