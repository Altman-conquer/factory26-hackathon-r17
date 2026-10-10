class CsvParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CsvParseError';
    this.csvInvalid = true;
  }
}

function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new CsvParseError('Invalid CSV file format. Import failed.');
  }

  // Strip a UTF-8 byte-order mark if present.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldStartedWithQuote = false;

  const pushField = () => {
    row.push(field);
    field = '';
    fieldStartedWithQuote = false;
  };

  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      fieldStartedWithQuote = true;
      continue;
    }

    if (ch === ',') {
      pushField();
      continue;
    }

    if (ch === '\r') {
      // Treat CRLF as one newline; a lone CR is also a row break.
      if (i + 1 < text.length && text[i + 1] === '\n') {
        i += 1;
      }
      pushRow();
      continue;
    }

    if (ch === '\n') {
      pushRow();
      continue;
    }

    field += ch;
  }

  if (inQuotes) {
    throw new CsvParseError('Invalid CSV file format. Import failed.');
  }

  // Always include the final row, even for an empty file this yields one empty cell.
  pushRow();

  // Drop a single trailing empty row caused by a file ending in a newline.
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

function escapeCsvField(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function serializeCsv(rows) {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\n');
}

module.exports = {
  CsvParseError,
  parseCsv,
  escapeCsvField,
  serializeCsv,
};
