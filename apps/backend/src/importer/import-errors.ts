/**
 * Typed error hierarchy for the POI import pipeline (C6).
 *
 * All importer failures that are caused by an invalid or unsafe bundle are
 * `ImportValidationError`s raised *before* any database write. Replay policy
 * violations are `ImportReplayError`s. Anything else (connection failure,
 * unexpected database error) is wrapped in `PoiImportError` by the service.
 */
export class PoiImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PoiImportError';
  }
}

/** A bundle failed preflight validation. Never implies any DB write happened. */
export class ImportValidationError extends PoiImportError {
  constructor(
    code: string,
    message: string,
  ) {
    super(code, message);
    this.name = 'ImportValidationError';
  }
}

/** The SQL artifact does not match the restricted v1 grammar. */
export class SqlGrammarError extends ImportValidationError {
  constructor(
    message: string,
  ) {
    super('sql_grammar', message);
    this.name = 'SqlGrammarError';
  }
}

/** The same bundle (manifest sha256) was already imported and replay is denied. */
export class ImportReplayError extends PoiImportError {
  constructor(
    message: string,
  ) {
    super('import_replay', message);
    this.name = 'ImportReplayError';
  }
}
