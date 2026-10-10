// abroadboard settings
//
// Paste your Supabase project's values here (Supabase Dashboard > Project Settings > API keys).
// Use the "Project URL" and the "publishable" key (called "anon public" on older projects).
// This key is designed to be public; the database security rules in supabase/schema.sql protect the data.
// NEVER paste the "secret" or "service_role" key here.
//
// While these are empty, the site runs in DEMO MODE: sample data, saved only in the visitor's browser.

export const SUPABASE_URL = "https://sjjjdjbkobszsqxzasjr.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_4tKG3rq75xrz-nzTLNL0ww_fYO7Ms3l";

// Student email domains allowed to sign up and post, one entry per institution.
// Keep in sync with public.allowed_email_domains() in supabase/schema.sql.
export const INSTITUTIONS = [
  { name: "University of Auckland", domains: ["aucklanduni.ac.nz", "uoa.auckland.ac.nz"] },
  { name: "Auckland University of Technology (AUT)", domains: ["autuni.ac.nz"] },
  { name: "Massey University (Albany)", domains: ["massey.ac.nz"] },
  { name: "Unitec Institute of Technology", domains: ["myunitec.ac.nz"] },
  { name: "Manukau Institute of Technology (MIT)", domains: ["manukaumail.com"] },
  { name: "Yoobee College of Creative Innovation", domains: ["student.yoobee.ac.nz"] },
  { name: "New Zealand School of Tourism (NZST)", domains: ["nzst.ac.nz"] },
  { name: "Auckland Institute of Studies (AIS)", domains: ["ess.ais.ac.nz"] },
  { name: "New Zealand Tertiary College (NZTC)", domains: ["nztertiarycollege.ac.nz"] },
  { name: "NZMA Auckland Central", domains: ["nzma.ac.nz"] },
  { name: "NZ Skills and Education College (NZSE)", domains: ["nzse.ac.nz"] },
  { name: "Auckland College of Tertiary Studies", domains: ["acts.ac.nz"] },
  { name: "Imperial College of New Zealand", domains: ["imperial.ac.nz"] },
  { name: "International College of Auckland (ICA)", domains: ["ica.ac.nz"] },
  { name: "Crown Institute of Studies", domains: ["crown.ac.nz"] },
  { name: "NZ Institute of Studies (NZIoS)", domains: ["nzios.ac.nz"] },
];
export const ALLOWED_DOMAINS = INSTITUTIONS.flatMap((i) => i.domains);

// Where in Auckland students study. Picking one and ticking the confirmation box
// is required to join (saved as profiles.campus and auckland_confirmed_at).
export const CAMPUSES = [
  "Auckland CBD (city centre)",
  "Grafton / Newmarket",
  "North Shore (Albany, Takapuna)",
  "West Auckland (Henderson, Mt Albert)",
  "South Auckland (Manukau, Ōtāhuhu)",
  "East Auckland (Botany, Howick)",
];

// Photos on posts: JPEG only, at most this many, each no bigger than this.
export const MAX_PHOTOS = 2;
export const MAX_PHOTO_MB = 5;

// Privacy notice (shown on the Join page and at #privacy). Bump the version when
// the notice changes; it is saved with each new account as a record of consent.
export const PRIVACY_VERSION = "2026-10-05";
// Fixed sign-up code, chosen by the project owner for testing and class demos.
// While this is set, no email is sent: anyone with an accepted student email who
// types this code is signed in (a profile is created the first time). It does NOT
// prove the person owns that inbox. Set it to "" to go back to emailed codes.
// Needs "Confirm email" switched off in Supabase (Authentication > Sign In / Providers > Email).
export const SIGNUP_CODE = "12345";

// Where students can reach the abroadboard team (footer, FAQ, privacy notice).
export const CONTACT_EMAIL = "info@abroadboard.com";
// Email address people can write to about their data.
export const PRIVACY_CONTACT = CONTACT_EMAIL;

// Posts disappear after this many days (Story 10). Keep in sync with schema.sql.
export const EXPIRY_DAYS = 21;

// Event listing fee shown at checkout (Story 16).
export const EVENT_FEE_NZD = 5;
