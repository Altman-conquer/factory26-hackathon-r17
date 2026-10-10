import { describe, expect, test } from 'vitest';
import { parseCsv, serializeCsv, CsvParseError } from '../src/lib/csv.js';

describe('CSV parser and serializer', () => {
  test('parses quoted commas, escaped quotes, and embedded newlines', () => {
    const rows = parseCsv('a,"b,c",d\n"line1\nline2","say ""hi""",123');
    expect(rows).toEqual([
      ['a', 'b,c', 'd'],
      ['line1\nline2', 'say "hi"', '123'],
    ]);
  });

  test('preserves empty fields', () => {
    expect(parseCsv('a,,c\n,,\n1,2,3')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['1', '2', '3'],
    ]);
  });

  test('rejects an unclosed quoted field', () => {
    expect(() => parseCsv('"abc,def')).toThrow(CsvParseError);
  });

  test('serializes values that require quoting', () => {
    expect(serializeCsv([['a', 'b,c', 'say "hi"', 'line\nbreak']])).toBe(
      'a,"b,c","say ""hi""","line\nbreak"',
    );
  });
});
