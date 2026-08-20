from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.models.enums import DocumentType
from app.services.drive_sync_service import (
    _download_content,
    _list_folder_files,
    _parse_drive_timestamp,
    _resolve_doc_type,
)


def test_resolve_doc_type_maps_google_native_formats_to_export_mime():
    doc_type, export_mime = _resolve_doc_type(
        "Guia do Colaborador", "application/vnd.google-apps.presentation"
    )
    assert doc_type == DocumentType.PPTX
    assert export_mime == "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def test_resolve_doc_type_uses_file_extension_for_binary_uploads():
    doc_type, export_mime = _resolve_doc_type("politica-ferias.pdf", "application/pdf")
    assert doc_type == DocumentType.PDF
    assert export_mime is None


def test_resolve_doc_type_returns_none_for_unsupported_extension():
    assert _resolve_doc_type("logo.png", "image/png") is None


def test_resolve_doc_type_returns_none_when_extensionless_and_not_native():
    assert _resolve_doc_type("README", "application/octet-stream") is None


def test_parse_drive_timestamp_handles_zulu_suffix():
    parsed = _parse_drive_timestamp("2026-08-20T14:30:00.000Z")
    assert parsed == datetime(2026, 8, 20, 14, 30, tzinfo=timezone.utc)


def test_list_folder_files_follows_pagination():
    drive = MagicMock()
    first_page = {"files": [{"id": "1", "name": "a.pdf"}], "nextPageToken": "page-2"}
    second_page = {"files": [{"id": "2", "name": "b.pdf"}]}
    drive.files.return_value.list.return_value.execute.side_effect = [first_page, second_page]

    files = _list_folder_files(drive, "folder-id")

    assert [f["id"] for f in files] == ["1", "2"]
    assert drive.files.return_value.list.call_count == 2


def test_download_content_uses_export_media_when_export_mime_given():
    drive = MagicMock()
    drive.files.return_value.export_media.return_value.execute.return_value = b"exported"

    content = _download_content(drive, "file-id", "application/pdf")

    assert content == b"exported"
    drive.files.return_value.export_media.assert_called_once_with(fileId="file-id", mimeType="application/pdf")
    drive.files.return_value.get_media.assert_not_called()


def test_download_content_uses_get_media_when_no_export_mime():
    drive = MagicMock()
    drive.files.return_value.get_media.return_value.execute.return_value = b"raw-bytes"

    content = _download_content(drive, "file-id", None)

    assert content == b"raw-bytes"
    drive.files.return_value.get_media.assert_called_once_with(fileId="file-id")
    drive.files.return_value.export_media.assert_not_called()
