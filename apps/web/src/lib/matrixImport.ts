// Parser for the 2D championship-setup matrix: section columns across (each a
// "Name" + "Phone Number" pair) and sport/discipline rows down, with a top
// "Overall" block for section-level POCs. SheetJS flattens merged cells to their
// top-left value, so we forward-fill the merged section labels (header row) and the
// merged category column (down each row group). Output feeds the matrix-import API.

export interface MatrixPerson { name: string; phone: string }
export interface MatrixTeam { section: string; captain?: MatrixPerson; poc?: MatrixPerson }
export interface MatrixUnit { sport: string; discipline: string | null; teams: MatrixTeam[] }
export interface ParsedMatrix {
  sections: string[];
  owners: Array<{ section: string } & MatrixPerson>;
  units: MatrixUnit[];
  warnings: string[];
}

const norm = (s?: string) => (s ?? '').trim();
const low = (s?: string) => norm(s).toLowerCase();

// "Basketball (Men)" -> { sport: 'Basketball', discipline: 'Men' }; "Badminton" -> null discipline.
function splitSportDiscipline(label: string): { sport: string; discipline: string | null } {
  const m = label.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) return { sport: m[1].trim(), discipline: m[2].trim() || null };
  return { sport: label.trim(), discipline: null };
}

export function parseChampionshipMatrix(matrix: string[][]): ParsedMatrix {
  const warnings: string[] = [];
  const width = matrix.reduce((w, r) => Math.max(w, r.length), 0);
  const cell = (r: number, c: number) => norm(matrix[r]?.[c]);

  // Locate the sub-header row that carries the "Name / Phone Number" labels.
  let subRow = -1;
  for (let r = 0; r < Math.min(matrix.length, 8); r++) {
    const joined = (matrix[r] ?? []).map(low).join('|');
    if (/name/.test(joined) && /phone/.test(joined)) { subRow = r; break; }
  }
  if (subRow === -1) {
    warnings.push('Could not find a "Name / Phone Number" header row.');
    return { sections: [], owners: [], units: [], warnings };
  }

  // Section column pairs from the sub-header; the section name sits in the row above.
  let firstNameCol = -1;
  const sectionCols: Array<{ name: string; nameCol: number; phoneCol: number }> = [];
  for (let c = 0; c < width; c++) {
    if (/name/.test(low(cell(subRow, c)))) {
      if (firstNameCol === -1) firstNameCol = c;
      const phoneCol = c + 1;
      const labelAbove = cell(subRow - 1, c);
      const name = labelAbove || `Section ${sectionCols.length + 1}`;
      if (!labelAbove) warnings.push(`Section column ${c + 1} has no name; using "${name}".`);
      sectionCols.push({ name, nameCol: c, phoneCol });
      c = phoneCol; // skip the phone column we just paired
    }
  }
  if (sectionCols.length === 0) {
    warnings.push('No section columns found in the header.');
    return { sections: [], owners: [], units: [], warnings };
  }

  const categoryCol = 0;                          // sport/discipline or "Overall"
  const roleCol = Math.max(0, firstNameCol - 1);  // Captain / POC / Overall POC (…)

  const owners: ParsedMatrix['owners'] = [];
  const unitMap = new Map<string, MatrixUnit>();          // key: sport||discipline
  const teamMap = new Map<string, MatrixTeam>();          // key: unitKey||section

  let lastCategory = '';
  for (let r = subRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    if (row.every((x) => norm(x) === '')) continue;
    const cat = cell(r, categoryCol) || lastCategory;     // forward-fill merged category
    lastCategory = cat;
    const role = cell(r, roleCol);
    if (!cat && !role) continue;

    const isOverall = low(cat).startsWith('overall');
    let unitKey = '';
    let unit: MatrixUnit | undefined;
    if (!isOverall) {
      const { sport, discipline } = splitSportDiscipline(cat);
      unitKey = `${sport.toLowerCase()}||${(discipline ?? '').toLowerCase()}`;
      unit = unitMap.get(unitKey);
      if (!unit) { unit = { sport, discipline, teams: [] }; unitMap.set(unitKey, unit); }
    }

    const roleLow = low(role);
    const memberKind: 'captain' | 'poc' | null = isOverall
      ? null
      : roleLow.includes('captain') ? 'captain' : roleLow.includes('poc') ? 'poc' : null;
    if (!isOverall && !memberKind) {
      warnings.push(`Row ${r + 1}: unrecognized role "${role}" under "${cat}" - skipped.`);
      continue;
    }

    for (const sc of sectionCols) {
      const name = cell(r, sc.nameCol);
      const phone = cell(r, sc.phoneCol);
      if (!phone) {
        if (name) warnings.push(`${sc.name} · ${cat} · ${role || 'Overall'}: "${name}" has no phone - skipped.`);
        continue;
      }
      if (isOverall) {
        owners.push({ section: sc.name, name, phone });
      } else {
        const tk = `${unitKey}||${sc.name.toLowerCase()}`;
        let team = teamMap.get(tk);
        if (!team) { team = { section: sc.name }; teamMap.set(tk, team); unit!.teams.push(team); }
        team[memberKind!] = { name, phone };
      }
    }
  }

  return { sections: sectionCols.map((s) => s.name), owners, units: [...unitMap.values()], warnings };
}
