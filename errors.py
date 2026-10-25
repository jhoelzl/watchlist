import requests


class CheckError(RuntimeError):
    """Fetch or check error with a stable code used to select a hint (HINTS)."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def status_code_name(status: int) -> str:
    return "http_5xx" if status >= 500 else f"http_{status}"


def error_code(ex: BaseException) -> str:
    """Stable error code for an exception, or empty if unknown."""
    if isinstance(ex, CheckError):
        return ex.code
    if isinstance(ex, requests.HTTPError) and ex.response is not None:
        return status_code_name(ex.response.status_code)
    if isinstance(ex, requests.Timeout):
        return "timeout"
    if isinstance(ex, requests.ConnectionError):
        return "connection"
    return ""
