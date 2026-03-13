const assert = require("node:assert/strict");
const {
    normalizeUrl,
    isLikelyFeedUrl,
    parsePublishedTimestamp,
    sanitizePlainText,
    safeExternalUrl,
} = require("../feed-utils.js");

function run() {
    assert.equal(normalizeUrl("example.com/rss"), "https://example.com/rss");
    assert.equal(normalizeUrl("https://site.com/feed.xml"), "https://site.com/feed.xml");
    assert.equal(normalizeUrl("javascript:alert(1)"), "");

    assert.equal(isLikelyFeedUrl("https://site.com/rss"), true);
    assert.equal(isLikelyFeedUrl("https://site.com/news"), false);

    const ts = parsePublishedTimestamp("2026-01-01T12:00:00Z");
    assert.equal(typeof ts, "number");
    assert.equal(ts > 0, true);
    assert.equal(parsePublishedTimestamp("not-a-date"), 0);

    assert.equal(sanitizePlainText("   Hola\n\tMundo   "), "Hola Mundo");
    assert.equal(sanitizePlainText("", "Fallback"), "Fallback");

    assert.equal(safeExternalUrl("https://example.com/path?x=1"), "https://example.com/path?x=1");
    assert.equal(safeExternalUrl("javascript:alert(1)"), "");

    console.log("feed-utils tests: OK");
}

run();
