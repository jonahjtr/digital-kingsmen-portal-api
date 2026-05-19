export interface CloudflareBindings {
  DB: D1Database;
  R2: R2Bucket;
  CONVERSATION_SERVER: DurableObjectNamespace;
  USER_SERVER: DurableObjectNamespace;
  JWT_SECRET?: string;
  JWT_EXPIRES_IN?: string;
  CORS_ORIGIN?: string;
  NUDGE_COOLDOWN_MINUTES?: string;
}
