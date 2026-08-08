from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path

from audio_test_utils import write_silence_wav, write_tone_wav
from tarevis_home_node.audio import AudioEventPipeline, AudioPipelineConfig, MockTranscriber
from tarevis_home_node.cli import run
from tarevis_home_node.contracts import SensingEvent


class AudioPipelineTests(unittest.TestCase):
    def test_help_transcription_produces_transcript_and_keyword_event(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "tone.wav"
            write_tone_wav(path)
            pipeline = AudioEventPipeline(
                MockTranscriber("救命，快来帮帮我"),
                AudioPipelineConfig(device_id="pc-test"),
            )

            events = pipeline.process_wav(path)

        self.assertEqual([event.type for event in events], [
            "speech_transcribed",
            "help_keyword_detected",
        ])
        self.assertEqual(events[1].payload["parent_event_id"], events[0].event_id)

    def test_quiet_audio_is_filtered_before_transcription(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "silence.wav"
            write_silence_wav(path)
            pipeline = AudioEventPipeline(
                MockTranscriber("救命"),
                AudioPipelineConfig(device_id="pc-test"),
            )

            events = pipeline.process_wav(path)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].type, "audio_filtered")
        self.assertEqual(events[0].payload["reason"], "too_quiet")

    def test_cli_audio_file_emits_json_events(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "tone.wav"
            write_tone_wav(path)
            output = io.StringIO()

            result = run(
                [
                    "audio-file",
                    str(path),
                    "--transcriber",
                    "mock",
                    "--mock-text",
                    "我没事",
                ],
                stdout=output,
            )
            events = [SensingEvent.from_json(line) for line in output.getvalue().splitlines()]

        self.assertEqual(result, 0)
        self.assertEqual([event.type for event in events], [
            "speech_transcribed",
            "user_acknowledged",
        ])


if __name__ == "__main__":
    unittest.main()
