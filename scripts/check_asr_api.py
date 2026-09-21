"""Check the optional faster-whisper API without loading or downloading weights."""

from inspect import signature

from faster_whisper import WhisperModel


def main() -> None:
    constructor = signature(WhisperModel.__init__).parameters
    transcribe = signature(WhisperModel.transcribe).parameters
    if "local_files_only" not in constructor or "word_timestamps" not in transcribe:
        raise SystemExit(
            "installed faster-whisper lacks the required local word-timing API"
        )
    print("faster-whisper local model and word-timing API available")


if __name__ == "__main__":
    main()
