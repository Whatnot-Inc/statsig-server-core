<?php

require_once __DIR__ . "/../vendor/autoload.php";

use Statsig\Statsig;
use Statsig\StatsigUser;
use Statsig\StatsigEventData;

$installedPackages = json_decode(file_get_contents(__DIR__ . '/../vendor/composer/installed.json'), true);
$statsigCoreVersion = null;

foreach ($installedPackages['packages'] as $package) {
    if ($package['name'] === 'statsig/statsig-php-core') {
        $statsigCoreVersion = $package['version'];
        break;
    }
}

$sdkType = 'statsig-server-core-php';
$sdkVersion = $statsigCoreVersion ?? 'unknown';

$metadataFile = getenv("BENCH_METADATA_FILE");
file_put_contents($metadataFile, json_encode([
    'sdk_type' => $sdkType,
    'sdk_version' => $sdkVersion,
]));

echo "Statsig PHP Core (v" . ($sdkVersion) . ")\n";
echo "--------------------------------\n";

$key = getenv("PERF_SDK_KEY");
$statsig = new Statsig($key);
$statsig->initialize();

$CORE_ITER = 100000;
$GCIR_ITER = 1000;

$globalUser = new StatsigUser("global_user");
$results = [];

function makeRandomUser()
{
    return new StatsigUser(uniqid());
}

function benchmark($iterations, $func)
{
    $durations = [];

    for ($i = 0; $i < $iterations; $i++) {
        $start = microtime(true);
        $func();
        $end = microtime(true);
        $durations[] = ($end - $start) * 1000; // Convert to milliseconds
    }

    // Calculate p99
    sort($durations);
    $p99Index = floor($iterations * 0.99);
    return $durations[$p99Index];
}

function logBenchmark($name, $p99)
{
    echo str_pad($name, 50) . number_format($p99, 4) . "ms\n";

    $ci = getenv("CI");
    if ($ci !== '1' && $ci !== 'true') {
        return;
    }

    global $statsig, $globalUser, $sdkType, $sdkVersion;
    $statsig->logEvent(new StatsigEventData(
        "sdk_benchmark",
        $p99,
        [
            'benchmarkName' => $name,
            'sdkType' => $sdkType,
            'sdkVersion' => $sdkVersion
        ]
    ), $globalUser);
}

function runCheckGate()
{
    global $statsig, $results, $CORE_ITER;
    $p99 = benchmark($CORE_ITER, function () use ($statsig) {
        $statsig->checkGate(makeRandomUser(), 'test_advanced');
    });
    $results['check_gate'] = $p99;
}

function runCheckGateGlobalUser()
{
    global $statsig, $results, $globalUser, $CORE_ITER;
    $p99 = benchmark($CORE_ITER, function () use ($statsig, $globalUser) {
        $statsig->checkGate($globalUser, 'test_advanced');
    });
    $results['check_gate_global_user'] = $p99;
}

function runGetFeatureGate()
{
    global $statsig, $results, $CORE_ITER;
    $p99 = benchmark($CORE_ITER, function () use ($statsig) {
        $statsig->getFeatureGate(makeRandomUser(), 'test_advanced');
    });
    $results['get_feature_gate'] = $p99;
}

function runGetFeatureGateGlobalUser()
{
    global $statsig, $results, $globalUser, $CORE_ITER;
    $p99 = benchmark($CORE_ITER, function () use ($statsig, $globalUser) {
        $statsig->getFeatureGate($globalUser, 'test_advanced');
    });
    $results['get_feature_gate_global_user'] = $p99;
}

function runGetExperiment()
{
    global $statsig, $results, $CORE_ITER;
    $p99 = benchmark($CORE_ITER, function () use ($statsig) {
        $statsig->getExperiment(makeRandomUser(), 'an_experiment');
    });
    $results['get_experiment'] = $p99;
}

function runGetExperimentGlobalUser()
{
    global $statsig, $results, $globalUser, $CORE_ITER;
    $p99 = benchmark($CORE_ITER, function () use ($statsig, $globalUser) {
        $statsig->getExperiment($globalUser, 'an_experiment');
    });
    $results['get_experiment_global_user'] = $p99;
}

function runGetClientInitializeResponse()
{
    global $statsig, $results, $GCIR_ITER;
    $p99 = benchmark($GCIR_ITER, function () use ($statsig) {
        $statsig->getClientInitializeResponse(makeRandomUser());
    });
    $results['get_client_initialize_response'] = $p99;
}

function runGetClientInitializeResponseGlobalUser()
{
    global $statsig, $results, $globalUser, $GCIR_ITER;
    $p99 = benchmark($GCIR_ITER, function () use ($statsig, $globalUser) {
        $statsig->getClientInitializeResponse($globalUser);
    });
    $results['get_client_initialize_response_global_user'] = $p99;
}

// Run all benchmarks
runCheckGate();
runCheckGateGlobalUser();
runGetFeatureGate();
runGetFeatureGateGlobalUser();
runGetExperiment();
runGetExperimentGlobalUser();
runGetClientInitializeResponse();
runGetClientInitializeResponseGlobalUser();

// Log results
foreach ($results as $name => $p99) {
    logBenchmark($name, $p99);
}

$statsig->shutdown();
