export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const assertFound = <T>(value: T | null | undefined, code = 'RESOURCE_NOT_FOUND', message = 'The requested resource was not found.'): T => {
  if (value === null || value === undefined) throw new AppError(404, code, message);
  return value;
};
