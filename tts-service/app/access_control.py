"""Fail-closed service access and bounded per-process admission. No patient journal."""
import hmac
import os
import threading
import time
from collections import deque
from contextlib import contextmanager


class AccessError(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code


def require_service_access(authorization):
    token = os.getenv("TTS_SERVICE_ACCESS_TOKEN", "")
    if len(token) < 32:
        raise AccessError(503, "TTS_ACCESS_NOT_CONFIGURED")
    if not hmac.compare_digest(str(authorization or "").encode(), f"Bearer {token}".encode()):
        raise AccessError(401, "TTS_UNAUTHORIZED")


def limit(name, default, maximum):
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        raise AccessError(503, "TTS_LIMIT_INVALID") from None
    if not 1 <= value <= maximum:
        raise AccessError(503, "TTS_LIMIT_INVALID")
    return value


class Admission:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.active = 0
        self.attempts = deque()

    @contextmanager
    def slot(self, text, voice_id, configured_voice):
        if not text or len(text) > limit("TTS_MAX_CHARACTERS", 5000, 20000):
            raise AccessError(413, "TTS_TEXT_TOO_LARGE")
        if voice_id and voice_id != configured_voice:
            raise AccessError(400, "TTS_VOICE_OVERRIDE_FORBIDDEN")
        concurrent = limit("TTS_MAX_CONCURRENT_REQUESTS", 1, 3)
        requests = limit("TTS_MAX_REQUESTS_PER_MINUTE", 10, 120)
        characters = limit("TTS_MAX_CHARACTERS_PER_MINUTE", 20000, 200000)
        with self.lock:
            now = self.clock()
            while self.attempts and self.attempts[0][0] <= now - 60:
                self.attempts.popleft()
            if self.active >= concurrent or len(self.attempts) >= requests or sum(size for _, size in self.attempts) + len(text) > characters:
                raise AccessError(429, "TTS_LIMIT_REACHED")
            # Dispatched failures/uncertainty still count; never refund automatically.
            self.attempts.append((now, len(text)))
            self.active += 1
        try:
            yield
        finally:
            with self.lock:
                self.active -= 1


admission = Admission()
