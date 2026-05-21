export interface CloudflareBindings {
  DB: D1Database;
  R2: R2Bucket;
  /** Cloudflare Images (free tier: 5k transforms/month). Optional in local Node dev. */
  IMAGES?: ImagesBinding;
  CONVERSATION_SERVER: DurableObjectNamespace;
  USER_SERVER: DurableObjectNamespace;
  JWT_SECRET?: string;
  JWT_EXPIRES_IN?: string;
  CORS_ORIGIN?: string;
  NUDGE_COOLDOWN_MINUTES?: string;
}
