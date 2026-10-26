"""SSRF protection: only http(s), no internal hosts, and every redirect target is checked again."""

import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import requests

from errors import CheckError

MAX_REDIRECTS = 5
REDIRECT_CODES = (301, 302, 303, 307, 308)
INTERNAL_SUFFIXES = (".local", ".internal", ".localhost")


def resolve_ips(host: str) -> list[str]:
    """All addresses of a host. Empty if it does not resolve (the fetch then fails with a normal connection error)."""
    try:
        return [str(info[4][0]) for info in socket.getaddrinfo(host, None)]
    except socket.gaierror:
        return []


def is_public(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip.split("%")[0]).is_global
    except ValueError:
        return False


def ensure_public_url(url: str) -> None:
    """Raises CheckError('blocked_url') unless the URL is http(s) and points to a public address."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        raise CheckError(f"Only http and https URLs are allowed: {url}", "blocked_url")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise CheckError(f"URL without host: {url}", "blocked_url")
    if host == "localhost" or host.endswith(INTERNAL_SUFFIXES):
        raise CheckError(f"Internal host is not allowed: {host}", "blocked_url")
    literal = host.strip("[]")
    ips = [literal] if _is_ip(literal) else resolve_ips(host)
    if not all(is_public(ip) for ip in ips):
        raise CheckError(f"Internal address is not allowed: {host}", "blocked_url")


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def safe_get(url: str, headers: dict[str, str], timeout: float) -> requests.Response:
    """requests.get that validates the URL and every redirect target before following it."""
    jar = requests.cookies.RequestsCookieJar()  # Some sites (e.g. ai.google.dev) redirect forever without cookies.
    for _ in range(MAX_REDIRECTS + 1):
        ensure_public_url(url)
        resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=False, cookies=jar)
        jar.update(getattr(resp, "cookies", None) or {})
        location = resp.headers.get("Location")
        if resp.status_code not in REDIRECT_CODES or not location:
            return resp
        url = urljoin(url, location)
    raise CheckError(f"Too many redirects (more than {MAX_REDIRECTS})", "redirects")
