import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CAPACITY_CONFIG,
  analyse,
  type AppointmentGroup,
  type ShiftInput,
} from '../lib/capacity/engine';

/**
 * These are invariants rather than golden numbers: each one is a property that
 * must hold for every input, and each corresponds to a way the percentages on
 * the page could quietly become wrong.
 */

const shift = (over: Partial<ShiftInput> = {}): ShiftInput => ({
  date: '2026-10-01',
  doctorId: 1,
  doctorName: 'Dr. Example',
  specialty: 'Internal',
  startMin: 600,
  endMin: 840, // four hours
  ...over,
});

const group = (over: Partial<AppointmentGroup> = {}): AppointmentGroup => ({
  date: '2026-10-01',
  doctorId: 1,
  doctorName: 'Dr. Example',
  specialty: 'Internal',
  apptType: 'Normal',
  statusBucket: 'completed',
  count: 1,
  ...over,
});

test('utilisation and yield are measured against the same rostered minutes', () => {
  const result = analyse(
    [shift()], // 240 rostered minutes
    [group({ count: 4 }), group({ statusBucket: 'canceled', count: 4 })],
  );
  const doctor = result.doctors[0];
  assert.equal(doctor.rosteredMinutes, 240);
  // 8 appointments x 15 min = 120 booked minutes of 240 rostered.
  assert.equal(doctor.bookedMinutesRostered, 120);
  assert.equal(doctor.utilisation, 50);
  // Only the 4 completed count toward yield: 60 of 240.
  assert.equal(doctor.yield, 25);
});

test('yield can never exceed utilisation', () => {
  const result = analyse(
    [shift(), shift({ doctorId: 2, doctorName: 'Dr. Second', startMin: 540, endMin: 1080 })],
    [
      group({ count: 6 }),
      group({ statusBucket: 'noshow', count: 2 }),
      group({ doctorId: 2, doctorName: 'Dr. Second', count: 10 }),
      group({ doctorId: 2, doctorName: 'Dr. Second', statusBucket: 'other', count: 3 }),
    ],
  );
  for (const doctor of result.doctors) {
    assert.ok((doctor.yield ?? 0) <= (doctor.utilisation ?? 0), `${doctor.doctor} yield exceeded utilisation`);
  }
  for (const specialty of result.specialties) {
    assert.ok((specialty.yield ?? 0) <= (specialty.utilisation ?? 0));
  }
  assert.ok((result.totals.yield ?? 0) <= (result.totals.utilisation ?? 0));
});

test('an appointment on an unrostered day counts in the totals but not the ratio', () => {
  const result = analyse(
    [shift()],
    [
      group({ count: 4 }), // on the rostered day
      group({ date: '2026-10-02', count: 8 }), // no shift that day
    ],
  );
  const doctor = result.doctors[0];
  assert.equal(doctor.booked, 12, 'every booking is still counted');
  assert.equal(doctor.notRostered, 8, 'the unrostered ones are reported separately');
  assert.equal(doctor.bookedMinutesRostered, 60, 'only rostered-day minutes reach the ratio');
  // Without the exclusion this would read 300% instead of 25%.
  assert.equal(doctor.utilisation, 25);
});

test('a doctor with bookings but no roster has no utilisation rather than a false one', () => {
  const result = analyse([], [group({ count: 10 })]);
  const doctor = result.doctors[0];
  assert.equal(doctor.rosteredMinutes, 0);
  assert.equal(doctor.booked, 10);
  assert.equal(doctor.utilisation, null, 'dividing by zero rostered minutes must not produce a number');
  assert.equal(doctor.yield, null);
});

test('Pending, Due and Waiting Room are reported as completed', () => {
  const result = analyse([shift()], [group({ statusBucket: 'other', count: 8 })]);
  const doctor = result.doctors[0];
  assert.equal(doctor.completed, 8, 'the visit happened; only the record was left open');
  assert.equal(doctor.utilisation, 50);
  assert.equal(doctor.yield, 50, 'so it counts toward yield as well');
  // Kept only so the page can say how many were folded in.
  assert.equal(doctor.inProgress, 8);
});

test('the three states account for every booking, with no double counting', () => {
  const result = analyse(
    [shift()],
    [
      group({ count: 3 }),
      group({ statusBucket: 'canceled', count: 2 }),
      group({ statusBucket: 'noshow', count: 1 }),
      group({ statusBucket: 'other', count: 4 }),
    ],
  );
  const doctor = result.doctors[0];
  assert.equal(doctor.booked, 10);
  assert.equal(doctor.completed, 7, '3 completed plus the 4 folded in');
  // inProgress is a subset of completed, so adding it again would overcount.
  assert.equal(doctor.completed + doctor.canceled + doctor.noShow, doctor.booked);
});

test('specialty rows roll up their doctors and sub-specialties', () => {
  const config = {
    ...DEFAULT_CAPACITY_CONFIG,
    specialties: { known: ['Internal'], overrides: new Map<string, string | null>() },
  };
  const result = analyse(
    [
      shift({ specialty: 'Internal' }),
      shift({ doctorId: 2, doctorName: 'Dr. Second', specialty: 'Internal & ICU' }),
    ],
    [group({ count: 4 }), group({ doctorId: 2, doctorName: 'Dr. Second', specialty: 'Internal & ICU', count: 4 })],
    config,
  );
  assert.equal(result.specialties.length, 1, '"Internal & ICU" reports under Internal');
  assert.equal(result.specialties[0].specialty, 'Internal');
  assert.equal(result.specialties[0].doctors, 2);
  assert.equal(result.specialties[0].rosteredMinutes, 480);
});

test('idle minutes are never negative when a day is over-booked', () => {
  const result = analyse([shift()], [group({ count: 40 })]); // 600 min booked into 240
  const doctor = result.doctors[0];
  assert.ok((doctor.utilisation ?? 0) > 100, 'over-booking is visible');
  assert.equal(doctor.idleMinutes, 0, 'but idle time cannot go below zero');
});

test('totals agree with the sum of the doctor rows', () => {
  const result = analyse(
    [shift(), shift({ doctorId: 2, doctorName: 'Dr. Second' })],
    [group({ count: 5 }), group({ doctorId: 2, doctorName: 'Dr. Second', count: 7 })],
  );
  const summed = result.doctors.reduce((sum, row) => sum + row.rosteredMinutes, 0);
  assert.equal(result.totals.rosteredMinutes, summed);
  assert.equal(result.totals.booked, 12);
  assert.equal(result.totals.doctors, 2);
});

/* ------------------------------ date range ------------------------------- */

test('the default range is a whole calendar month, in every timezone', async () => {
  const { defaultCapacityRange } = await import('../lib/capacity/queries');

  const range = defaultCapacityRange({
    scheduleStart: '2026-10-01',
    scheduleEnd: '2026-10-31',
    appointmentsStart: '2026-08-01',
    appointmentsEnd: '2026-10-26',
  });

  // A rolling 30-day window built through Date/toISOString returned 2 October
  // in UTC and 1 October east of it, so the deployed page dropped a day and
  // under-reported every doctor rostered on the 1st.
  assert.deepEqual(range, { from: '2026-10-01', to: '2026-10-31' });
});

test('month lengths and leap years are respected', async () => {
  const { defaultCapacityRange } = await import('../lib/capacity/queries');
  const month = (end: string) =>
    defaultCapacityRange({
      scheduleStart: null,
      scheduleEnd: end,
      appointmentsStart: null,
      appointmentsEnd: null,
    });

  assert.deepEqual(month('2026-02-15'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(month('2028-02-15'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(month('2026-09-30'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(month('2026-12-01'), { from: '2026-12-01', to: '2026-12-31' });
});

test('the range falls back to appointments when no schedule is loaded', async () => {
  const { defaultCapacityRange } = await import('../lib/capacity/queries');
  assert.deepEqual(
    defaultCapacityRange({
      scheduleStart: null,
      scheduleEnd: null,
      appointmentsStart: '2026-10-01',
      appointmentsEnd: '2026-10-26',
    }),
    { from: '2026-10-01', to: '2026-10-31' },
  );
  assert.equal(
    defaultCapacityRange({
      scheduleStart: null, scheduleEnd: null, appointmentsStart: null, appointmentsEnd: null,
    }),
    null,
  );
});
