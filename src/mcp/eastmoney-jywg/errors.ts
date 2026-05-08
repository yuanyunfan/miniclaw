export class EastmoneyJywgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EastmoneyJywgError";
  }
}

export class EastmoneyJywgInvalidSessionError extends EastmoneyJywgError {
  constructor(message = "eastmoney jywg session is invalid or expired") {
    super(message);
    this.name = "EastmoneyJywgInvalidSessionError";
  }
}

export class EastmoneyJywgLoginChallengeError extends EastmoneyJywgError {
  constructor(message = "eastmoney jywg login challenge required") {
    super(message);
    this.name = "EastmoneyJywgLoginChallengeError";
  }
}

export class EastmoneyJywgForbiddenEndpointError extends EastmoneyJywgError {
  constructor(message = "eastmoney jywg endpoint is not allowed") {
    super(message);
    this.name = "EastmoneyJywgForbiddenEndpointError";
  }
}
