from __future__ import annotations

import unittest

from tarevis_home_node.audio.keyword_router import KeywordIntent, KeywordRouter


class KeywordRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.router = KeywordRouter()

    def test_matches_explicit_help_phrase(self) -> None:
        match = self.router.match("快来帮帮我，我摔倒了")

        self.assertIsNotNone(match)
        self.assertEqual(match.intent, KeywordIntent.HELP)  # type: ignore[union-attr]

    def test_acknowledgement_takes_priority(self) -> None:
        match = self.router.match("我没事，已经处理")

        self.assertIsNotNone(match)
        self.assertEqual(match.intent, KeywordIntent.ACKNOWLEDGE)  # type: ignore[union-attr]

    def test_ambiguous_single_sound_does_not_match(self) -> None:
        self.assertIsNone(self.router.match("啊"))
        self.assertIsNone(self.router.match("疼"))


if __name__ == "__main__":
    unittest.main()
