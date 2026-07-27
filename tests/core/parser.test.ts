/**
 * §9.1 parser.test.ts: full Gruppe-A-shaped snippet (neutral operands) parses; operand-
 * type matrix; unknown symbol E-SYM-001 with DE+EN text; case-trap E-SYM-002 with
 * suggestion; duplicate/unknown labels; network markers; W-RES-001 whitelist (§5.1.5):
 * solution-shaped pattern → ZERO warnings, out-of-whitelist writes each warn.
 */
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../src/core';
import { parseProgram } from '../../src/core';
import { makeSymbols } from './fixtures';

const symbols = makeSymbols();

function parse(source: string): ReturnType<typeof parseProgram> {
  return parseProgram(source, symbols);
}

function codes(diags: Diagnostic[]): string[] {
  return diags.map((d) => d.code);
}

describe('full Gruppe-A-shaped snippet (neutral operands)', () => {
  const source = [
    '// Netzwerk 1',
    'U "xR01A"',
    'L S5T#300MS',
    'SV T 10',
    'U T 10',
    '= "xW04BH1G4G"',
    '',
    '// Netzwerk 2: Notaus',
    'UN "NotausBit"',
    'FP M 121.0',
    'S M 120.3',
    '',
    '// Netzwerk 3',
    'U "xR01D"',
    'ZV Z 1',
    'L Z 1',
    'L 3',
    '<I',
    'U "xR01D"',
    'S M 10.0',
  ].join('\n');

  it('parses without errors and with zero W-RES-001', () => {
    const res = parse(source);
    expect(res.program).not.toBeNull();
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(codes(res.diagnostics)).not.toContain('W-RES-001');
  });

  it('produces the expected instruction list and network markers', () => {
    const res = parse(source);
    const prog = res.program!;
    expect(prog.instructions.map((i) => i.op)).toEqual([
      'U', 'L', 'SV', 'U', '=', 'UN', 'FP', 'S', 'U', 'ZV', 'L', 'L', '<I', 'U', 'S',
    ]);
    expect(prog.networks.map((n) => n.index)).toEqual([1, 2, 3]);
    expect(prog.networks[0]).toMatchObject({ line: 1, index: 1 });
    expect(prog.networks[1]?.title).toBe('Notaus');
    expect(prog.source).toBe(source);
  });

  it('resolves quoted symbols to addresses and keeps the source spelling', () => {
    const res = parse('U "xR01A"\n= "xW04BH1G4G"');
    const [u, eq] = res.program!.instructions;
    expect(u?.operand).toMatchObject({
      kind: 'bit', symbol: 'xR01A',
      address: { area: 'E', byte: 1, bit: 4 },
    });
    expect(eq?.operand).toMatchObject({
      kind: 'bit', symbol: 'xW04BH1G4G',
      address: { area: 'M', byte: 100, bit: 5 },
    });
  });
});

describe('operand-type matrix (E-TYP-001)', () => {
  it('SV M 10.0 → E-TYP-001', () => {
    expect(codes(parse('U "xR01A"\nL S5T#300MS\nSV M 10.0').diagnostics)).toContain('E-TYP-001');
  });

  it('U T 10 is ok', () => {
    const res = parse('U T 10\n= M 10.0');
    expect(res.program).not.toBeNull();
    expect(res.program!.instructions[0]?.operand).toEqual({ kind: 'timer', n: 10 });
  });

  it('ZV T 1 → E-TYP-001', () => {
    expect(codes(parse('U "xR01A"\nZV T 1').diagnostics)).toContain('E-TYP-001');
  });

  it.each([
    ['U AW 6'],           // word not a bit test
    ['= T 10'],           // assignment needs a bit
    ['S T 10'],           // S is not valid on timers (only R)
    ['FP T 10'],          // edge operand must be a bit
    ['T M 10.0'],         // transfer needs a word
    ['L "xR01A"'],        // BOOL symbol not loadable
    ['U "FahrstromFB"'],  // block symbol never a valid operand
    ['ZR M 10.0'],
  ])('%s → E-TYP-001', (line) => {
    expect(codes(parse(line).diagnostics)).toContain('E-TYP-001');
  });

  it('valid counterparts stay legal', () => {
    const ok = parse([
      'U "xR01A"', 'L S5T#300MS', 'SS T 10', 'U T 10', 'R T 10',
      'U "xR01A"', 'L C#010', 'S Z 1', 'U "xR01A"', 'R Z 1',
      'L "Fahrstrom"', 'L MW 12', 'L T 10', 'L Z 1', 'T MW 12',
    ].join('\n'));
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('symbols', () => {
  it('unknown symbol → E-SYM-001 with DE+EN text present', () => {
    const res = parse('U "TotallyUnknown"');
    const diag = res.diagnostics.find((d) => d.code === 'E-SYM-001');
    expect(diag).toBeDefined();
    expect(diag!.message.de).toContain('TotallyUnknown');
    expect(diag!.message.en).toContain('TotallyUnknown');
    expect(diag!.message.de).not.toBe(diag!.message.en);
    expect(res.program).toBeNull();
  });

  it('case trap → E-SYM-002 with suggestion hint', () => {
    const res = parse('U "xW03CR"');
    const diag = res.diagnostics.find((d) => d.code === 'E-SYM-002');
    expect(diag).toBeDefined();
    expect(diag!.hint?.de).toContain('XW03CR');
    expect(diag!.hint?.en).toContain('XW03CR');
  });

  it('XW05BH1G3R trap likewise', () => {
    const res = parse('= "xW05BH1G3R"');
    const diag = res.diagnostics.find((d) => d.code === 'E-SYM-002');
    expect(diag?.hint?.de).toContain('XW05BH1G3R');
  });
});

describe('labels and jumps', () => {
  it('forward and backward labels resolve to instruction indices', () => {
    const res = parse('SPA M001\nU "xR01A"\nM001: NOP 0');
    expect(res.program).not.toBeNull();
    expect(res.program!.labels.get('M001')).toBe(2);
    expect(res.program!.instructions[2]?.label).toBe('M001');
  });

  it('label on its own line anchors the next instruction', () => {
    const res = parse('SPA M001\nM001:\nNOP 0');
    expect(res.program).not.toBeNull();
    expect(res.program!.labels.get('M001')).toBe(1);
  });

  it('unknown jump label → E-JMP-001', () => {
    expect(codes(parse('SPA M009').diagnostics)).toContain('E-JMP-001');
  });

  it('duplicate label → E-JMP-002', () => {
    const res = parse('M001: NOP 0\nM001: NOP 0');
    expect(codes(res.diagnostics)).toContain('E-JMP-002');
  });
});

describe('syntax and literal errors', () => {
  it('unknown instruction → E-SYN-001', () => {
    expect(codes(parse('FOO M 1.0').diagnostics)).toContain('E-SYN-001');
  });

  it('missing operand → E-SYN-002', () => {
    expect(codes(parse('U').diagnostics)).toContain('E-SYN-002');
    expect(codes(parse('L').diagnostics)).toContain('E-SYN-002');
  });

  it('operand on an operand-less compare → E-SYN-002', () => {
    expect(codes(parse('L 1\nL 2\n==I M 1.0').diagnostics)).toContain('E-SYN-002');
  });

  it('extra operand → E-SYN-002', () => {
    expect(codes(parse('U M 1.0 M 2.0').diagnostics)).toContain('E-SYN-002');
  });

  it.each([
    ['L S5T#XX'],
    ['L S5T#1MS2S'],
    ['L C#1000'],
    ['L C#ABC'],
    ['L 40000'],       // > 32767
    ['L -32769'],
    ['L 3.5'],         // not an INT
  ])('%s → E-SYN-003', (line) => {
    expect(codes(parse(line).diagnostics)).toContain('E-SYN-003');
  });

  it('malformed vs out-of-range addresses (E-ADR-001 / E-ADR-002)', () => {
    expect(codes(parse('U M 100').diagnostics)).toContain('E-ADR-001');
    expect(codes(parse('U Q 0.0').diagnostics)).toContain('E-ADR-001');
    expect(codes(parse('U M 300.0').diagnostics)).toContain('E-ADR-002');
    expect(codes(parse('U E 16.0').diagnostics)).toContain('E-ADR-002');
    expect(codes(parse('U M 10.9').diagnostics)).toContain('E-ADR-002');
  });

  it('diagnostics carry position info', () => {
    const res = parse('U "xR01A"\nZV T 1');
    const diag = res.diagnostics.find((d) => d.code === 'E-TYP-001');
    expect(diag).toMatchObject({ line: 2, col: 4 });
  });
});

describe('W-RES-001 write-target whitelist (§5.1.5, revised — pedagogy-critical)', () => {
  it('a solution-shaped program produces ZERO W-RES-001 warnings', () => {
    const source = [
      'U "xR01A"',
      '= "xW04BH1G4G"',    // = on a switch coil in M 100–111
      'U "xR01A"',
      'S M 120.3',         // S on the STOP bit
      'R M 120.0',         // R on a speed bit
      'UN "NotausBit"',
      'FP M 121.0',        // NotausNF edge operand
      'S M 10.0',          // student Merker
      'R M 20.0',          // upper end of the student area
      'U "xR01A"',
      'L S5T#300MS',
      'SV T 10',           // student timer range T 10–T 20
      'U "xR01A"',
      'L C#010',
      'S Z 1',             // the student counter
      'U "xR01A"',
      'ZV Z 1',
      'U "xR01A"',
      'R T 20',
    ].join('\n');
    const res = parse(source);
    expect(res.program).not.toBeNull();
    expect(codes(res.diagnostics).filter((c) => c === 'W-RES-001')).toEqual([]);
  });

  it.each([
    ['U "xR01A"\n= M 0.0'],
    ['U "xR01A"\n= M 130.0'],
    ['U "xR01A"\n= E 0.0'],
    ['U "xR01A"\nL S5T#300MS\nSV T 5'],
    ['U "xR01A"\nZV Z 30'],
  ])('%s → exactly one W-RES-001', (source) => {
    const res = parse(source);
    expect(res.program).not.toBeNull();                                  // warning, not error
    expect(codes(res.diagnostics).filter((c) => c === 'W-RES-001')).toHaveLength(1);
  });

  it.each([
    ['U "xR01A"\n= M 20.1'],          // just past M 20.0
    ['U "xR01A"\n= M 120.7'],         // past the speed/STOP bits
    ['U "xR01A"\n= A 4.0'],           // outputs are not student writable
    ['U "xR01A"\nR T 21'],            // past the student timer range
    ['U "xR01A"\nR Z 2'],             // only Z 1 is allowed
    ['L 5\nT AW 6'],                  // AW 6 is written by the system FB, not students
    ['L 5\nT MW 130'],
  ])('%s warns W-RES-001', (source) => {
    expect(codes(parse(source).diagnostics)).toContain('W-RES-001');
  });

  it('T MW 12 (fully inside the student area) does not warn', () => {
    expect(codes(parse('L 5\nT MW 12').diagnostics)).not.toContain('W-RES-001');
  });

  it('reads outside the whitelist never warn', () => {
    const res = parse('U M 0.0\nU T 5\nU Z 30\nL MW 130\n= M 10.0');
    expect(codes(res.diagnostics)).not.toContain('W-RES-001');
  });
});

describe('W-TIM-001 (timer start without time value)', () => {
  it('warns when the string has no L S5T#', () => {
    expect(codes(parse('U "xR01A"\nSV T 10').diagnostics)).toContain('W-TIM-001');
  });

  it('is silent with L S5T# in the same string (both orders)', () => {
    expect(codes(parse('U "xR01A"\nL S5T#300MS\nSV T 10').diagnostics)).not.toContain('W-TIM-001');
    expect(codes(parse('L S5T#300MS\nU "xR01A"\nSV T 10').diagnostics)).not.toContain('W-TIM-001');
  });

  it('warns again after the string ended', () => {
    const res = parse('U "xR01A"\nL S5T#300MS\nSV T 10\nU "xR01D"\nSV T 11');
    expect(codes(res.diagnostics).filter((c) => c === 'W-TIM-001')).toHaveLength(1);
  });
});

describe('W-LOG-001 (assignment with never-set VKE)', () => {
  it('warns on = before any VKE-setting instruction', () => {
    expect(codes(parse('= M 10.0').diagnostics)).toContain('W-LOG-001');
  });

  it('does not warn once a VKE exists (multi-assignment stays legal)', () => {
    const res = parse('U "xR01A"\n= M 10.0\n= M 10.1');
    expect(codes(res.diagnostics)).not.toContain('W-LOG-001');
  });
});

describe('NOP', () => {
  it('parses NOP 0', () => {
    const res = parse('NOP 0');
    expect(res.program).not.toBeNull();
    expect(res.program!.instructions[0]).toMatchObject({ op: 'NOP' });
  });

  it('rejects bare NOP and NOP 5', () => {
    expect(codes(parse('NOP').diagnostics)).toContain('E-SYN-002');
    expect(codes(parse('NOP 5').diagnostics)).toContain('E-SYN-003');
  });
});
