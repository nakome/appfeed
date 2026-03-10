<?php
// proxy.php
header('Content-Type: application/xml; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // Permite que tu app acceda al proxy

if (isset($_GET['url'])) {
    $url = $_GET['url'];
    
    // Configurar una cabecera de User-Agent para engañar a sitios como Cloudflare/WordPress
    $options = [
        'http' => [
            'header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36\r\n"
        ]
    ];
    
    $context = stream_context_create($options);
    $content = file_get_contents($url, false, $context);
    
    if ($content !== false) {
        echo $content;
    } else {
        http_response_code(500);
        echo "<error>No se pudo cargar el feed</error>";
    }
}
?>