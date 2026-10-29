<?php
declare(strict_types=1);

require_once __DIR__ . '/../../server/private/research-functions.php';
require_once __DIR__ . '/../../server/private/bootstrap.php';

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function expect_invalid(callable $operation, string $message): void
{
    try {
        $operation();
    } catch (InvalidArgumentException) {
        return;
    }
    throw new RuntimeException($message);
}

$uniform = [...array_fill(0, 12, 3 / 37), 1 / 37];
putenv('BANKROLL_ALLOW_OBSERVED_SUBMISSIONS');
check(!bri_observed_submissions_enabled(), 'observed submissions must default to disabled');
try {
    bri_require_observed_submissions_enabled();
    throw new RuntimeException('observed submissions must be rejected when disabled');
} catch (BriHttpException $exception) {
    check($exception->status === 403, 'disabled observed submissions must return 403');
}
putenv('BANKROLL_ALLOW_OBSERVED_SUBMISSIONS=true');
check(bri_observed_submissions_enabled(), 'observed submission gate must read server configuration');
putenv('BANKROLL_ALLOW_OBSERVED_SUBMISSIONS');
check(abs(array_sum($uniform) - 1.0) < 0.000001, 'uniform distribution must normalise');
check(bri_outcome_category(0) === 12, 'zero must have its own outcome category');
check(bri_outcome_category(36) === 11, '36 must map to street twelve');
check(abs(bri_brier_score($uniform, 12) - 1404 / 1369) < 0.000001, 'Brier score should score the actual zero category');
expect_invalid(fn () => bri_validate_probabilities([1.0]), 'probability vector length must be checked');
expect_invalid(fn () => bri_validate_probabilities([...array_fill(0, 13, 0.1)]), 'probability sum must be checked');

$batch = bri_validate_observation_batch([
    'table_id' => '123e4567-e89b-42d3-a456-426614174000',
    'session_id' => '223e4567-e89b-42d3-a456-426614174000',
    'table_name' => 'Research wheel',
    'table_type' => 'simulated',
    'source' => 'simulation',
    'data_origin' => 'synthetic',
    'share_consent' => false,
    'outcomes' => [
        ['event_id' => '323e4567-e89b-42d3-a456-426614174000', 'spin_number' => 1, 'outcome' => 0],
        ['event_id' => '423e4567-e89b-42d3-a456-426614174000', 'spin_number' => 2, 'outcome' => 36],
    ],
]);
check(count($batch['outcomes']) === 2, 'valid observation batch should be accepted');
expect_invalid(fn () => bri_validate_observation_batch(array_replace($batch, [
    'outcomes' => [
        ['event_id' => '323e4567-e89b-42d3-a456-426614174000', 'spin_number' => 2, 'outcome' => 0],
        ['event_id' => '423e4567-e89b-42d3-a456-426614174000', 'spin_number' => 1, 'outcome' => 36],
    ],
])), 'outcomes must retain chronological order');

$trackerState = [
    'version' => 1,
    'totalObservations' => 10,
    'recentOutcomes' => array_fill(0, 10, 1),
    'appearances' => [10, ...array_fill(0, 11, 0)],
    'currentAbsence' => [0, ...array_fill(0, 11, 10)],
    'longestAbsence' => [0, ...array_fill(0, 11, 10)],
    'intervalTotals' => [9, ...array_fill(0, 11, 0)],
    'intervalCounts' => [9, ...array_fill(0, 11, 0)],
    'lastSeenAge' => [0, ...array_fill(0, 11, null)],
    'consecutive' => [10, ...array_fill(0, 11, 0)],
    'previousStreet' => 0,
];
$modelState = [
    'version' => 1,
    'tracker' => $trackerState,
    'exponentialWeights' => array_fill(0, 13, 0.0),
    'modelPerformance' => [],
    'predictionPerformance' => ['total' => 0, 'successful' => 0],
];
check(bri_validate_model_state($modelState) === $modelState, 'valid compact model checkpoint should be accepted');
$invalidState = $modelState;
$invalidState['tracker']['previousStreet'] = 12;
expect_invalid(fn () => bri_validate_model_state($invalidState), 'invalid prior street should be rejected');

$challengeNames = ['invalid-outcome', 'nonnumeric-outcome', 'duplicate-event-id', 'conflicting-spin', 'missing-sequence', 'out-of-order', 'wrong-table', 'replayed-record', 'incorrect-correction'];
$challengeReport = [
    'run_id' => '523e4567-e89b-42d3-a456-426614174000',
    'benchmark_version' => 'False Entry Challenge',
    'seed' => 'php-validation-seed',
    'metrics' => [
        'truePositives' => 9,
        'falsePositives' => 0,
        'trueNegatives' => 40,
        'falseNegatives' => 0,
            'detectionLatency' => array_fill_keys($challengeNames, 1),
        'precision' => 1.0,
        'recall' => 1.0,
        'falsePositiveRate' => 0.0,
    ],
    'cases' => array_map(static fn (string $name): array => ['name' => $name, 'detected' => true], $challengeNames),
    'control_records_checked' => 40,
    'control_false_positive_count' => 0,
    'legitimate_repeated_outcomes_accepted' => true,
    'valid_substitution_flagged' => false,
    'undetectable_cases' => [
        ['name' => 'valid number substitution without independent source data', 'flagged' => false],
        ['name' => 'swapped valid outcomes without contradictory sequence metadata', 'flagged' => false],
    ],
];
check(bri_validate_challenge_report($challengeReport)['benchmark_version'] === '1', 'valid challenge report should be accepted');
$falsePositiveReport = $challengeReport;
$falsePositiveReport['metrics']['falsePositives'] = 2;
$falsePositiveReport['metrics']['trueNegatives'] = 38;
$falsePositiveReport['metrics']['precision'] = 9 / 11;
$falsePositiveReport['metrics']['falsePositiveRate'] = 2 / 40;
$falsePositiveReport['control_false_positive_count'] = 2;
check(bri_validate_challenge_report($falsePositiveReport)['metrics']['falsePositives'] === 2, 'measured control false positives must be accepted');
$missedCaseReport = $challengeReport;
$missedCaseReport['cases'][0]['detected'] = false;
$missedCaseReport['metrics']['truePositives'] = 8;
$missedCaseReport['metrics']['falseNegatives'] = 1;
$missedCaseReport['metrics']['recall'] = 8 / 9;
$missedCaseReport['metrics']['detectionLatency'][$challengeNames[0]] = null;
check(bri_validate_challenge_report($missedCaseReport)['metrics']['falseNegatives'] === 1, 'missed detections must remain measurable');
$invalidChallenge = $challengeReport;
$invalidChallenge['metrics']['falsePositiveRate'] = 1.0;
expect_invalid(fn () => bri_validate_challenge_report($invalidChallenge), 'inconsistent benchmark rates should be rejected');

echo "PASS: BRI validation, provenance, zero mapping, and Brier tests.\n";