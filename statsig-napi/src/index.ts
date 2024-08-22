import {
  AutoReleasingStatsigOptionsRef,
  AutoReleasingStatsigRef,
  AutoReleasingStatsigUserRef,
  consoleLoggerInit,
  DynamicConfigNapi,
  ExperimentNapi,
  FeatureGateNapi as FeatureGate,
  LayerNapi,
  statsigCheckGate,
  statsigCreate,
  statsigGetClientInitResponse,
  statsigGetDynamicConfig,
  statsigGetExperiment,
  statsigGetFeatureGate,
  statsigGetLayer,
  statsigInitialize,
  statsigLogLayerParamExposure,
  statsigLogStringValueEvent,
  statsigOptionsCreate,
  statsigShutdown,
  statsigUserCreate,
} from './bindings';

// prettier-ignore
export type TypedReturn<T = unknown> = 
    T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : T extends Array<unknown> ? Array<unknown>
  : T extends object ? object
  : unknown;

export type TypedGet = <T = unknown>(
  key: string,
  fallback?: T,
) => TypedReturn<T>;

export type DynamicConfig = DynamicConfigNapi & {
  readonly value: Record<string, unknown>;
  readonly get: TypedGet;
};

export type Experiment = ExperimentNapi & {
  readonly value: Record<string, unknown>;
  readonly get: TypedGet;
};

export type Layer = LayerNapi & {
  readonly get: TypedGet;
};

export enum LogLevel {
  None = 0,
  Error = 1,
  Warn = 2,
  Info = 3,
  Debug = 4,
}

export class StatsigOptions {
  readonly __ref: AutoReleasingStatsigOptionsRef;

  readonly outputLoggerLevel: LogLevel = LogLevel.Debug;

  constructor(
    outputLoggerLevel?: LogLevel,
    environment?: string | undefined | null,
    specsUrl?: string | undefined | null,
    logEventUrl?: string | undefined | null,
  ) {
    this.outputLoggerLevel = outputLoggerLevel ?? LogLevel.Error;
    this.__ref = statsigOptionsCreate(environment, specsUrl, logEventUrl);
  }
}

export class StatsigUser {
  readonly __ref: AutoReleasingStatsigUserRef;

  constructor(
    userID: string,
    customIDs: Record<string, string>,
    email?: string | undefined | null,
    ip?: string | undefined | null,
    userAgent?: string | undefined | null,
    country?: string | undefined | null,
    locale?: string | undefined | null,
    appVersion?: string | undefined | null,
    custom?: Record<string, string> | undefined | null,
    privateAttributes?: Record<string, string> | undefined | null,
  ) {
    this.__ref = statsigUserCreate(
      userID,
      customIDs,
      email,
      ip,
      userAgent,
      country,
      locale,
      appVersion,
      JSON.stringify(custom),
      JSON.stringify(privateAttributes),
    );
  }
}

export class Statsig {
  readonly __ref: AutoReleasingStatsigRef;

  constructor(sdkKey: string, options?: StatsigOptions) {
    _initializeConsoleLogger(options?.outputLoggerLevel);

    this.__ref = statsigCreate(sdkKey, options?.__ref.value);
    console.log('Created', this.__ref.value);
  }

  initialize(): Promise<void> {
    console.log('initialize', this.__ref.value);
    return statsigInitialize(this.__ref.value);
  }

  shutdown(): Promise<void> {
    return statsigShutdown(this.__ref.value);
  }

  logEvent(
    user: StatsigUser,
    eventName: string,
    value?: string | undefined | null,
    metadata?: Record<string, string> | undefined | null,
  ): void {
    statsigLogStringValueEvent(
      this.__ref.value,
      user.__ref.value,
      eventName,
      value,
      metadata,
    );
  }

  checkGate(user: StatsigUser, gateName: string): boolean {
    return statsigCheckGate(this.__ref.value, user.__ref.value, gateName);
  }

  getFeatureGate(user: StatsigUser, gateName: string): FeatureGate {
    return statsigGetFeatureGate(this.__ref.value, user.__ref.value, gateName);
  }

  getDynamicConfig(
    user: StatsigUser,
    dynamicConfigName: string,
  ): DynamicConfig {
    const dynamicConfig = statsigGetDynamicConfig(
      this.__ref.value,
      user.__ref.value,
      dynamicConfigName,
    );

    const value = JSON.parse(dynamicConfig.jsonValue);
    return {
      ...dynamicConfig,
      value,
      get: _makeTypedGet(value),
    };
  }

  getExperiment(user: StatsigUser, experimentName: string): Experiment {
    const experiment = statsigGetExperiment(
      this.__ref.value,
      user.__ref.value,
      experimentName,
    );

    const value = JSON.parse(experiment.jsonValue);
    return {
      ...experiment,
      value,
      get: _makeTypedGet(value),
    };
  }

  getLayer(user: StatsigUser, layerName: string): Layer {
    const layerJson = statsigGetLayer(
      this.__ref.value,
      user.__ref.value,
      layerName,
    );

    const layer = JSON.parse(layerJson);
    const value = layer['__value'];
    return {
      ...layer,
      get: _makeTypedGet(value, (param: string) => {
        statsigLogLayerParamExposure(this.__ref.value, layerJson, param);
      }),
    };
  }

  getClientInitializeResponse(user: StatsigUser): string {
    return statsigGetClientInitResponse(this.__ref.value, user.__ref.value);
  }
}

function _initializeConsoleLogger(level: LogLevel | undefined) {
  const errMessage = consoleLoggerInit(
    (level ?? LogLevel.Error) as any,
    (_, msg) => console.debug(msg),
    (_, msg) => console.info(msg),
    (_, msg) => console.warn(msg),
    (_, msg) => console.error(msg),
  );

  if (errMessage != null && level != LogLevel.None) {
    console.warn(errMessage);
  }
}

function _isTypeMatch<T>(a: unknown, b: unknown): a is T {
  const typeOf = (x: unknown) => (Array.isArray(x) ? 'array' : typeof x);
  return typeOf(a) === typeOf(b);
}

function _makeTypedGet(
  value: Record<string, unknown>,
  exposeFunc?: (param: string) => void,
): TypedGet {
  return <T = unknown>(param: string, fallback?: T) => {
    const found = value?.[param] ?? null;

    if (found == null) {
      return (fallback ?? null) as TypedReturn<T>;
    }

    if (fallback != null && !_isTypeMatch(found, fallback)) {
      return (fallback ?? null) as TypedReturn<T>;
    }

    exposeFunc?.(param);
    return found as TypedReturn<T>;
  };
}
