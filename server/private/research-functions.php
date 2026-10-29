<?php
declare(strict_types=1);

final class BriHttpException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function bri_uuid(mixed $value, string $field): string
{
    if (!is_string($value) || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value)) {
        throw new InvalidArgumentException("{$field} must be a UUID.");
    }

    return strtolower($value);
}

function bri_outcome_category(int $outcome): int
{
    if ($outcome < 0 || $outcome > 36) {
        throw new InvalidArgumentException('Roulette outcome must be an integer from 0 to 36.');
    }

    return $outcome === 0 ? 12 : intdiv($outcome - 1, 3);
}

function bri_validate_probabilities(mixed $probabilities): array
{
    if (!is_array($probabilities) || !array_is_list($probabilities) || count($probabilities) !== 13) {
        throw new InvalidArgumentException('A forecast must include twelve street probabilities and one zero probability.');
    }

    $normalised = [];
    $sum = 0.0;
    foreach ($probabilities as $probability) {
        if (!is_int($probability) && !is_float($probability) && !(is_string($probability) && is_numeric($probability))) {
            throw new InvalidArgumentException('Forecast probabilities must be numeric.');
        }
        $probability = (float) $probability;
        if (!is_finite($probability) || $probability < 0.0 || $probability > 1.0) {
            throw new InvalidArgumentException('Forecast probabilities must be between zero and one.');
        }
        $normalised[] = $probability;
        $sum += $probability;
    }

    if (abs($sum - 1.0) > 0.000001) {
        throw new InvalidArgumentException('Forecast probabilities must sum to one.');
    }

    return $normalised;
}

function bri_brier_score(array $probabilities, int $actualCategory): float
{
    $probabilities = bri_validate_probabilities($probabilities);
    if ($actualCategory < 0 || $actualCategory > 12) {
        throw new InvalidArgumentException('Actual category must be a street index or the zero category.');
    }

    $score = 0.0;
    foreach ($probabilities as $category => $probability) {
        $observed = $category === $actualCategory ? 1.0 : 0.0;
        $score += ($probability - $observed) ** 2;
    }

    return $score;
}

function bri_validate_model_state(mixed $state): array
{
    if (!is_array($state) || ($state['version'] ?? null) !== 1 || !is_array($state['tracker'] ?? null)) {
        throw new InvalidArgumentException('Unsupported BRI model state.');
    }
    $tracker = $state['tracker'];
    $count = $tracker['totalObservations'] ?? null;
    $recent = $tracker['recentOutcomes'] ?? null;
    if (!is_int($count) || $count < 0 || !is_array($recent) || !array_is_list($recent) || count($recent) > 100 || count($recent) > $count) {
        throw new InvalidArgumentException('Invalid BRI tracker checkpoint.');
    }
    foreach ($recent as $outcome) {
        if (!is_int($outcome) || $outcome < 0 || $outcome > 36) throw new InvalidArgumentException('Invalid outcome in BRI checkpoint.');
    }
    foreach (['appearances', 'currentAbsence', 'longestAbsence', 'intervalTotals', 'intervalCounts', 'lastSeenAge', 'consecutive'] as $field) {
        if (!is_array($tracker[$field] ?? null) || !array_is_list($tracker[$field]) || count($tracker[$field]) !== 12) {
            throw new InvalidArgumentException("Invalid {$field} in BRI checkpoint.");
        }
    }
    if (!is_array($state['exponentialWeights'] ?? null) || !array_is_list($state['exponentialWeights']) || count($state['exponentialWeights']) !== 13) {
        throw new InvalidArgumentException('Invalid exponential model checkpoint.');
    }
    $performance = $state['predictionPerformance'] ?? null;
    foreach (['appearances', 'currentAbsence', 'longestAbsence', 'intervalTotals', 'intervalCounts', 'consecutive'] as $field) {
        foreach ($tracker[$field] as $value) {
            if (!is_int($value) || $value < 0) throw new InvalidArgumentException("Invalid values in {$field}.");
        }
    }
    foreach ($tracker['lastSeenAge'] as $age) {
        if ($age !== null && (!is_int($age) || $age < 0 || $age >= $count)) throw new InvalidArgumentException('Invalid last-seen age in BRI checkpoint.');
    }
    foreach ($tracker['appearances'] as $street => $appearances) {
        if ($tracker['intervalCounts'][$street] !== max(0, $appearances - 1) || $tracker['longestAbsence'][$street] < $tracker['currentAbsence'][$street] || $tracker['consecutive'][$street] > $appearances) {
            throw new InvalidArgumentException('Inconsistent street statistics in BRI checkpoint.');
        }
        if (($appearances === 0) !== ($tracker['lastSeenAge'][$street] === null)) throw new InvalidArgumentException('Last-seen state does not match street appearances.');
    }
    if (array_sum($tracker['appearances']) > $count || array_sum($tracker['consecutive']) > $count || array_sum($tracker['currentAbsence']) > 12 * $count) {
        throw new InvalidArgumentException('Street counts exceed the observation total.');
    }
    $previousStreet = $tracker['previousStreet'] ?? null;
    if ($previousStreet !== null && (!is_int($previousStreet) || $previousStreet < 0 || $previousStreet > 11)) throw new InvalidArgumentException('Invalid previous street in BRI checkpoint.');
    if (count($recent) !== min($count, 100)) throw new InvalidArgumentException('Rolling outcome count does not match the checkpoint total.');
    if ($count > 0 && $previousStreet !== ($recent[array_key_last($recent)] === 0 ? null : intdiv($recent[array_key_last($recent)] - 1, 3))) throw new InvalidArgumentException('Previous street does not match the latest outcome.');
    foreach ($state['exponentialWeights'] as $weight) {
        if (!is_numeric($weight) || !is_finite((float) $weight) || (float) $weight < 0) throw new InvalidArgumentException('Invalid exponential model weight.');
    }
    if (!is_array($performance) || !is_int($performance['total'] ?? null) || !is_int($performance['successful'] ?? null) || $performance['successful'] < 0 || $performance['successful'] > $performance['total']) {
        throw new InvalidArgumentException('Invalid prediction performance checkpoint.');
    }
    if (!is_array($state['modelPerformance'] ?? null) || !array_is_list($state['modelPerformance'])) throw new InvalidArgumentException('Invalid model performance state.');
    foreach ($state['modelPerformance'] as $model) {
        if (!is_array($model) || !is_string($model['modelVersion'] ?? null) || !preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/i', $model['modelVersion']) || !is_int($model['total'] ?? null) || $model['total'] < 0 || $model['total'] > $performance['total'] || !is_numeric($model['meanBrier'] ?? null) || !is_finite((float) $model['meanBrier']) || (float) $model['meanBrier'] < 0 || (float) $model['meanBrier'] > 2) {
            throw new InvalidArgumentException('Invalid model performance entry.');
        }
    }
    $encoded = json_encode($state, JSON_THROW_ON_ERROR);
    if (strlen($encoded) > 64000) throw new InvalidArgumentException('BRI model checkpoint is too large.');

    return $state;
}

function bri_validate_statistical_assessment(mixed $assessment): ?array
{
    if ($assessment === null) return null;
    if (!is_array($assessment) || ($assessment['classification'] ?? null) !== 'statistical_anomaly_candidate' || ($assessment['verifiedError'] ?? null) !== false) {
        throw new InvalidArgumentException('Integrity reports may record statistical candidates only; they cannot verify an entry error.');
    }
    $chiSquare = $assessment['chiSquare'] ?? null;
    $threshold = $assessment['threshold'] ?? null;
    $baseline = $assessment['baselineObservations'] ?? null;
    $recent = $assessment['recentObservations'] ?? null;
    if (!is_numeric($chiSquare) || !is_finite((float) $chiSquare) || $chiSquare < 0 || !is_numeric($threshold) || !is_finite((float) $threshold) || $threshold <= 0 || !is_int($baseline) || $baseline < 1 || !is_int($recent) || $recent < 1) {
        throw new InvalidArgumentException('Statistical integrity report has invalid measurements.');
    }
    $leading = $assessment['leadingContributions'] ?? null;
    if (!is_array($leading) || count($leading) > 3) throw new InvalidArgumentException('Statistical integrity report has invalid category details.');
    $normalised = [
        'classification' => 'statistical_anomaly_candidate',
        'verifiedError' => false,
        'chiSquare' => (float) $chiSquare,
        'threshold' => (float) $threshold,
        'baselineObservations' => $baseline,
        'recentObservations' => $recent,
        'leadingContributions' => $leading,
        'explanation' => 'Statistical anomaly candidates are not verified entry errors.',
    ];
    if (strlen(json_encode($normalised, JSON_THROW_ON_ERROR)) > 8000) throw new InvalidArgumentException('Integrity report is too large.');
    return $normalised;
}

function bri_validate_challenge_report(array $payload): array
{
    $runId = bri_uuid($payload['run_id'] ?? null, 'run_id');
    $seed = $payload['seed'] ?? null;
    if (!is_string($seed) || $seed === '' || strlen($seed) > 128) throw new InvalidArgumentException('Challenge seed must contain 1 to 128 characters.');
    if (($payload['benchmark_version'] ?? null) !== 'False Entry Challenge') throw new InvalidArgumentException('Unsupported integrity benchmark.');
    $metrics = $payload['metrics'] ?? null;
    $cases = $payload['cases'] ?? null;
    $expectedNames = ['invalid-outcome', 'nonnumeric-outcome', 'duplicate-event-id', 'conflicting-spin', 'missing-sequence', 'out-of-order', 'wrong-table', 'replayed-record', 'incorrect-correction'];
    if (!is_array($metrics) || !is_array($cases) || !array_is_list($cases) || count($cases) !== count($expectedNames)) throw new InvalidArgumentException('Challenge results must include every verifiable case.');
    $controlRecords = $payload['control_records_checked'] ?? null;
    $controlFalsePositives = $payload['control_false_positive_count'] ?? null;
    if (!is_int($controlRecords) || $controlRecords < 1 || !is_int($controlFalsePositives) || $controlFalsePositives < 0 || $controlFalsePositives > $controlRecords) throw new InvalidArgumentException('Challenge clean-control counts are invalid.');
    $caseNames = [];
    $detectedCount = 0;
    $latencies = $metrics['detectionLatency'] ?? null;
    if (!is_array($latencies) || count($latencies) !== count($expectedNames)) throw new InvalidArgumentException('Challenge detection latency is incomplete.');
    foreach ($cases as $case) {
        if (!is_array($case) || !is_string($case['name'] ?? null) || !in_array($case['name'], $expectedNames, true) || !is_bool($case['detected'] ?? null)) throw new InvalidArgumentException('Invalid challenge case result.');
        if (isset($caseNames[$case['name']])) throw new InvalidArgumentException('Duplicate challenge case result.');
        $caseNames[$case['name']] = true;
        $detectedCount += (int) $case['detected'];
    }
    sort($expectedNames);
    $actualNames = array_keys($caseNames);
    sort($actualNames);
    if ($expectedNames !== $actualNames) throw new InvalidArgumentException('Challenge case set is incomplete.');

    foreach (['truePositives', 'falsePositives', 'trueNegatives', 'falseNegatives'] as $field) {
        if (!is_int($metrics[$field] ?? null) || $metrics[$field] < 0) throw new InvalidArgumentException("Invalid {$field} metric.");
    }
    foreach ($cases as $case) {
        $latency = $latencies[$case['name']] ?? null;
        if ($case['detected'] ? (!is_int($latency) || $latency < 1) : $latency !== null) throw new InvalidArgumentException('Challenge latency must match each case detection result.');
    }
    if ($metrics['truePositives'] !== $detectedCount || $metrics['falseNegatives'] !== count($cases) - $detectedCount || $metrics['falsePositives'] !== $controlFalsePositives || $metrics['trueNegatives'] !== $controlRecords - $controlFalsePositives) {
        throw new InvalidArgumentException('Challenge confusion counts do not match its case results and controls.');
    }
    $precision = $metrics['truePositives'] / max(1, $metrics['truePositives'] + $metrics['falsePositives']);
    $recall = $metrics['truePositives'] / max(1, $metrics['truePositives'] + $metrics['falseNegatives']);
    $falsePositiveRate = $metrics['falsePositives'] / max(1, $metrics['falsePositives'] + $metrics['trueNegatives']);
    foreach (['precision' => $precision, 'recall' => $recall, 'falsePositiveRate' => $falsePositiveRate] as $field => $expected) {
        if (!is_numeric($metrics[$field] ?? null) || abs((float) $metrics[$field] - $expected) > 0.000001) throw new InvalidArgumentException("Inconsistent {$field} metric.");
    }
    $undetectable = $payload['undetectable_cases'] ?? null;
    $expectedUndetectable = ['valid number substitution without independent source data', 'swapped valid outcomes without contradictory sequence metadata'];
    if (($payload['legitimate_repeated_outcomes_accepted'] ?? null) !== true || ($payload['valid_substitution_flagged'] ?? null) !== false || !is_array($undetectable) || !array_is_list($undetectable) || count($undetectable) !== count($expectedUndetectable)) {
        throw new InvalidArgumentException('Challenge controls must preserve legitimate repeats and unobservable valid substitutions.');
    }
    $undetectableNames = [];
    foreach ($undetectable as $case) {
        if (!is_array($case) || !is_string($case['name'] ?? null) || ($case['flagged'] ?? null) !== false) throw new InvalidArgumentException('Unobservable valid cases must not be flagged.');
        $undetectableNames[] = $case['name'];
    }
    sort($expectedUndetectable);
    sort($undetectableNames);
    if ($expectedUndetectable !== $undetectableNames) throw new InvalidArgumentException('Challenge unobservable cases are incomplete.');

    return [
        'run_id' => $runId,
        'benchmark_name' => 'False Entry Challenge',
        'benchmark_version' => '1',
        'seed' => $seed,
        'metrics' => $metrics,
        'cases' => $cases,
        'control_records_checked' => $controlRecords,
        'control_false_positive_count' => $controlFalsePositives,
        'controls' => [
            'legitimate_repeated_outcomes_accepted' => true,
            'valid_substitution_flagged' => false,
            'undetectable_cases' => $undetectable,
        ],
    ];
}

function bri_validate_observation_batch(array $payload): array
{
    $tableId = bri_uuid($payload['table_id'] ?? null, 'table_id');
    $sessionId = bri_uuid($payload['session_id'] ?? null, 'session_id');
    $tableName = trim((string) ($payload['table_name'] ?? ''));
    if ($tableName === '' || strlen($tableName) > 120) {
        throw new InvalidArgumentException('table_name must contain 1 to 120 characters.');
    }

    $tableTypes = ['physical', 'electronic', 'online_rng', 'simulated', 'imported'];
    $tableType = $payload['table_type'] ?? null;
    if (!is_string($tableType) || !in_array($tableType, $tableTypes, true)) {
        throw new InvalidArgumentException('Unsupported table_type.');
    }

    $sources = ['manual', 'physical_live', 'electronic_live', 'online_rng', 'simulation', 'imported'];
    $source = $payload['source'] ?? null;
    if (!is_string($source) || !in_array($source, $sources, true)) {
        throw new InvalidArgumentException('Unsupported observation source.');
    }

    $origin = $payload['data_origin'] ?? null;
    if (!is_string($origin) || !in_array($origin, ['observed', 'synthetic'], true)) {
        throw new InvalidArgumentException('data_origin must be observed or synthetic.');
    }
    if (($source === 'simulation' && $origin !== 'synthetic') || (in_array($source, ['physical_live', 'electronic_live', 'online_rng'], true) && $origin !== 'observed')) {
        throw new InvalidArgumentException('data_origin conflicts with the declared source.');
    }

    $shareConsent = $payload['share_consent'] ?? false;
    if (!is_bool($shareConsent)) {
        throw new InvalidArgumentException('share_consent must be a boolean.');
    }

    $outcomes = $payload['outcomes'] ?? null;
    if (!is_array($outcomes) || count($outcomes) < 1 || count($outcomes) > 500) {
        throw new InvalidArgumentException('A batch must contain between 1 and 500 outcomes.');
    }

    $normalisedOutcomes = [];
    $seenSpins = [];
    $seenEvents = [];
    $previousSpin = 0;
    foreach ($outcomes as $entry) {
        if (!is_array($entry)) {
            throw new InvalidArgumentException('Each outcome must be an object.');
        }
        $eventId = bri_uuid($entry['event_id'] ?? null, 'event_id');
        $spinNumber = $entry['spin_number'] ?? null;
        $outcome = $entry['outcome'] ?? null;
        $integrityAssessment = bri_validate_statistical_assessment($entry['integrity_assessment'] ?? null);
        if (!is_int($spinNumber) || $spinNumber < 1 || $spinNumber <= $previousSpin) {
            throw new InvalidArgumentException('spin_number values must be positive, strictly ascending integers.');
        }
        if (!is_int($outcome) || $outcome < 0 || $outcome > 36) {
            throw new InvalidArgumentException('outcome values must be integers from 0 to 36.');
        }
        if (isset($seenSpins[$spinNumber]) || isset($seenEvents[$eventId])) {
            throw new InvalidArgumentException('Duplicate spin or event identifiers are not allowed in a batch.');
        }
        $occurredAt = $entry['occurred_at'] ?? null;
        if ($occurredAt !== null) {
            if (!is_string($occurredAt) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/', $occurredAt)) {
                throw new InvalidArgumentException('occurred_at must be an ISO 8601 timestamp.');
            }
            try {
                $occurredAt = (new DateTimeImmutable($occurredAt))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
            } catch (Throwable) {
                throw new InvalidArgumentException('occurred_at must be a valid ISO 8601 timestamp.');
            }
        }
        $seenSpins[$spinNumber] = true;
        $seenEvents[$eventId] = true;
        $previousSpin = $spinNumber;
        $normalisedOutcomes[] = [
            'event_id' => $eventId,
            'spin_number' => $spinNumber,
            'outcome' => $outcome,
            'occurred_at' => $occurredAt,
            'integrity_assessment' => $integrityAssessment,
        ];
    }

    return [
        'table_id' => $tableId,
        'session_id' => $sessionId,
        'table_name' => $tableName,
        'table_type' => $tableType,
        'source' => $source,
        'data_origin' => $origin,
        'share_consent' => $shareConsent,
        'outcomes' => $normalisedOutcomes,
    ];
}