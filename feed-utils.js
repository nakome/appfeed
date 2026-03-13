function normalizeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        const parsed = new URL(withProtocol);
        if (!/^https?:$/i.test(parsed.protocol)) return "";
        return parsed.toString();
    } catch {
        return "";
    }
}

function isLikelyFeedUrl(url) {
    return /(?:rss|atom|feed|xml)(?:[/?#.]|$)/i.test(String(url || ""));
}

function parsePublishedTimestamp(value) {
    if (!value) return 0;
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
}

function sanitizePlainText(value, fallback = "") {
    const source = String(value || "");
    const cleaned = Array.from(source, (ch) => {
        const code = ch.charCodeAt(0);
        if (code < 32 || code === 127) return " ";
        return ch;
    }).join("");
    const text = cleaned.replace(/\s+/g, " ").trim();
    return text || fallback;
}

function safeExternalUrl(value) {
    try {
        const base = typeof window !== "undefined" && window.location?.href ? window.location.href : "https://example.com";
        const url = new URL(String(value || ""), base);
        if (!/^https?:$/i.test(url.protocol)) return "";
        return url.toString();
    } catch {
        return "";
    }
}

const FeedUtils = {
    normalizeUrl,
    isLikelyFeedUrl,
    parsePublishedTimestamp,
    sanitizePlainText,
    safeExternalUrl,
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = FeedUtils;
}

if (typeof window !== "undefined") {
    window.FeedUtils = FeedUtils;
}
