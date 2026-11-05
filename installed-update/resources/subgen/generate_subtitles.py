import argparse
import json
import os
import sys
import time
from typing import Any


MODEL_REPOSITORIES = {
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3": "Systran/faster-whisper-large-v3",
}
MODEL_READY_MARKER = ".mla-ready.json"
REQUIRED_MODEL_FILES = ("config.json", "model.bin", "tokenizer.json")


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload), flush=True)


def emit_result(result: dict[str, Any]) -> None:
    emit({"event": "result", "result": result})


def emit_progress(progress: dict[str, Any]) -> None:
    emit({"event": "progress", "progress": progress})


def require_supported_model(model_name: str) -> str:
    repo_id = MODEL_REPOSITORIES.get(model_name)
    if not repo_id:
        raise ValueError(f"Unsupported Whisper model: {model_name}")
    return repo_id


def get_model_directory(models_root: str, model_name: str) -> str:
    return os.path.join(models_root, model_name)


def get_model_ready_marker(model_dir: str) -> str:
    return os.path.join(model_dir, MODEL_READY_MARKER)


def is_model_available(model_dir: str) -> bool:
    if not os.path.isfile(get_model_ready_marker(model_dir)):
        return False

    for required_file in REQUIRED_MODEL_FILES:
        if not os.path.isfile(os.path.join(model_dir, required_file)):
            return False

    return True


def build_availability_result(model_name: str, model_dir: str) -> dict[str, Any]:
    available = is_model_available(model_dir)
    return {
        "model": model_name,
        "available": available,
        "modelPath": model_dir if available else None,
        "message": None if available else f"{model_name} is not downloaded yet.",
    }


def build_download_result(
    model_name: str,
    model_dir: str,
    ok: bool,
    message: str,
    *,
    setup_required: bool = False,
) -> dict[str, Any]:
    available = ok and is_model_available(model_dir)
    return {
        "ok": ok,
        "model": model_name,
        "available": available,
        "modelPath": model_dir if available else None,
        "message": message,
        "setupRequired": setup_required,
    }


def setup_message(detail: str | None = None) -> str:
    suffix = f" {detail}" if detail else ""
    return (
        "Sub-Gen needs a working Python install plus faster-whisper and huggingface_hub. "
        "Install the packages from resources/subgen/requirements.txt, then try again."
        f"{suffix}"
    )


def format_timestamp(seconds: float) -> str:
    total_millis = max(0, int(seconds * 1000))
    hours = total_millis // 3_600_000
    minutes = (total_millis % 3_600_000) // 60_000
    secs = (total_millis % 60_000) // 1000
    millis = total_millis % 1000
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def write_srt(segments: Any, output_path: str) -> None:
    with open(output_path, "w", encoding="utf-8") as handle:
        for index, segment in enumerate(segments, start=1):
            start = format_timestamp(segment.start)
            end = format_timestamp(segment.end)
            text = (segment.text or "").strip()
            handle.write(f"{index}\n{start} --> {end}\n{text}\n\n")


class DownloadReporter:
    def __init__(self, model_name: str, total_files: int, total_bytes: int | None) -> None:
        self.model_name = model_name
        self.total_files = total_files
        self.total_bytes = total_bytes if total_bytes and total_bytes > 0 else None
        self.completed_files = 0
        self.completed_bytes = 0
        self._last_emit = 0.0

    def emit(
        self,
        *,
        stage: str,
        message: str,
        file_name: str | None = None,
        current_bytes: int = 0,
        current_total: int | None = None,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        if not force and stage == "downloading" and now - self._last_emit < 0.1:
            return

        downloaded_bytes = self.completed_bytes + max(current_bytes, 0)
        percent = self._compute_percent(current_bytes=current_bytes, current_total=current_total)
        emit_progress(
            {
                "model": self.model_name,
                "stage": stage,
                "fileName": file_name,
                "filesCompleted": self.completed_files,
                "totalFiles": self.total_files,
                "downloadedBytes": downloaded_bytes,
                "totalBytes": self.total_bytes,
                "percent": percent,
                "message": message,
            }
        )
        self._last_emit = now

    def finish_file(self, file_size: int | None) -> None:
        self.completed_files += 1
        if file_size and file_size > 0:
            self.completed_bytes += file_size

    def _compute_percent(self, *, current_bytes: int, current_total: int | None) -> int:
        if self.total_bytes:
            downloaded_bytes = self.completed_bytes + max(current_bytes, 0)
            return max(0, min(100, round((downloaded_bytes / self.total_bytes) * 100)))

        if self.total_files <= 0:
            return 0

        current_fraction = 0.0
        if current_total and current_total > 0:
            current_fraction = max(0.0, min(1.0, current_bytes / current_total))

        return max(
            0,
            min(100, round(((self.completed_files + current_fraction) / self.total_files) * 100)),
        )


def handle_check_model(args: argparse.Namespace) -> int:
    require_supported_model(args.model)
    model_dir = get_model_directory(args.models_root, args.model)
    emit_result(build_availability_result(args.model, model_dir))
    return 0


def handle_download_model(args: argparse.Namespace) -> int:
    repo_id = require_supported_model(args.model)
    model_dir = get_model_directory(args.models_root, args.model)

    if is_model_available(model_dir):
        emit_progress(
            {
                "model": args.model,
                "stage": "completed",
                "fileName": None,
                "filesCompleted": 0,
                "totalFiles": 0,
                "downloadedBytes": 0,
                "totalBytes": None,
                "percent": 100,
                "message": f"{args.model} is already downloaded.",
            }
        )
        emit_result(
            build_download_result(
                args.model,
                model_dir,
                True,
                f"{args.model} is ready for subtitle generation.",
            )
        )
        return 0

    try:
        from huggingface_hub import HfApi, hf_hub_download
        from tqdm.auto import tqdm
    except ImportError as exc:
        message = setup_message(str(exc))
        emit_progress(
            {
                "model": args.model,
                "stage": "error",
                "fileName": None,
                "filesCompleted": 0,
                "totalFiles": 0,
                "downloadedBytes": 0,
                "totalBytes": None,
                "percent": 0,
                "message": message,
            }
        )
        emit_result(
            build_download_result(
                args.model,
                model_dir,
                False,
                message,
                setup_required=True,
            )
        )
        return 1

    api = HfApi()
    os.makedirs(model_dir, exist_ok=True)

    try:
        info = api.model_info(repo_id, files_metadata=True)
        repo_files: list[dict[str, Any]] = []
        for sibling in info.siblings or []:
            file_name = getattr(sibling, "rfilename", None)
            if not file_name or file_name.startswith(".") or file_name.upper() == "README.MD":
                continue
            file_size = getattr(sibling, "size", None)
            repo_files.append(
                {
                    "name": file_name,
                    "size": int(file_size) if isinstance(file_size, (int, float)) else None,
                }
            )

        repo_files.sort(key=lambda item: (0 if item["name"] == "model.bin" else 1, item["name"]))
        total_bytes = sum(
            item["size"] for item in repo_files if isinstance(item.get("size"), int) and item["size"] > 0
        )
        reporter = DownloadReporter(args.model, len(repo_files), total_bytes if total_bytes > 0 else None)
        reporter.emit(
            stage="starting",
            message=f"Preparing to download {args.model}.",
            force=True,
        )

        class DownloadProgressBar(tqdm):
            reporter: DownloadReporter | None = None
            file_name: str | None = None

            def update(self, n: int = 1) -> Any:
                result = super().update(n)
                if self.reporter is not None:
                    total = int(self.total) if isinstance(self.total, (int, float)) else None
                    self.reporter.emit(
                        stage="downloading",
                        message=f"Downloading {self.file_name}",
                        file_name=self.file_name,
                        current_bytes=int(self.n),
                        current_total=total,
                    )
                return result

        for file_entry in repo_files:
            progress_tqdm = type("ProgressTqdm", (DownloadProgressBar,), {})
            progress_tqdm.reporter = reporter
            progress_tqdm.file_name = file_entry["name"]

            local_file = hf_hub_download(
                repo_id=repo_id,
                filename=file_entry["name"],
                local_dir=model_dir,
                force_download=False,
                tqdm_class=progress_tqdm,
            )

            final_file_size = file_entry["size"]
            if final_file_size is None and os.path.isfile(local_file):
                final_file_size = os.path.getsize(local_file)

            reporter.emit(
                stage="downloading",
                message=f"Downloaded {file_entry['name']}",
                file_name=file_entry["name"],
                current_bytes=int(final_file_size or 0),
                current_total=int(final_file_size or 0) if final_file_size else None,
                force=True,
            )
            reporter.finish_file(int(final_file_size) if final_file_size else None)

        with open(get_model_ready_marker(model_dir), "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "model": args.model,
                    "repoId": repo_id,
                    "downloadedAt": int(time.time()),
                    "fileCount": len(repo_files),
                },
                handle,
            )

        reporter.emit(
            stage="completed",
            message=f"{args.model} download completed.",
            force=True,
        )
        emit_result(
            build_download_result(
                args.model,
                model_dir,
                True,
                f"{args.model} is ready for subtitle generation.",
            )
        )
        return 0
    except Exception as exc:  # pragma: no cover - depends on network/runtime
        try:
            os.remove(get_model_ready_marker(model_dir))
        except OSError:
            pass

        message = f"Failed to download {args.model}: {exc}"
        emit_progress(
            {
                "model": args.model,
                "stage": "error",
                "fileName": None,
                "filesCompleted": 0,
                "totalFiles": 0,
                "downloadedBytes": 0,
                "totalBytes": None,
                "percent": 0,
                "message": message,
            }
        )
        emit_result(
            build_download_result(
                args.model,
                model_dir,
                False,
                message,
            )
        )
        return 1


def handle_generate(args: argparse.Namespace) -> int:
    require_supported_model(args.model)
    model_dir = get_model_directory(args.models_root, args.model)
    if not is_model_available(model_dir):
        print(
            "Selected Whisper model is not downloaded yet. Select the model in Sub-Gen and approve the download first.",
            file=sys.stderr,
        )
        return 1

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(setup_message(str(exc)), file=sys.stderr)
        return 1

    device = "cpu"
    compute_type = "int8"
    model = WhisperModel(model_dir, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        args.input,
        language=args.language,
        task="transcribe",
        vad_filter=True,
        beam_size=5,
    )
    segment_list = list(segments)
    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    write_srt(segment_list, args.output)
    print(json.dumps({"output": args.output, "detected_language": getattr(info, "language", None)}))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    check_parser = subparsers.add_parser("check-model")
    check_parser.add_argument("--model", required=True)
    check_parser.add_argument("--models-root", required=True)

    download_parser = subparsers.add_parser("download-model")
    download_parser.add_argument("--model", required=True)
    download_parser.add_argument("--models-root", required=True)

    generate_parser = subparsers.add_parser("generate")
    generate_parser.add_argument("--input", required=True)
    generate_parser.add_argument("--output", required=True)
    generate_parser.add_argument("--model", required=True)
    generate_parser.add_argument("--models-root", required=True)
    generate_parser.add_argument("--language", default=None)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "check-model":
        return handle_check_model(args)
    if args.command == "download-model":
        return handle_download_model(args)
    if args.command == "generate":
        return handle_generate(args)

    parser.error(f"Unsupported command: {args.command}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
