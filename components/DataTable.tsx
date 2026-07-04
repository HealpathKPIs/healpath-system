'use client';
import { useState, useMemo } from 'react';

type Col = { key: string; label: string; num?: boolean; decimals?: number };

function formatCell(value: any, column: Col) {
  if (typeof value === 'number' && column.num) {
    return typeof column.decimals === 'number'
      ? value.toFixed(column.decimals)
      : value.toLocaleString();
  }

  return value;
}

export default function DataTable({ rows, columns, searchable = false, searchKey }:
  { rows: any[]; columns: Col[]; searchable?: boolean; searchKey?: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: columns[columns.length - 1].key, dir: -1 });
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    let r = rows;
    if (searchable && q && searchKey) {
      const t = q.toLowerCase();
      r = r.filter((row) => String(row[searchKey] ?? '').toLowerCase().includes(t));
    }
    return [...r].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb)) * sort.dir;
    });
  }, [rows, q, sort, searchable, searchKey]);

  return (
    <div>
      {searchable && (
        <input className="search" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.num ? 'num' : ''}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) as 1 | -1 : -1 }))}>
                  {c.label}
                  <span className="sort-indicator">
                    {sort.key === c.key ? (sort.dir === 1 ? 'ASC' : 'DESC') : 'SORT'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>
                    {formatCell(row[c.key], c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <div className="table-empty">No rows match the current filters</div>}
      </div>
    </div>
  );
}
