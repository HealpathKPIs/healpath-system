'use client';

import { useRef, useState } from 'react';

import type { BracketCell, BracketColumn, SpecialtyBracketRow } from '@/lib/capacity/brackets';

/**
 * Specialty x time-of-day, coloured by utilisation.
 *
 * Diverging, not sequential, and the midpoint is 100% rather than the middle of
 * the data. Utilisation has a true neutral - booked time exactly equal to
 * rostered time - and the two sides mean opposite things: cool is capacity
 * standing idle, warm is a clinic taking more than it rostered for. A single
 * light-to-dark ramp would paint 40% and 160% as "quiet" and "busy" ends of one
 * scale and hide the only boundary anybody acts on.
 *
 * The neutral sits at the surface colour, so a bracket running at capacity
 * disappears into the card and the eye is left with the exceptions. Strength
 * carries distance from 100%, saturating at 0% one way and 150% the other -
 * past that the difference stops being actionable and more ink only hurts the
 * cells around it.
 *
 * Colour never carries the number on its own: every cell prints its own value,
 * the scale is labelled, and the table below the grid holds every underlying
 * count.
 */

export interface SpecialtyBracketGridProps {
  brackets: BracketColumn[];
  rows: SpecialtyBracketRow[];
  columnTotals: BracketCell[];
  grandTotal: BracketCell;
}

const COOL = 'var(--cap-util)';
const WARM = 'var(--cap-cancelled)';

/** Full cool at 0%, neutral at 100%, full warm at 150% and above. */
function fillFor(utilisation: number | null): { background: string; onFill: boolean } {
  if (utilisation == null) return { background: 'transparent', onFill: false };

  const gap = utilisation - 100;
  const hue = gap < 0 ? COOL : WARM;
  const distance = gap < 0 ? Math.min(1, -gap / 100) : Math.min(1, gap / 50);
  const weight = Math.round((0.08 + 0.74 * distance) * 100);

  return {
    background: `color-mix(in srgb, ${hue} ${weight}%, var(--surface))`,
    // Past roughly half strength the fill is dark enough that body ink stops
    // clearing contrast in either theme, so the value flips to white.
    onFill: weight >= 46,
  };
}

const hours = (minutes: number) => minutes / 60;

export default function SpecialtyBracketGrid({
  brackets,
  rows,
  columnTotals,
  grandTotal,
}: SpecialtyBracketGridProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ cell: BracketCell; label: string; x: number; y: number } | null>(
    null,
  );

  if (!brackets.length || !rows.length) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        No rostered shifts or appointments in this range to place into brackets.
      </p>
    );
  }

  const show = (cell: BracketCell, label: string) => (event: React.MouseEvent<HTMLElement>) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    const box = event.currentTarget.getBoundingClientRect();
    setHover({
      cell,
      label,
      x: Math.min(Math.max(box.left - wrap.left + box.width / 2, 90), wrap.width - 90),
      y: box.top - wrap.top,
    });
  };

  const renderCell = (cell: BracketCell, bracketLabel: string, isTotal: boolean) => {
    const { background, onFill } = fillFor(cell.utilisation);
    const hasRoster = cell.rosteredMinutes > 0;
    // Nothing rostered here, but appointments all the same: demand standing
    // outside any shift, which is a finding rather than an empty cell.
    const orphans = cell.booked + cell.notRostered;
    const label = `${cell.specialty} · ${bracketLabel}`;

    return (
      <td
        key={`${cell.specialty}-${cell.bracketStart}`}
        className={`cap-bracket-cell${isTotal ? ' is-total' : ''}${hasRoster ? '' : ' is-unrostered'}`}
        style={{ background }}
        onMouseEnter={show(cell, bracketLabel)}
        onMouseLeave={() => setHover(null)}
        title={
          hasRoster
            ? `${label}: ${cell.utilisation?.toFixed(0)}% of ${hours(cell.rosteredMinutes).toFixed(1)} rostered hours`
            : orphans > 0
              ? `${label}: ${orphans} booked with no rostered time`
              : `${label}: nothing rostered, nothing booked`
        }
      >
        {hasRoster ? (
          <span style={{ color: onFill ? '#fff' : 'var(--text)', fontWeight: onFill ? 600 : 500 }}>
            {cell.utilisation?.toFixed(0)}%
          </span>
        ) : orphans > 0 ? (
          <span className="cap-bracket-orphan">{orphans.toLocaleString()}</span>
        ) : (
          <span className="cap-bracket-void">·</span>
        )}
      </td>
    );
  };

  return (
    <div className="cap-chart-wrap" ref={wrapRef}>
      <div className="cap-bracket-scale">
        <span>Idle</span>
        <span className="cap-bracket-ramp" aria-hidden="true" />
        <span>Over capacity</span>
        <span className="cap-bracket-scale-ticks">0% · 100% · 150%+</span>
      </div>

      <div className="table-wrap">
        <table className="cap-bracket-grid">
          <caption className="sr-only">
            Utilisation by specialty and two-hour bracket. Each cell is booked time divided by the
            time rostered inside that bracket.
          </caption>
          <thead>
            <tr>
              <th scope="col">Specialty</th>
              {brackets.map((bracket) => (
                <th key={bracket.start} scope="col" className="num" title={bracket.label}>
                  {bracket.shortLabel}
                </th>
              ))}
              <th scope="col" className="num">
                All day
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.specialty}>
                <th scope="row">
                  {row.specialty}
                  <span className="cap-bracket-sub">
                    {hours(row.total.rosteredMinutes).toFixed(0)} h · {row.total.doctors}{' '}
                    {row.total.doctors === 1 ? 'doctor' : 'doctors'}
                  </span>
                </th>
                {row.cells.map((cell, index) => renderCell(cell, brackets[index].label, false))}
                {renderCell(row.total, 'All brackets', true)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All specialties</th>
              {columnTotals.map((cell, index) => renderCell(cell, brackets[index].label, true))}
              {renderCell(grandTotal, 'All brackets', true)}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
        A percentage is booked time over the time rostered inside that bracket. A{' '}
        <span className="cap-bracket-orphan">blue number</span> is appointments booked in a bracket
        with nothing rostered in it — demand with no shift behind it, which has no percentage to
        report. A dot means nothing rostered and nothing booked.
      </p>

      {hover && (
        <div
          className="cap-tooltip"
          style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 10px))' }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hover.cell.specialty}</div>
          <div className="muted" style={{ marginBottom: 6 }}>{hover.label}</div>
          <div className="cap-tooltip-row">
            <span>Rostered</span>
            <span className="cap-tooltip-num">
              {hours(hover.cell.rosteredMinutes).toFixed(1)} h · {hover.cell.slots.toLocaleString()} slots
            </span>
          </div>
          <div className="cap-tooltip-row">
            <span>Booked against roster</span>
            <span className="cap-tooltip-num">{hover.cell.booked.toLocaleString()}</span>
          </div>
          <div className="cap-tooltip-row">
            <span>Utilisation</span>
            <span className="cap-tooltip-num">
              {hover.cell.utilisation == null ? '—' : `${hover.cell.utilisation.toFixed(1)}%`}
            </span>
          </div>
          <div className="cap-tooltip-row">
            <span>Completed</span>
            <span className="cap-tooltip-num">{hover.cell.completed.toLocaleString()}</span>
          </div>
          <div className="cap-tooltip-row">
            <span>Cancelled / no-show</span>
            <span className="cap-tooltip-num">
              {hover.cell.canceled.toLocaleString()} / {hover.cell.noShow.toLocaleString()}
            </span>
          </div>
          <div className="cap-tooltip-row">
            <span>Slots never booked</span>
            <span className="cap-tooltip-num">{hover.cell.unbookedSlots.toLocaleString()}</span>
          </div>
          {hover.cell.notRostered > 0 && (
            <div className="cap-tooltip-row">
              <span>Booked, not rostered</span>
              <span className="cap-tooltip-num">{hover.cell.notRostered.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
