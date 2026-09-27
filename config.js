// abroadboard settings
//
// Paste your Supabase project's values here (Supabase Dashboard > Project Settings > API keys).
// Use the "Project URL" and the "publishable" key (called "anon public" on older projects).
// This key is designed to be public; the database security rules in supabase/schema.sql protect the data.
// NEVER paste the "secret" or "service_role" key here.
//
// While these are empty, the site runs in DEMO MODE: sample data, saved only in the visitor's browser.

export const SUPABASE_URL = "https://sjjjdjbkobszsqxzasjr.supabase.co/rest/v1/";
export const SUPABASE_ANON_KEY = "sb_publishable_4tKG3rq75xrz-nzTLNL0ww_fYO7Ms3l";

// Student email domain allowed to sign up and post. Keep in sync with
// public.allowed_email_domain() in supabase/schema.sql.
export const ALLOWED_DOMAIN = "aucklanduni.ac.nz";

// Posts disappear after this many days (Story 10). Keep in sync with schema.sql.
export const EXPIRY_DAYS = 21;

// Event listing fee shown at checkout (Story 16).
export const EVENT_FEE_NZD = 5;
