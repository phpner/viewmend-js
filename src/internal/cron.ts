import type {
  CronRegistrationInput,
  CronRegistrationResult,
  CronRequestOptions,
} from '../cron-types.js';
import { ViewMendNotFoundError, ViewMendValidationError } from '../errors.js';
import {
  boolean,
  counter,
  identifier,
  invalidResponse,
  jsonDocument,
  nullable,
  object,
  record,
  timestamp,
} from './response.js';
import { isAbortSignal } from './validation.js';

export function validateCronOptions(options: CronRequestOptions, registration = false): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new ViewMendValidationError('Cron options must be an object.');
  }
  const fields = registration
    ? ['cron', 'timezone', 'endpointPath', 'enabled', 'signal']
    : ['signal'];
  if (Object.keys(options).some((key) => !fields.includes(key))) {
    throw new ViewMendValidationError('Unsupported Cron option.');
  }
  if (options.signal !== undefined && !isAbortSignal(options.signal)) {
    throw new ViewMendValidationError('signal must be an AbortSignal.', 'signal');
  }
}

function inputText(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    new TextEncoder().encode(value.trim()).length > maximum
  ) {
    throw new ViewMendValidationError(`The Cron ${field} is invalid.`, field);
  }
  return value.trim();
}

export function registrationBody(input: CronRegistrationInput): string {
  validateCronOptions(input, true);
  const cron = inputText(input.cron, 'cron', 100);
  const timezone = inputText(input.timezone, 'timezone', 64);
  const endpointPath = inputText(input.endpointPath, 'endpointPath', 512);
  if (
    !endpointPath.startsWith('/') ||
    endpointPath.startsWith('//') ||
    /[\\?#]/.test(endpointPath) ||
    /(^|\/)\.\.(\/|$)/.test(endpointPath) ||
    [...endpointPath].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 31 || point === 127;
    })
  ) {
    throw new ViewMendValidationError(
      'The Cron endpoint must be an absolute path without a host, query, fragment, or parent traversal.',
      'endpointPath',
    );
  }
  const enabled = input.enabled === undefined ? true : input.enabled;
  if (typeof enabled !== 'boolean')
    throw new ViewMendValidationError('enabled must be a boolean.', 'enabled');
  return JSON.stringify({ schedule: { cron, timezone }, endpoint_path: endpointPath, enabled });
}

function endpoint(value: unknown): string {
  const result = identifier(value);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    invalidResponse();
  }
  const local =
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname === 'host.docker.internal' ||
    url.hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username !== '' ||
    url.password !== ''
  )
    invalidResponse();
  return result;
}

export function parseRegistration(body: string): CronRegistrationResult {
  const data = record(jsonDocument(body).data);
  const result = object(data, {
    id: ['id', identifier],
    connectionId: ['connection_id', identifier],
    domain: ['domain', identifier],
    endpointPath: ['endpoint_path', identifier],
    endpointUrl: ['endpoint_url', endpoint],
    method: [
      'method',
      (value): 'POST' => {
        if (value !== 'POST') invalidResponse();
        return value;
      },
    ],
    enabled: ['enabled', boolean],
    status: ['status', identifier],
    consecutiveFailures: ['consecutive_failures', counter],
  });
  const schedule = object(data.schedule, {
    cron: ['cron', identifier],
    timezone: ['timezone', identifier],
  });
  // Older Cron responses may omit nullable date fields.
  const date = (key: string) => nullable(timestamp)(data[key] === undefined ? null : data[key]);
  return Object.freeze({
    ...result,
    ...schedule,
    verifiedAt: date('verified_at'),
    nextRunAt: date('next_run_at'),
    lastRunAt: date('last_run_at'),
    updatedAt: date('updated_at'),
  });
}

export function parseCurrentRegistration(
  response: Response,
  body: string,
): CronRegistrationResult | null {
  if (response.status === 200) return parseRegistration(body);
  try {
    const data = jsonDocument(body);
    if (record(data.error).code === 'registration_not_found') return null;
  } catch {
    // A proxy/router 404 is not evidence that no schedule exists.
  }
  throw new ViewMendNotFoundError('The ViewMend Cron registration endpoint was not found.', 404);
}
