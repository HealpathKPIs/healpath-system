import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_BRACKETS,
  BRACKET_MINUTES,
  analyseSpecialtyBrackets,
  bracketLabel,
  bracketStartOf,
  type BracketAppointmentGroup,
} from '../lib/capacity/brackets';
import { DEFAULT_CAPACITY_CONFIG, type ShiftInput } from '../lib/capacity/engine';

/**
 * Invariants, not golden numbers. Each one is a way the grid could quietly
 * start reporting a time of day that nobody actually worked or booked.
 */

const shift = (over: Partial<ShiftInput> = {}): ShiftInput => ({
  date: '2026-10-01',
  doctorId: 1,
  doctorName: 'Dr. Example',
  specialty: 'Internal',
  startMin: 600, // 10:00
  endMin: 840, // 14:00
  ...over,
});

const group = (over: Partial<BracketAppointmentGroup> = {}): BracketAppointmentGroup => ({
  date: '2026-10-01',
  doctorId: 1,
  bracketStart: 600,
  apptType: null,
  statusBucket: 'completed',
  count: 1,
  ...over,
});

const doctors = [{ doctorId: 1, mainSpecialty: 'Internal' }];

const cellAt = (
  result: ReturnType<typeof analyseSpecialtyBrackets>,
  specialty: string,
  start: number,
) => {
  const row = result.rows.find((candidate) => candidate.specialty === specialty);
  assert.ok(row, `no row for ${specialty}`);
  const index = result.brackets.findIndex((bracket) => bracket.start === start);
  assert.notEqual(index, -1, `no bracket column at ${start}`);
  return row.cells[index];
};

test('a shift is split across brackets by the minutes it occupies in each', () => {
  // 13:30 to 16:00: 30 minutes in the noon bracket, 120 in the 2pm one.
  const result = analyseSpecialtyBrackets(
    [shift({ startMin: 810, endMin: 960 })],
    [],
    doctors,
    DEFAULT_CAPACITY_CONFIG,
  );

  assert.equal(cellAt(result, 'Internal', 720).rosteredMinutes, 30);
  assert.equal(cellAt(result, 'Internal', 840).rosteredMinutes, 120);
  assert.equal(result.rows[0].total.rosteredMinutes, 150);
});

test('row and column roll-ups equal the cells they are made of', () => {
  const result = analyseSpecialtyBrackets(
    [shift(), shift({ doctorId: 2, startMin: 960, endMin: 1200 })],
    [group({ count: 5 }), group({ doctorId: 2, bracketStart: 960, count: 3 })],
    [...doctors, { doctorId: 2, mainSpecialty: 'Internal' }],
    DEFAULT_CAPACITY_CONFIG,
  );

  for (const row of result.rows) {
    const summed = row.cells.reduce((sum, cell) => sum + cell.rosteredMinutes, 0);
    assert.equal(row.total.rosteredMinutes, summed);
    assert.equal(
      row.total.booked,
      row.cells.reduce((sum, cell) => sum + cell.booked, 0),
    );
  }

  assert.equal(
    result.grandTotal.rosteredMinutes,
    result.columnTotals.reduce((sum, cell) => sum + cell.rosteredMinutes, 0),
  );
  assert.equal(result.grandTotal.bracketStart, ALL_BRACKETS);
  // Two doctors share the specialty, so the row must not double-count them.
  assert.equal(result.grandTotal.doctors, 2);
});

test('utilisation divides booked time by the rostered time in the same bracket', () => {
  // Two hours rostered at 10:00, eight 15-minute bookings in it: 120 of 120.
  const result = analyseSpecialtyBrackets(
    [shift({ endMin: 720 })],
    [group({ count: 8 })],
    doctors,
    DEFAULT_CAPACITY_CONFIG,
  );

  const cell = cellAt(result, 'Internal', 600);
  assert.equal(cell.slots, 8);
  assert.equal(cell.utilisation, 100);
  assert.equal(cell.unbookedSlots, 0);
});

test('an overbooked bracket reports over 100% and never a negative free slot', () => {
  const result = analyseSpecialtyBrackets(
    [shift({ endMin: 720 })],
    [group({ count: 12 })],
    doctors,
    DEFAULT_CAPACITY_CONFIG,
  );

  const cell = cellAt(result, 'Internal', 600);
  assert.equal(cell.utilisation, 150);
  assert.equal(cell.unbookedSlots, 0);
});

test('bookings on a day with no shift are counted apart and kept out of the ratio', () => {
  const result = analyseSpecialtyBrackets(
    [shift({ endMin: 720 })],
    [group({ count: 4 }), group({ date: '2026-10-02', count: 6 })],
    doctors,
    DEFAULT_CAPACITY_CONFIG,
  );

  const cell = cellAt(result, 'Internal', 600);
  // Booked is what the roster was booked against, so the table can be checked
  // against itself: booked / slots must equal the utilisation printed beside it.
  assert.equal(cell.booked, 4);
  assert.equal(cell.notRostered, 6);
  assert.equal(cell.booked + cell.notRostered, 10);
  assert.equal(cell.utilisation, 50);
  assert.equal((cell.booked / cell.slots) * 100, cell.utilisation);
  assert.equal(cell.unbookedSlots, 4);
});

test('every status count stays inside the booked figure', () => {
  const result = analyseSpecialtyBrackets(
    [shift({ endMin: 720 })],
    [
      group({ count: 3 }),
      group({ statusBucket: 'canceled', count: 2 }),
      group({ statusBucket: 'noshow', count: 1 }),
      group({ statusBucket: 'other', count: 2 }),
      group({ date: '2026-10-02', count: 5 }),
    ],
    doctors,
    DEFAULT_CAPACITY_CONFIG,
  );

  const cell = cellAt(result, 'Internal', 600);
  // Pending / Due / Waiting Room ride with completed, as in engine.ts.
  assert.equal(cell.completed, 5);
  assert.equal(cell.canceled, 2);
  assert.equal(cell.noShow, 1);
  assert.equal(cell.completed + cell.canceled + cell.noShow, cell.booked);
  assert.equal(cell.notRostered, 5);
  assert.ok(cell.yield! <= cell.utilisation!);
});

test('untimed appointments are reported, never folded into midnight', () => {
  const result = analyseSpecialtyBrackets(
    [shift()],
    [group({ bracketStart: null, count: 7 })],
    doctors,
    DEFAULT_CAPACITY_CONFIG,
  );

  assert.equal(result.untimed, 7);
  assert.ok(!result.brackets.some((bracket) => bracket.start === 0));
  assert.equal(result.grandTotal.booked, 0);
});

test('the specialty comes from the doctor map, so an alias edit moves both tables', () => {
  const result = analyseSpecialtyBrackets(
    [shift()],
    [group()],
    [{ doctorId: 1, mainSpecialty: 'Internal & GIT rolled up' }],
    DEFAULT_CAPACITY_CONFIG,
  );

  assert.deepEqual(
    result.rows.map((row) => row.specialty),
    ['Internal & GIT rolled up'],
  );
});

test('a doctor with no mapping lands in Unassigned rather than vanishing', () => {
  const result = analyseSpecialtyBrackets([shift()], [group()], [], DEFAULT_CAPACITY_CONFIG);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].specialty, 'Unassigned');
  assert.equal(result.rows[0].total.booked, 1);
});

test('brackets are two hours wide and labelled by the clock they cover', () => {
  assert.equal(BRACKET_MINUTES, 120);
  assert.equal(bracketStartOf(605), 600);
  assert.equal(bracketStartOf(719), 600);
  assert.equal(bracketStartOf(720), 720);
  assert.equal(bracketLabel(600), '10:00 AM – 12:00 PM');
  assert.equal(bracketLabel(1320), '10:00 PM – 12:00 AM');
  assert.equal(bracketLabel(0), '12:00 AM – 2:00 AM');
});
