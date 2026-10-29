<?php
declare(strict_types=1);

require_once __DIR__ . '/research-functions.php';

function bri_setting(string $name): ?string
{
    $environmentValue = getenv($name);
    if ($environmentValue !== false) return $environmentValue;

    static $fileSettings = null;
    if ($fileSettings === null) {
        $file = getenv('BANKROLL_CONFIG_FILE');
        $fileSettings = is_string($file) && is_readable($file) ? require $file : [];
        if (!is_array($fileSettings)) throw new BriHttpException(500, 'BRI configuration file must return an array.');
    }

    $value = $fileSettings[$name] ?? null;
    return is_string($value) ? $value : null;
}

function bri_observed_submissions_enabled(): bool
{
    $value = strtolower(trim(bri_setting('BANKROLL_ALLOW_OBSERVED_SUBMISSIONS') ?? 'false'));
    return in_array($value, ['1', 'true', 'yes', 'on'], true);
}

function bri_require_observed_submissions_enabled(): void
{
    if (!bri_observed_submissions_enabled()) {
        throw new BriHttpException(403, 'Observed submissions are disabled until live observation safeguards are verified.');
    }
}

function bri_new_uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);

    return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20, 12));
}

function bri_respond(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function bri_run_api(callable $operation): void
{
    try {
        $operation();
    } catch (BriHttpException $exception) {
        bri_respond($exception->status, ['error' => $exception->getMessage()]);
    } catch (InvalidArgumentException $exception) {
        bri_respond(400, ['error' => $exception->getMessage()]);
    } catch (JsonException) {
        bri_respond(400, ['error' => 'Request body must be valid JSON.']);
    } catch (Throwable $exception) {
        error_log('BRI API failure: ' . $exception::class . ': ' . $exception->getMessage());
        bri_respond(500, ['error' => 'The research request could not be completed.']);
    }
}

function bri_request_json(): array
{
    $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > 1_500_000) {
        throw new BriHttpException(413, 'Request body exceeds the allowed size.');
    }
    $body = file_get_contents('php://input');
    if ($body === false || $body === '') {
        throw new BriHttpException(400, 'A JSON request body is required.');
    }
    if (strlen($body) > 1_500_000) throw new BriHttpException(413, 'Request body exceeds the allowed size.');
    $decoded = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($decoded)) {
        throw new BriHttpException(400, 'The JSON request body must be an object.');
    }

    return $decoded;
}

function bri_database(): PDO
{
    $host = bri_setting('BANKROLL_DB_HOST');
    $name = bri_setting('BANKROLL_DB_NAME');
    $user = bri_setting('BANKROLL_DB_USER');
    $password = bri_setting('BANKROLL_DB_PASSWORD');
    if (!$host || !$name || !$user || $password === null) {
        throw new BriHttpException(503, 'Research storage is not configured.');
    }

    try {
        return new PDO(
            "mysql:host={$host};dbname={$name};charset=utf8mb4",
            $user,
            $password,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ],
        );
    } catch (PDOException $exception) {
        error_log('BRI database connection failed: ' . $exception->getCode());
        throw new BriHttpException(503, 'Research storage is temporarily unavailable.');
    }
}

function bri_authenticated_player(PDO $database): array
{
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer (brp_[a-f0-9]{64})$/i', $authorization, $matches)) {
        throw new BriHttpException(401, 'A valid BRI player token is required.');
    }
    $tokenHash = hash('sha256', strtolower($matches[1]));
    $statement = $database->prepare('SELECT player_id, display_name, share_research FROM players WHERE token_hash = :token_hash AND revoked_at IS NULL');
    $statement->execute(['token_hash' => $tokenHash]);
    $player = $statement->fetch();
    if (!$player) {
        throw new BriHttpException(401, 'A valid BRI player token is required.');
    }

    return $player;
}

function bri_require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method);
        throw new BriHttpException(405, 'Method not allowed.');
    }
}