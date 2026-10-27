import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAutoLink,
  nameScore,
  normalizePersonName,
  AUTO_LINK_THRESHOLD,
  SUGGEST_THRESHOLD,
} from '../lib/capacity/names';
import {
  OVERNIGHT_MAX,
  hhmmAmPm,
  overlap,
  parseClock,
  parseShiftText,
  shiftMinutes,
} from '../lib/capacity/shift-time';
import {
  resolveMainSpecialty,
  specialtyMatches,
  suggestParentSpecialty,
  type SpecialtyConfig,
} from '../lib/capacity/specialties';
import { parseWhen, statusBucket, detectDateOrder } from '../lib/capacity/appointment-parser';

/* --------------------------------- clocks -------------------------------- */

test('parseClock reads the formats the schedule actually uses', () => {
  assert.equal(parseClock('10:00 AM'), 600);
  assert.equal(parseClock('02:00 PM'), 840);
  assert.equal(parseClock('12:00 AM'), 0);
  assert.equal(parseClock('12:00 PM'), 720);
  assert.equal(parseClock('9 PM'), 1260);
  assert.equal(parseClock(0.5), 720); // Excel day fraction
  assert.equal(parseClock('not a time'), null);
  assert.equal(parseClock('25:00'), null);
});

test('hhmmAmPm renders midnight as the end of the day it belongs to', () => {
  assert.equal(hhmmAmPm(600), '10:00 AM');
  assert.equal(hhmmAmPm(1320), '10:00 PM');
  assert.equal(hhmmAmPm(null), '');
});

test('overlap measures shared minutes only', () => {
  assert.equal(overlap(600, 720, 660, 780), 60);
  assert.equal(overlap(600, 720, 720, 780), 0);
});

/* --------------------------------- shifts -------------------------------- */

test('a shift ending at 12:00 AM runs to midnight, not backwards', () => {
  // The defect this fixes dropped 31 rows of real working time in October.
  const result = shiftMinutes([[1320, 0]]);
  assert.equal(result.minutes, 120);
  assert.deepEqual(result.fixes, ['midnight']);
  assert.equal(result.flags.length, 0);
});

test('a shift crossing midnight is split across both dates', () => {
  const result = shiftMinutes([[1320, 120]]);
  assert.equal(result.minutes, 120, 'the part before midnight stays on this day');
  assert.deepEqual(result.carry, [[0, 120]], 'the remainder is carried to the next date');
  assert.deepEqual(result.fixes, ['overnight']);
});

test('an end time past the overnight window is a real error, not a repair', () => {
  const result = shiftMinutes([[1320, 540]]); // 10 PM -> 9 AM, beyond OVERNIGHT_MAX
  assert.ok(540 > OVERNIGHT_MAX);
  assert.deepEqual(result.flags, ['end time is before start time']);
  assert.equal(result.minutes, 0);
});

test('overlapping shifts are reported but still counted', () => {
  const result = shiftMinutes([[600, 720], [660, 780]]);
  assert.ok(result.flags.includes('overlapping shifts'));
  assert.equal(result.clean.length, 2);
});

test('parseShiftText reads split shifts and leave markers', () => {
  assert.deepEqual(parseShiftText('10:00 AM – 02:00 PM').shifts, [[600, 840]]);
  assert.deepEqual(parseShiftText('10:00 AM - 12:00 PM | 06:00 PM - 10:00 PM').shifts, [
    [600, 720],
    [1080, 1320],
  ]);
  assert.deepEqual(parseShiftText('LEAVE'), { shifts: [], note: 'LEAVE' });
  assert.equal(parseShiftText('gibberish').note?.startsWith('UNREADABLE'), true);
});

/* ---------------------------------- dates -------------------------------- */

test('parseWhen honours the pinned order and never guesses', () => {
  // The export writes "25/10/2026 - 09:45 PM".
  assert.deepEqual(parseWhen('25/10/2026 - 09:45 PM', 'dmy'), { date: '2026-10-25', min: 1305 });
  // The same text under the other order is a different real date. Pinning the
  // order is what stops a month of low day numbers silently flipping.
  assert.deepEqual(parseWhen('05/10/2026 - 09:45 AM', 'dmy'), { date: '2026-10-05', min: 585 });
  assert.deepEqual(parseWhen('05/10/2026 - 09:45 AM', 'mdy'), { date: '2026-05-10', min: 585 });
  // A value above 12 can only be a day, whichever order was declared.
  assert.equal(parseWhen('25/10/2026', 'mdy')?.date, '2026-10-25');
});

test('detectDateOrder is advisory and admits ambiguity', () => {
  assert.equal(detectDateOrder(['25/10/2026', '13/10/2026']), 'dmy');
  assert.equal(detectDateOrder(['10/25/2026', '10/13/2026']), 'mdy');
  // Nothing above 12 anywhere: it cannot tell, and defaults rather than claims.
  assert.equal(detectDateOrder(['05/10/2026', '06/11/2026']), 'dmy');
});

/* -------------------------------- statuses ------------------------------- */

test('statusBucket folds every status the export actually contains', () => {
  assert.equal(statusBucket('Completed'), 'completed');
  assert.equal(statusBucket('Canceled'), 'canceled');
  assert.equal(statusBucket('No-Show Patient'), 'noshow');
  // Pending / Due Appointment / Waiting Room are booked but not completed:
  // they hold capacity, so they count in utilisation and not in yield.
  assert.equal(statusBucket('Pending'), 'other');
  assert.equal(statusBucket('Due Appointment'), 'other');
  assert.equal(statusBucket('Waiting Room'), 'other');
});

/* ------------------------------ specialties ------------------------------ */

const config = (known: string[], overrides: [string, string | null][] = []): SpecialtyConfig => ({
  known,
  overrides: new Map(overrides),
});

test('"X & Y" rolls up under X, matched against specialties that exist', () => {
  const known = ['Internal', 'Pediatrics'];
  assert.equal(suggestParentSpecialty('Internal & ICU', known), 'Internal');
  assert.equal(suggestParentSpecialty('Internal &GIT', known), 'Internal');
  assert.equal(suggestParentSpecialty('Internal & nephrology', known), 'Internal');
  assert.equal(suggestParentSpecialty('Pediatrics & nutrition', known), 'Pediatrics');
});

test('only "&" splits: "/" and "and" live inside real specialty names', () => {
  const known = ['Ob/Gyn', 'Obstetrics and Gynecology', 'Cardiology'];
  assert.equal(suggestParentSpecialty('Ob/Gyn', known), null);
  assert.equal(suggestParentSpecialty('Obstetrics and Gynecology', known), null);
  assert.equal(suggestParentSpecialty('Cardiology', known), null);
});

test('an explicit decision overrides the automatic rule, including standing alone', () => {
  const known = ['Internal', 'Endocrinology'];
  // Dr Wael is written "Internal &Endocrine" but reports under Endocrinology.
  const withOverride = config(known, [['Internal &Endocrine', 'Endocrinology']]);
  assert.equal(resolveMainSpecialty('Internal &Endocrine', withOverride), 'Endocrinology');

  // null means "stands alone" and must suppress the automatic rule, which is
  // the state that collapses if absent and null are treated the same.
  const standsAlone = config(known, [['Internal & ICU', null]]);
  assert.equal(resolveMainSpecialty('Internal & ICU', standsAlone), 'Internal & ICU');
  assert.equal(resolveMainSpecialty('Internal & ICU', config(known)), 'Internal');
});

test('a circular mapping terminates instead of hanging the page', () => {
  const circular = config(['A', 'B'], [['A', 'B'], ['B', 'A']]);
  const resolved = resolveMainSpecialty('A', circular);
  assert.ok(resolved === 'A' || resolved === 'B');
});

test('a specialty filter catches the sub-specialties beneath it', () => {
  const known = ['Internal'];
  assert.equal(specialtyMatches('Internal & ICU', 'Internal', config(known)), true);
  assert.equal(specialtyMatches('Internal', 'internal', config(known)), true);
  assert.equal(specialtyMatches('Cardiology', 'Internal', config(known)), false);
});

/* --------------------------------- names --------------------------------- */

test('normalizePersonName strips titles and punctuation', () => {
  assert.equal(normalizePersonName('Prof. Yassien Sslah'), 'yassien sslah');
  assert.equal(normalizePersonName('Dr. wael El-seoudi'), 'wael el seoudi');
  assert.equal(normalizePersonName('Dr.Mohamed Saad'), 'mohamed saad');
});

test('nameScore is certain only when it should be', () => {
  assert.equal(nameScore('Dr. Salma Elshamy', 'Salma Elshamy').s, 1);
  assert.ok(nameScore('Sarah Khalil', 'Sara Khalil').s >= AUTO_LINK_THRESHOLD);
});

test('a shorter name with a different surname is never auto-linked', () => {
  // The Abo Auf shape: every part of the shorter name appears in the longer
  // one, but the longer one carries a surname the shorter never mentions.
  // Crediting these to each other put 69 hours in the wrong specialty, so the
  // refusal is based on the kind of match rather than only its score.
  const subset = nameScore('Ahmed Abo Auf Al Hoby', 'Ahmed Abo Auf');
  assert.equal(subset.verify, true, `expected a verify flag, got "${subset.why}"`);
  assert.equal(canAutoLink(subset), false);

  // The pair that was actually mis-linked scores far lower still.
  const wrong = nameScore('Ahmed Abo Auf Al Hoby', 'Ahmed Elgohary');
  assert.ok(wrong.s < AUTO_LINK_THRESHOLD, `got ${wrong.s} (${wrong.why})`);
  assert.equal(canAutoLink(wrong), false);
});

test('a surname that agrees is safe to link; one that does not is never safe', () => {
  const agrees = nameScore('Dr. Salma Ahmed Yusuf Elshamy', 'Dr. Salma Elshamy');
  assert.ok(agrees.s >= AUTO_LINK_THRESHOLD);
  assert.equal(canAutoLink(agrees), true);

  const differs = nameScore('Ahmed Abo Auf Al Hoby', 'Ahmed Abo Auf');
  assert.equal(canAutoLink(differs), false);
});

test('two near-equal candidates block the link rather than picking one', () => {
  const best = nameScore('Dr. Mohamed Saad', 'Dr. Mohammad Saad');
  const runnerUp = nameScore('Dr. Mohamed Saad', 'Dr. Muhammad Saad');
  assert.ok(best.s >= AUTO_LINK_THRESHOLD);
  // On its own it would link; with an equally good rival it must not.
  assert.equal(canAutoLink(best), true);
  assert.equal(canAutoLink(best, runnerUp), false);
});

test('the auto threshold still excludes the "first and last name match" band', () => {
  // The source tool linked at 0.85, which admits two people sharing two
  // common given names.
  assert.ok(AUTO_LINK_THRESHOLD > 0.85);
  assert.ok(SUGGEST_THRESHOLD < AUTO_LINK_THRESHOLD);
  assert.equal(canAutoLink({ s: 0.87, why: 'first and last name match' }), false);
});

test('spelling variants of the same name still match', () => {
  assert.ok(nameScore('Mohamed Saad', 'Mohammad Saad').s >= AUTO_LINK_THRESHOLD);
  assert.ok(nameScore('Muhammad Saad', 'Mohamed Saad').s >= AUTO_LINK_THRESHOLD);
});
