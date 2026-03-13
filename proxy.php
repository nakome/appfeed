<?php
header('Content-Type: application/xml; charset=utf-8');
header('Access-Control-Allow-Origin: *');

function respond_error($code, $message) {
    http_response_code($code);
    echo '<error>' . htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</error>';
    exit;
}

function is_private_host($host) {
    if (!$host) return true;

    $lower = strtolower($host);
    if (in_array($lower, ['localhost', '127.0.0.1', '::1'], true)) return true;

    $records = gethostbynamel($host);
    if ($records === false || empty($records)) return true;

    foreach ($records as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return true;
        }
    }

    return false;
}

$rawUrl = isset($_GET['url']) ? trim((string)$_GET['url']) : '';
if ($rawUrl === '') {
    respond_error(400, 'Falta parametro url');
}

if (strlen($rawUrl) > 2048) {
    respond_error(400, 'URL demasiado larga');
}

$parts = parse_url($rawUrl);
if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
    respond_error(400, 'URL invalida');
}

$scheme = strtolower($parts['scheme']);
if (!in_array($scheme, ['http', 'https'], true)) {
    respond_error(400, 'Solo se permite http/https');
}

if (is_private_host($parts['host'])) {
    respond_error(403, 'Host no permitido');
}

$options = [
    'http' => [
        'method' => 'GET',
        'timeout' => 12,
        'ignore_errors' => true,
        'follow_location' => 1,
        'max_redirects' => 3,
        'header' =>
            "User-Agent: Mozilla/5.0 (compatible; AppFeedProxy/1.0)\r\n" .
            "Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5\r\n",
    ],
    'ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
    ],
];

$context = stream_context_create($options);
$content = @file_get_contents($rawUrl, false, $context);

if ($content === false || trim($content) === '') {
    respond_error(502, 'No se pudo cargar el feed');
}

echo $content;
?>