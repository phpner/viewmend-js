export class ViewMendError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ViewMendConfigurationError extends ViewMendError {}

export class ViewMendValidationError extends ViewMendError {
  public readonly field: string | undefined;

  public constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

export class ViewMendApiError extends ViewMendError {
  public readonly statusCode: number;
  public readonly deliveryId: string | undefined;

  public constructor(message: string, statusCode: number, deliveryId?: string) {
    super(message);
    this.statusCode = statusCode;
    this.deliveryId = deliveryId;
  }
}

export class ViewMendAuthenticationError extends ViewMendApiError {}
export class ViewMendAuthorizationError extends ViewMendApiError {}
export class ViewMendNotFoundError extends ViewMendApiError {}
export class ViewMendConflictError extends ViewMendApiError {}
export class ViewMendEndpointDisabledError extends ViewMendApiError {}
export class ViewMendPayloadTooLargeError extends ViewMendApiError {}

export class ViewMendUnprocessableEventError extends ViewMendApiError {
  public readonly fields: readonly string[];

  public constructor(
    message: string,
    statusCode: number,
    deliveryId: string | undefined,
    fields: readonly string[],
  ) {
    super(message, statusCode, deliveryId);
    this.fields = Object.freeze([...fields]);
  }
}

export class ViewMendRateLimitError extends ViewMendApiError {
  public readonly retryAfterMs: number | undefined;

  public constructor(
    message: string,
    statusCode: number,
    deliveryId: string | undefined,
    retryAfterMs: number | undefined,
  ) {
    super(message, statusCode, deliveryId);
    this.retryAfterMs = retryAfterMs;
  }
}

export class ViewMendServerError extends ViewMendApiError {}
export class ViewMendInvalidResponseError extends ViewMendApiError {}
export class ViewMendNetworkError extends ViewMendError {}
export class ViewMendTimeoutError extends ViewMendError {}
export class ViewMendAbortError extends ViewMendError {}
