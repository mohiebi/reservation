export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'ابتدا وارد شوید.') => new HttpError(401, msg);
export const notFound = (msg = 'پیدا نشد.') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);
