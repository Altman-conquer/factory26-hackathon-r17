import { describe, expect, test } from 'vitest';
import {
  computeDisplayValues,
  evaluateFormula,
  adjustFormulaReferences,
  adjustFormulaForRowInsert,
  adjustFormulaForRowDelete,
  adjustFormulaForColumnInsert,
  adjustFormulaForColumnDelete,
} from '../src/lib/formula.js';

describe('formula engine', () => {
  test('evaluates basic arithmetic, parentheses, functions, and absolute references', () => {
    const getCell = (row, col) => ({ value: String(row * 10 + col) });
    expect(evaluateFormula('=(1+2)*3', getCell, { maxRow: 10, maxCol: 10 })).toBe('9');
    expect(evaluateFormula('=SUM(1,2,3)', getCell, { maxRow: 10, maxCol: 10 })).toBe('6');
    expect(evaluateFormula('=AVERAGE(1,2,3,4)', getCell, { maxRow: 10, maxCol: 10 })).toBe('2.5');
    expect(evaluateFormula('=$A$1+$B$1', (row, col) => ({ value: String(col) }), { maxRow: 10, maxCol: 10 })).toBe('3');
    expect(evaluateFormula('=sum(a1:a3)', (row) => ({ value: String(row) }), { maxRow: 10, maxCol: 10 })).toBe('6');
  });

  test('aggregates ignore empty and nonnumeric cells and COUNT counts only numeric cells', () => {
    const cells = [
      { row: 1, column: 1, value: '2' },
      { row: 1, column: 2, value: '3' },
      { row: 1, column: 3, value: '' },
      { row: 1, column: 4, value: 'text' },
      { row: 1, column: 5, value: '=SUM(A1:D1)' },
      { row: 1, column: 6, value: '=AVERAGE(A1:D1)' },
      { row: 1, column: 7, value: '=COUNT(A1:D1)' },
      { row: 1, column: 8, value: '=MIN(A1:D1)' },
      { row: 1, column: 9, value: '=MAX(A1:D1)' },
    ];
    const display = computeDisplayValues(cells, 10, 10);
    expect(display.get('1:5')).toBe('5');
    expect(display.get('1:6')).toBe('2.5');
    expect(display.get('1:7')).toBe('2');
    expect(display.get('1:8')).toBe('2');
    expect(display.get('1:9')).toBe('3');
  });

  test('returns stable error values including circular #REF! and bounds #REF!', () => {
    const cells = [
      { row: 1, column: 1, value: '1' },
      { row: 1, column: 2, value: '0' },
      { row: 1, column: 3, value: '=A1/B1' },
      { row: 1, column: 4, value: '=UNKNOWN(A1)' },
      { row: 1, column: 5, value: '=A1+' },
      { row: 1, column: 6, value: '=Z99' },
      { row: 1, column: 7, value: '=H1' },
      { row: 1, column: 8, value: '=G1' },
    ];
    const display = computeDisplayValues(cells, 10, 10);
    expect(display.get('1:3')).toBe('#DIV/0!');
    expect(display.get('1:4')).toBe('#NAME?');
    expect(display.get('1:5')).toBe('#ERROR!');
    expect(display.get('1:6')).toBe('#REF!');
    expect(display.get('1:7')).toBe('#REF!');
    expect(display.get('1:8')).toBe('#REF!');
  });

  test('resolves workbook named ranges in formulas', () => {
    const cells = [
      { row: 3, column: 10, value: '18' },
      { row: 4, column: 10, value: '24' },
      { row: 5, column: 10, value: '31' },
      { row: 3, column: 12, value: '=SUM(CapacityPlan)' },
    ];
    const display = computeDisplayValues(cells, 10, 12, {
      CapacityPlan: 'ForecastModel!J3:J5',
    });
    expect(display.get('3:12')).toBe('73');
  });

  test('adjusts relative and absolute references for copy and structure changes', () => {
    expect(adjustFormulaReferences('=A1+$B$2', 1, 0)).toBe('=A2+$B$2');
    expect(adjustFormulaReferences('=A1+B1', 0, -1)).toBe('=#REF!');
    expect(adjustFormulaForRowInsert('=A5+B5', 5)).toBe('=A6+B6');
    expect(adjustFormulaForRowDelete('=A5+B5', 5)).toBe('=#REF!+#REF!');
    expect(adjustFormulaForColumnInsert('=A5+B5', 2)).toBe('=A5+C5');
    expect(adjustFormulaForColumnDelete('=B5+C5', 2)).toBe('=#REF!+B5');
  });
});
