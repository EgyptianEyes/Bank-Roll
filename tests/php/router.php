<?php
declare(strict_types=1);

$requestPath = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
$publicPages = ['/faq' => 'faq.html', '/faq/' => 'faq.html', '/docs' => 'docs.html', '/docs/' => 'docs.html'];
if (isset($publicPages[$requestPath])) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(dirname(__DIR__, 2) . '/' . $publicPages[$requestPath]);
    exit;
}
$blockedPrefixes = ['/server/private', '/tests', '/docs'];
foreach ($blockedPrefixes as $prefix) {
    if ($requestPath === $prefix || str_starts_with($requestPath, $prefix . '/')) {
        http_response_code(404);
        exit;
    }
}
if (in_array($requestPath, ['/README.md', '/package.json', '/index-foundation.html'], true) || str_ends_with($requestPath, '.sql')) {
    http_response_code(404);
    exit;
}

return false;