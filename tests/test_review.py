import check
import review
from store import FileStore


def setup_store(tmp_path):
    config = tmp_path / "urls.yml"
    config.write_text("defaults:\n  selector: main\nurls:\n  - url: https://example.com/\n")
    store = FileStore(tmp_path / "state", config)
    key = check.url_key("https://example.com/")
    store.set_snapshot(key, "https://example.com/", "Enable JavaScript")
    return store, key


def test_review_renders_without_changing_snapshot(tmp_path, monkeypatch):
    store, key = setup_store(tmp_path)
    jobs = []

    def fetch_all(value):
        jobs.extend(value)
        return {"https://example.com/": ("title", "Rendered content", False, {})}

    monkeypatch.setattr(review, "fetch_all", fetch_all)
    assert review.review(store, "https://example.com/", key)
    assert jobs[0][0]["js"] is True and jobs[0][0]["selector"] == "main"
    assert store.snapshot(key) == "Enable JavaScript"
    result = store.doc("review:" + key, {})
    assert result["baseline"] == "Enable JavaScript"
    assert result["rendered"] == "Rendered content"
    assert result["defaults"] == {"selector": "main"} and result["options"] == {}


def test_review_failure_and_concurrent_snapshot_change_are_reported(tmp_path, monkeypatch):
    store, key = setup_store(tmp_path)

    def changed(_):
        store.set_snapshot(key, "https://example.com/", "new baseline")
        return {"https://example.com/": ("title", "Rendered content", False, {})}

    monkeypatch.setattr(review, "fetch_all", changed)
    assert not review.review(store, "https://example.com/", key)
    assert "changed during the comparison" in store.doc("review:" + key, {})["error"]
    monkeypatch.setattr(review, "fetch_all", lambda _: {"https://example.com/": RuntimeError("Browser failed")})
    assert not review.review(store, "https://example.com/", key)
    assert store.doc("review:" + key, {})["error"] == "Browser failed"
    assert store.snapshot(key) == "new baseline"


def test_review_refuses_unconfigured_and_empty_results(tmp_path, monkeypatch):
    store, key = setup_store(tmp_path)
    assert not review.review(store, "https://other.example/", key)
    assert "not active" in store.doc("review:" + key, {})["error"]
    monkeypatch.setattr(review, "fetch_all", lambda _: {"https://example.com/": ("title", "", False, {})})
    assert not review.review(store, "https://example.com/", key)
    assert "no text" in store.doc("review:" + key, {})["error"]
