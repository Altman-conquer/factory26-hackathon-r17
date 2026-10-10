const CELL_REF_RE = /(\$?)([A-Za-z]+)(\$?)(\d+)/g;

function isFormula(value) {
  return typeof value === 'string' && value.startsWith('=');
}

function columnLettersToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return n;
}

function indexToColumnLetters(index) {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseCellRef(text) {
  const match = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(text.trim());
  if (!match) return null;
  return {
    col: columnLettersToIndex(match[2]),
    row: Number(match[4]),
    colAbsolute: match[1] === '$',
    rowAbsolute: match[3] === '$',
  };
}

function formatCellRef(ref) {
  return `${ref.colAbsolute ? '$' : ''}${indexToColumnLetters(ref.col)}${ref.rowAbsolute ? '$' : ''}${ref.row}`;
}

function isNumeric(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return Number.isFinite(value);
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  return trimmed !== '' && Number.isFinite(Number(trimmed));
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  return Number(String(value).trim());
}

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let start = i;
      while (i < n && (/[0-9.]/.test(input[i]))) i += 1;
      tokens.push({ type: 'number', value: input.slice(start, i) });
      continue;
    }
    if (ch === '$' || /[A-Za-z_]/.test(ch)) {
      let start = i;
      while (i < n && /[A-Za-z0-9_$.]/.test(input[i])) i += 1;
      const word = input.slice(start, i);
      if (/^\$?[A-Za-z]+\$?\d+$/.test(word)) {
        tokens.push({ type: 'cell', value: word });
      } else if (word.startsWith('$') || word.includes('$')) {
        tokens.push({ type: 'error', value: '#ERROR!' });
      } else {
        tokens.push({ type: 'ident', value: word });
      }
      continue;
    }
    if (ch === '#') {
      let start = i;
      while (i < n && input[i] !== ' ' && input[i] !== ',' && input[i] !== ')' && input[i] !== '(') i += 1;
      tokens.push({ type: 'error', value: input.slice(start, i) });
      continue;
    }
    if (ch === ':' ) {
      tokens.push({ type: 'colon', value: ':' });
      i += 1;
      continue;
    }
    if ('+-*/(),'.includes(ch)) {
      tokens.push({ type: ch, value: ch });
      i += 1;
      continue;
    }
    // Unknown character: push as error token to avoid infinite loop
    tokens.push({ type: 'error', value: `#ERROR!` });
    i += 1;
  }
  return tokens;
}

function mergeRangeTokens(tokens) {
  const merged = [];
  let i = 0;
  while (i < tokens.length) {
    if (
      tokens[i].type === 'cell' &&
      tokens[i + 1] &&
      tokens[i + 1].type === 'colon' &&
      tokens[i + 2] &&
      tokens[i + 2].type === 'cell'
    ) {
      merged.push({ type: 'range', start: tokens[i].value, end: tokens[i + 2].value });
      i += 3;
      continue;
    }
    merged.push(tokens[i]);
    i += 1;
  }
  return merged;
}

function createParser(tokens) {
  let pos = 0;
  function peek(offset = 0) {
    return tokens[pos + offset] || null;
  }
  function consume(type) {
    const token = peek();
    if (!token || token.type !== type) {
      throw new Error(`Expected ${type}`);
    }
    pos += 1;
    return token;
  }
  function parseExpression() {
    let left = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = consume(peek().type);
      const right = parseTerm();
      left = { type: 'binary', op: op.type, left, right };
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = consume(peek().type);
      const right = parseFactor();
      left = { type: 'binary', op: op.type, left, right };
    }
    return left;
  }
  function parseFactor() {
    const token = peek();
    if (!token) throw new Error('Unexpected end');
    if (token.type === 'number') {
      pos += 1;
      return { type: 'number', value: Number(token.value) };
    }
    if (token.type === 'cell') {
      pos += 1;
      return { type: 'cell', ref: parseCellRef(token.value) };
    }
    if (token.type === 'range') {
      pos += 1;
      return { type: 'range', start: parseCellRef(token.start), end: parseCellRef(token.end) };
    }
    if (token.type === 'error') {
      pos += 1;
      return { type: 'error', value: token.value };
    }
    if (token.type === '-') {
      pos += 1;
      const operand = parseFactor();
      return { type: 'neg', operand };
    }
    if (token.type === '+') {
      pos += 1;
      return parseFactor();
    }
    if (token.type === '(') {
      pos += 1;
      const expr = parseExpression();
      consume(')');
      return expr;
    }
    if (token.type === 'ident') {
      pos += 1;
      const name = token.value.toUpperCase();
      consume('(');
      const args = [];
      if (peek() && peek().type !== ')') {
        args.push(parseExpression());
        while (peek() && peek().type === ',') {
          pos += 1;
          args.push(parseExpression());
        }
      }
      consume(')');
      return { type: 'func', name, args };
    }
    throw new Error(`Unexpected token ${token.type}`);
  }
  return { parseExpression, peek };
}

function evaluateNode(node, ctx) {
  switch (node.type) {
    case 'number':
      return { value: node.value };
    case 'cell': {
      const ref = node.ref;
      if (ref.row < 1 || ref.col < 1 || (ctx.bounds && (ref.row > ctx.bounds.maxRow || ref.col > ctx.bounds.maxCol))) return { error: '#REF!' };
      const raw = ctx.getCell(ref.row, ref.col);
      if (raw && raw.error) return { error: raw.error };
      const value = raw ? raw.value : '';
      if (isNumeric(value)) return { value: toNumber(value) };
      if (value === '' || value === null || value === undefined) return { value: 0 };
      return { error: '#VALUE!' };
    }
    case 'range': {
      const values = [];
      const minRow = Math.min(node.start.row, node.end.row);
      const maxRow = Math.max(node.start.row, node.end.row);
      const minCol = Math.min(node.start.col, node.end.col);
      const maxCol = Math.max(node.start.col, node.end.col);
      if (minRow < 1 || minCol < 1 || (ctx.bounds && (maxRow > ctx.bounds.maxRow || maxCol > ctx.bounds.maxCol))) return { error: '#REF!' };
      for (let r = minRow; r <= maxRow; r += 1) {
        for (let c = minCol; c <= maxCol; c += 1) {
          const raw = ctx.getCell(r, c);
          if (raw && raw.error) {
            // In aggregate, errors are ignored like non-numeric? For COUNT/SUM, ignore error values.
            continue;
          }
          const value = raw ? raw.value : '';
          if (isNumeric(value)) values.push(toNumber(value));
        }
      }
      return { values };
    }
    case 'binary': {
      const left = evaluateNode(node.left, ctx);
      if (left.error) return left;
      const right = evaluateNode(node.right, ctx);
      if (right.error) return right;
      const a = left.value;
      const b = right.value;
      if (node.op === '+') return { value: a + b };
      if (node.op === '-') return { value: a - b };
      if (node.op === '*') return { value: a * b };
      if (node.op === '/') {
        if (b === 0) return { error: '#DIV/0!' };
        return { value: a / b };
      }
      return { error: '#ERROR!' };
    }
    case 'neg': {
      const operand = evaluateNode(node.operand, ctx);
      if (operand.error) return operand;
      return { value: -operand.value };
    }
    case 'func': {
      const args = node.args.map((arg) => evaluateNode(arg, ctx));
      // Flatten range values and numeric scalar args
      const numericValues = [];
      for (const arg of args) {
        if (arg.error) {
          if (node.name === 'COUNT') continue;
          // Most aggregate functions ignore error cells inside ranges; scalar errors propagate.
          // We cannot distinguish scalar vs range error here; treat range errors as ignored.
          if (arg.values) continue;
          return arg;
        }
        if (arg.values) {
          numericValues.push(...arg.values);
        } else if (typeof arg.value === 'number' && Number.isFinite(arg.value)) {
          numericValues.push(arg.value);
        }
      }
      switch (node.name) {
        case 'SUM':
          return { value: numericValues.reduce((sum, v) => sum + v, 0) };
        case 'AVERAGE':
          if (numericValues.length === 0) return { error: '#DIV/0!' };
          return { value: numericValues.reduce((sum, v) => sum + v, 0) / numericValues.length };
        case 'COUNT':
          return { value: numericValues.length };
        case 'MIN':
          if (numericValues.length === 0) return { value: 0 };
          return { value: Math.min(...numericValues) };
        case 'MAX':
          if (numericValues.length === 0) return { value: 0 };
          return { value: Math.max(...numericValues) };
        default:
          return { error: '#NAME?' };
      }
    }
    case 'error':
      return { error: node.value };
    default:
      return { error: '#ERROR!' };
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeNamedRangeReference(rangeText) {
  let text = String(rangeText || '').trim();
  const bangIndex = text.lastIndexOf('!');
  if (bangIndex >= 0) text = text.slice(bangIndex + 1);
  return text.replace(/\$/g, '').trim();
}

function expandNamedRanges(expression, namedRanges = {}) {
  const entries = Object.entries(namedRanges || {})
    .filter(([name, rangeText]) => name && rangeText)
    .sort((a, b) => String(b[0]).length - String(a[0]).length);
  let expanded = String(expression);
  for (const [name, rangeText] of entries) {
    const reference = normalizeNamedRangeReference(rangeText);
    if (!reference) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b(?!\\s*\\()`, 'gi');
    expanded = expanded.replace(pattern, reference);
  }
  return expanded;
}

function evaluateFormula(formula, getCell, bounds, namedRanges = {}) {
  if (!isFormula(formula)) return formula;
  const expression = expandNamedRanges(formula.slice(1).trim(), namedRanges);
  if (!expression) return '#ERROR!';
  try {
    const tokens = mergeRangeTokens(tokenize(expression));
    const parser = createParser(tokens);
    const ast = parser.parseExpression();
    if (parser.peek()) throw new Error('Unexpected trailing tokens');
    const result = evaluateNode(ast, { getCell, bounds });
    if (result.error) return result.error;
    if (typeof result.value === 'number') {
      if (!Number.isFinite(result.value)) return '#NUM!';
      return String(result.value);
    }
    return String(result.value);
  } catch (e) {
    return '#ERROR!';
  }
}

function computeCellValue(row, col, rawMap, memo, visiting, depth = 0, bounds, namedRanges = {}) {
  const key = `${row}:${col}`;
  if (memo.has(key)) return memo.get(key);
  if (visiting.has(key)) return { error: '#REF!' };
  const raw = rawMap.get(key);
  if (raw === undefined || raw === null) return { value: '' };
  if (!isFormula(raw)) {
    const value = raw;
    return { value, numeric: isNumeric(value) };
  }
  visiting.add(key);
  const getCell = (r, c) => {
    if (r < 1 || c < 1 || (bounds && (r > bounds.maxRow || c > bounds.maxCol))) return { error: '#REF!' };
    return computeCellValue(r, c, rawMap, memo, visiting, depth + 1, bounds, namedRanges);
  };
  const result = evaluateFormula(raw, getCell, bounds, namedRanges);
  visiting.delete(key);
  const normalized = typeof result === 'string' && result.startsWith('#') ? { error: result } : { value: result };
  memo.set(key, normalized);
  return normalized;
}

function computeDisplayValues(cells, rowCount, columnCount, namedRanges = {}) {
  const rawMap = new Map();
  for (const cell of cells || []) {
    rawMap.set(`${cell.row}:${cell.column}`, cell.value);
  }
  const bounds = (Number.isInteger(rowCount) && rowCount > 0 && Number.isInteger(columnCount) && columnCount > 0)
    ? { maxRow: rowCount, maxCol: columnCount }
    : null;
  const memo = new Map();
  const visiting = new Set();
  const resultMap = new Map();
  for (const cell of cells || []) {
    const key = `${cell.row}:${cell.column}`;
    const computed = computeCellValue(cell.row, cell.column, rawMap, memo, visiting, 0, bounds, namedRanges);
    if (computed.error) {
      resultMap.set(key, computed.error);
    } else {
      resultMap.set(key, String(computed.value));
    }
  }
  return resultMap;
}

function replaceCellRefs(formula, transform) {
  if (!isFormula(formula)) return formula;
  let changed = false;
  const adjusted = formula.replace(CELL_REF_RE, (match, colAbs, letters, rowAbs, digits) => {
    const col = columnLettersToIndex(letters);
    const row = Number(digits);
    const next = transform({ col, row, colAbs: colAbs === '$', rowAbs: rowAbs === '$', letters, match });
    if (next === match) return match;
    changed = true;
    return next;
  });
  return changed ? adjusted : formula;
}

function adjustFormulaForRowInsert(formula, insertRow) {
  return replaceCellRefs(formula, ({ row, colAbs, rowAbs, letters, match }) => {
    if (row >= insertRow) {
      return `${colAbs ? '$' : ''}${letters}${rowAbs ? '$' : ''}${row + 1}`;
    }
    return match;
  });
}

function adjustFormulaForRowDelete(formula, deleteRow) {
  return replaceCellRefs(formula, ({ row, colAbs, rowAbs, letters, match }) => {
    if (row === deleteRow) return '#REF!';
    if (row > deleteRow) {
      return `${colAbs ? '$' : ''}${letters}${rowAbs ? '$' : ''}${row - 1}`;
    }
    return match;
  });
}

function adjustFormulaForColumnInsert(formula, insertColumn) {
  return replaceCellRefs(formula, ({ col, row, colAbs, rowAbs, match }) => {
    if (col >= insertColumn) {
      return `${colAbs ? '$' : ''}${indexToColumnLetters(col + 1)}${rowAbs ? '$' : ''}${row}`;
    }
    return match;
  });
}

function adjustFormulaForColumnDelete(formula, deleteColumn) {
  return replaceCellRefs(formula, ({ col, row, colAbs, rowAbs, match }) => {
    if (col === deleteColumn) return '#REF!';
    if (col > deleteColumn) {
      return `${colAbs ? '$' : ''}${indexToColumnLetters(col - 1)}${rowAbs ? '$' : ''}${row}`;
    }
    return match;
  });
}

function adjustFormulaReferences(formula, rowOffset, colOffset) {
  if (!isFormula(formula)) return formula;
  let outOfBounds = false;
  const adjusted = formula.replace(CELL_REF_RE, (match, colAbs, letters, rowAbs, digits) => {
    const col = columnLettersToIndex(letters);
    const row = Number(digits);
    const newCol = colAbs ? col : col + colOffset;
    const newRow = rowAbs ? row : row + rowOffset;
    if (newCol < 1 || newRow < 1) {
      outOfBounds = true;
      return match;
    }
    return `${colAbs ? '$' : ''}${indexToColumnLetters(newCol)}${rowAbs ? '$' : ''}${newRow}`;
  });
  if (outOfBounds) return '=#REF!';
  return adjusted;
}

module.exports = {
  isFormula,
  computeDisplayValues,
  evaluateFormula,
  adjustFormulaReferences,
  adjustFormulaForRowInsert,
  adjustFormulaForRowDelete,
  adjustFormulaForColumnInsert,
  adjustFormulaForColumnDelete,
  replaceCellRefs,
  columnLettersToIndex,
  indexToColumnLetters,
  parseCellRef,
  formatCellRef,
  expandNamedRanges,
};
module.exports.tokenize = tokenize;
module.exports.mergeRangeTokens = mergeRangeTokens;
module.exports.createParser = createParser;
