-- === HealPath BI schema ===
-- Reproduces the star schema from the Power BI model. VisitID is the single
-- linking key; every fact table is Many-to-One to visits on visit_id.

create schema if not exists healpath;

create table if not exists healpath.visits (
  visit_id          text primary key,
  patient_id        integer,
  prescription_date timestamptz,
  doctor_specialty  text,
  practitioner_name text,
  -- month_no / month_year are filled on import from the reliable MonthName field,
  -- NOT from the raw date (the raw extract has epoch-corrupted dates whose year
  -- reads as 1970 even though the month name is correct).
  month_no          smallint,
  month_year        text          -- 'YYYY-MM'
);

create table if not exists healpath.diagnosis_fact (
  id        bigint generated always as identity primary key,
  visit_id  text references healpath.visits(visit_id),
  diseases  text,   -- ICD-10 code, e.g. 'J20'
  icd_desc  text,
  icd_block text
);

create table if not exists healpath.drug_fact (
  id          bigint generated always as identity primary key,
  visit_id    text references healpath.visits(visit_id),
  medications text,
  brand       text,
  ac          text    -- active ingredient
);

create table if not exists healpath.lab_fact (
  id       bigint generated always as identity primary key,
  visit_id text references healpath.visits(visit_id),
  tests    text
);

create table if not exists healpath.scan_fact (
  id       bigint generated always as identity primary key,
  visit_id text references healpath.visits(visit_id),
  tests    text
);

create table if not exists healpath.patient_master (
  patient_id   bigint primary key,
  risk_carrier text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- indexes for join + filter performance
create index if not exists idx_diag_visit  on healpath.diagnosis_fact (visit_id);
create index if not exists idx_drug_visit  on healpath.drug_fact (visit_id);
create index if not exists idx_lab_visit   on healpath.lab_fact (visit_id);
create index if not exists idx_scan_visit  on healpath.scan_fact (visit_id);
create index if not exists idx_visit_month on healpath.visits (month_year);
create index if not exists idx_visit_spec  on healpath.visits (doctor_specialty);
create index if not exists idx_patient_master_risk_carrier on healpath.patient_master (risk_carrier);
create index if not exists idx_patient_master_updated_at on healpath.patient_master (updated_at desc);
