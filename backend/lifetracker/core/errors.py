"""Application errors and their HTTP mapping.

Services raise these; the API layer turns them into ``{"error": {"code", "message"}}``.
A resource owned by another user is reported as *not found* — never as *forbidden* —
so the API does not reveal that the id exists.
"""


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str = "") -> None:
        super().__init__(message or self.code)
        self.message = message or self.code


class UnauthorizedError(AppError):
    status_code = 401
    code = "unauthorized"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class DomainValidationError(AppError):
    status_code = 422
    code = "invalid"
