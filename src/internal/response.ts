import { ViewMendInvalidResponseError } from '../errors.js';

export type Decoder<T> = (value: unknown) => T;

export function invalidResponse(): never {
  throw new ViewMendInvalidResponseError('ViewMend returned a malformed API response.', 200);
}

export function jsonDocument(body: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    invalidResponse();
  }
  return record(value);
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

type Shape = Record<string, readonly [string, Decoder<unknown>]>;

export function object<S extends Shape>(
  value: unknown,
  shape: S,
): { readonly [K in keyof S]: ReturnType<S[K][1]> } {
  const data = record(value);
  const result: Record<string, unknown> = {};
  for (const [key, [wireKey, decode]] of Object.entries(shape)) {
    if (!Object.hasOwn(data, wireKey)) invalidResponse();
    result[key] = decode(data[wireKey]);
  }
  return Object.freeze(result) as { readonly [K in keyof S]: ReturnType<S[K][1]> };
}

export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value) => (value === null ? null : decode(value));
}

export function list<T>(decode: Decoder<T>): Decoder<readonly T[]> {
  return (value) => {
    if (!Array.isArray(value)) invalidResponse();
    return Object.freeze(value.map(decode));
  };
}

export function text(value: unknown): string {
  if (typeof value !== 'string') invalidResponse();
  // Reject unpaired UTF-16 surrogates, matching the PHP SDK's UTF-8 boundary.
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) invalidResponse();
  }
  return value;
}

export function identifier(value: unknown): string {
  const result = text(value);
  if (result.trim() === '') invalidResponse();
  return result;
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalidResponse();
  return value;
}

export function counter(value: unknown): number {
  const result = integer(value);
  if (result < 0) invalidResponse();
  return result;
}

export function positive(value: unknown): number {
  const result = integer(value);
  if (result < 1) invalidResponse();
  return result;
}

export function pageSize(value: unknown): number {
  const result = positive(value);
  if (result > 300) invalidResponse();
  return result;
}

export function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidResponse();
  return value;
}

export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalidResponse();
  return value;
}

export function timestamp(value: unknown): string {
  const result = text(value);
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      result,
    );
  if (parts === null) invalidResponse();
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    !Number.isFinite(Date.parse(result))
  )
    invalidResponse();
  return result;
}
