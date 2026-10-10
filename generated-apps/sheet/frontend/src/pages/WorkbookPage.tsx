import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getWorkbook,
  renameWorkbook,
  exportWorkbookCsv,
  createWorksheet,
  renameWorksheet,
  deleteWorksheet,
  setActiveWorksheet,
  setWorksheetSelection,
  modifyWorksheetRows,
  modifyWorksheetColumns,
  updateCell,
  writeCells,
  undoWorkbook,
  redoWorkbook,
  sortWorkbookRange,
  createWorkbookFilter,
  clearWorkbookFilter,
  saveWorkbookFilterView,
  applyWorkbookFilterView,
  deleteWorkbookFilterView,
  saveValidationRule,
  deleteValidationRule,
  createPivotTable,
  applyPivotTable,
  refreshPivotTable,
  setWorksheetFreeze,
  createNamedRange,
  updateNamedRange,
  createConditionalFormat,
  updateConditionalFormat,
  deleteConditionalFormat,
  createCellNote,
  updateCellNote,
  deleteCellNote,
  getErrorMessage,
  type Workbook,
  type Worksheet,
  type CellWrite,
  type FilterColumn,
  type FilterConditionType,
  type ValidationRule,
  type ValidationRuleType,
  type FilterView,
  type NamedRange,
  type ConditionalFormat,
  type ConditionalFormatStyle,
  type ConditionalFormatCondition,
  type PivotConfig,
  type SummarizeBy,
} from '../api';
import Combobox from '../components/Combobox';

const MIN_GRID_ROWS = 10;
const MIN_GRID_COLUMNS = 10;

function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cellName(row: number, column: number): string {
  return `${columnName(column)}${row}`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface Point {
  x: number;
  y: number;
}

interface Selection {
  row: number;
  column: number;
  endRow: number;
  endColumn: number;
}

interface ClipboardData {
  type: 'copy' | 'cut';
  range: Selection;
  values: { row: number; column: number; value: string }[];
}

function normalizeSelection(selection: Selection): Selection {
  return {
    row: Math.min(selection.row, selection.endRow),
    column: Math.min(selection.column, selection.endColumn),
    endRow: Math.max(selection.row, selection.endRow),
    endColumn: Math.max(selection.column, selection.endColumn),
  };
}

function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return n;
}

function indexToColumnLetters(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function adjustFormula(formula: string, rowOffset: number, colOffset: number): string {
  if (!formula.startsWith('=')) return formula;
  let outOfBounds = false;
  const adjusted = formula.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)/g, (_match, colAbs: string, letters: string, rowAbs: string, digits: string) => {
    const col = columnLettersToIndex(letters);
    const row = Number(digits);
    const newCol = colAbs ? col : col + colOffset;
    const newRow = rowAbs ? row : row + rowOffset;
    if (newCol < 1 || newRow < 1) {
      outOfBounds = true;
      return _match;
    }
    return `${colAbs ? '$' : ''}${indexToColumnLetters(newCol)}${rowAbs ? '$' : ''}${newRow}`;
  });
  return outOfBounds ? '=#REF!' : adjusted;
}

function parseTabText(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '' && normalized.endsWith('\n')) {
    lines.pop();
  }
  return lines.map((line) => line.split('\t'));
}

const CONDITIONAL_FILL_COLORS: Record<ConditionalFormatStyle, string> = {
  red: 'rgb(254, 226, 226)',
  yellow: 'rgb(254, 249, 195)',
  green: 'rgb(220, 252, 231)',
};

function conditionalFormatMatches(displayValue: string, rule: ConditionalFormat): boolean {
  if (rule.condition === 'greater_than') {
    const numeric = Number(String(displayValue).trim());
    const threshold = Number(String(rule.value).trim());
    return String(displayValue).trim() !== ''
      && Number.isFinite(numeric)
      && Number.isFinite(threshold)
      && numeric > threshold;
  }
  if (rule.condition === 'text_contains') {
    return String(displayValue).includes(String(rule.value));
  }
  return false;
}

function conditionalFillStyle(cellValue: string, worksheet: Worksheet | undefined, row: number, column: number): string | undefined {
  if (!worksheet?.conditionalFormats?.length) return undefined;
  for (const rule of worksheet.conditionalFormats) {
    const minRow = Math.min(rule.startRow, rule.endRow);
    const maxRow = Math.max(rule.startRow, rule.endRow);
    const minColumn = Math.min(rule.startColumn, rule.endColumn);
    const maxColumn = Math.max(rule.startColumn, rule.endColumn);
    if (row >= minRow && row <= maxRow && column >= minColumn && column <= maxColumn
      && conditionalFormatMatches(cellValue, rule)) {
      return CONDITIONAL_FILL_COLORS[rule.style];
    }
  }
  return undefined;
}

function WorkbookPage() {
  const { id } = useParams<{ id: string }>();
  const switchRequestId = useRef(0);
  const selectionsBySheetRef = useRef<Record<number, Selection>>({});
  const editCancelRef = useRef(false);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeWorksheetId, setActiveWorksheetId] = useState<number | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState({ row: 1, column: 1 });
  const [selectionFocus, setSelectionFocus] = useState({ row: 1, column: 1 });
  const [selectionsBySheet, setSelectionsBySheet] = useState<Record<number, Selection>>({});
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [worksheetMenu, setWorksheetMenu] = useState<{ worksheetId: number; point: Point } | null>(null);
  const [renameWorksheetOpen, setRenameWorksheetOpen] = useState(false);
  const [renameWorksheetName, setRenameWorksheetName] = useState('');
  const [renameWorksheetError, setRenameWorksheetError] = useState('');
  const [renameWorksheetSourceId, setRenameWorksheetSourceId] = useState<number | null>(null);
  const [renamingWorksheet, setRenamingWorksheet] = useState(false);
  const [deleteWorksheetOpen, setDeleteWorksheetOpen] = useState(false);
  const [deleteWorksheetSourceId, setDeleteWorksheetSourceId] = useState<number | null>(null);
  const [deletingWorksheet, setDeletingWorksheet] = useState(false);
  const [deleteWorksheetError, setDeleteWorksheetError] = useState('');
  const [rowMenu, setRowMenu] = useState<{ row: number; point: Point } | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ column: number; point: Point } | null>(null);
  const [structureError, setStructureError] = useState('');
  const [structureBusy, setStructureBusy] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [editingCell, setEditingCell] = useState<{ row: number; column: number; draft: string } | null>(null);
  const [formulaDraft, setFormulaDraft] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [cellMenu, setCellMenu] = useState<{ row: number; column: number; point: Point } | null>(null);
  const [dataMenu, setDataMenu] = useState<Point | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortByColumn, setSortByColumn] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [sortHasHeader, setSortHasHeader] = useState(true);
  const [sortError, setSortError] = useState('');
  const [sorting, setSorting] = useState(false);
  const [filterDialog, setFilterDialog] = useState<{
    column: number;
    condition: FilterConditionType;
    conditionValue: string;
    selectedValues: string[];
  } | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const [saveFilterViewOpen, setSaveFilterViewOpen] = useState(false);
  const [saveFilterViewName, setSaveFilterViewName] = useState('');
  const [saveFilterViewError, setSaveFilterViewError] = useState('');
  const [saveFilterViewBusy, setSaveFilterViewBusy] = useState(false);
  const [filterViewsOpen, setFilterViewsOpen] = useState(false);
  const [selectedFilterViewId, setSelectedFilterViewId] = useState<number | null>(null);
  const [filterViewsBusy, setFilterViewsBusy] = useState(false);
  const [filterViewsError, setFilterViewsError] = useState('');
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationRuleType, setValidationRuleType] = useState<ValidationRuleType>('dropdown');
  const [validationAllowedValues, setValidationAllowedValues] = useState('');
  const [validationMinimum, setValidationMinimum] = useState('');
  const [validationMaximum, setValidationMaximum] = useState('');
  const [validationRuleId, setValidationRuleId] = useState<number | null>(null);
  const [validationErrorMessage, setValidationErrorMessage] = useState('');
  const [validationError, setValidationError] = useState('');
  const [validationSaving, setValidationSaving] = useState(false);
  const [dropdownOpenFor, setDropdownOpenFor] = useState<{ row: number; column: number } | null>(null);
  const [pivotCreateOpen, setPivotCreateOpen] = useState(false);
  const [pivotError, setPivotError] = useState('');
  const [pivotBusy, setPivotBusy] = useState(false);
  const [pivotRowField, setPivotRowField] = useState<number | null>(null);
  const [pivotColumnField, setPivotColumnField] = useState<number | null>(null);
  const [pivotValueField, setPivotValueField] = useState<number | null>(null);
  const [pivotSummarizeBy, setPivotSummarizeBy] = useState<SummarizeBy>('SUM');
  const [viewMenu, setViewMenu] = useState<Point | null>(null);
  const [editMenu, setEditMenu] = useState<Point | null>(null);
  const [formatMenu, setFormatMenu] = useState<Point | null>(null);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [findStatus, setFindStatus] = useState('');
  const [findMatches, setFindMatches] = useState<{ row: number; column: number }[]>([]);
  const [findIndex, setFindIndex] = useState(-1);
  const [namedRangesOpen, setNamedRangesOpen] = useState(false);
  const [namedRangeFormOpen, setNamedRangeFormOpen] = useState(false);
  const [namedRangeName, setNamedRangeName] = useState('');
  const [namedRangeValue, setNamedRangeValue] = useState('');
  const [editingNamedRangeId, setEditingNamedRangeId] = useState<number | null>(null);
  const [namedRangeError, setNamedRangeError] = useState('');
  const [namedRangeBusy, setNamedRangeBusy] = useState(false);
  const [conditionalOpen, setConditionalOpen] = useState(false);
  const [conditionalRuleId, setConditionalRuleId] = useState<number | null>(null);
  const [conditionalRange, setConditionalRange] = useState<Selection | null>(null);
  const [conditionalCondition, setConditionalCondition] = useState<ConditionalFormatCondition>('greater_than');
  const [conditionalValue, setConditionalValue] = useState('');
  const [conditionalStyle, setConditionalStyle] = useState<ConditionalFormatStyle>('red');
  const [conditionalError, setConditionalError] = useState('');
  const [conditionalBusy, setConditionalBusy] = useState(false);
  const [insertMenu, setInsertMenu] = useState<Point | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteCell, setNoteCell] = useState<{ row: number; column: number } | null>(null);
  const [noteId, setNoteId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      setLoadError('');
      const loaded = await getWorkbook(id);
      setWorkbook(loaded);
      const activeId = loaded.activeWorksheetId ?? loaded.worksheets[0]?.id ?? null;
      setActiveWorksheetId(activeId);
      const nextSelections: Record<number, Selection> = {};
      for (const sheet of loaded.worksheets) {
        nextSelections[sheet.id] = {
          row: sheet.selectedRow || 1,
          column: sheet.selectedColumn || 1,
          endRow: sheet.selectedEndRow || sheet.selectedRow || 1,
          endColumn: sheet.selectedEndColumn || sheet.selectedColumn || 1,
        };
      }
      selectionsBySheetRef.current = nextSelections;
      setSelectionsBySheet(nextSelections);
      const active = loaded.worksheets.find((sheet) => sheet.id === activeId) ?? loaded.worksheets[0];
      if (active) {
        const selection = nextSelections[active.id] || { row: 1, column: 1, endRow: 1, endColumn: 1 };
        setSelectionAnchor({ row: selection.row, column: selection.column });
        setSelectionFocus({ row: selection.endRow, column: selection.endColumn });
      }
      setIsMouseDown(false);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeWorksheet: Worksheet | undefined = useMemo(() => {
    if (!workbook) return undefined;
    return workbook.worksheets.find((sheet) => sheet.id === activeWorksheetId) ?? workbook.worksheets[0];
  }, [workbook, activeWorksheetId]);

  function syncPivotEditorFromWorksheet(sheet?: Worksheet) {
    const pivot = sheet?.pivot;
    setPivotRowField(pivot?.rowField ?? null);
    setPivotColumnField(pivot?.columnField ?? null);
    setPivotValueField(pivot?.valueField ?? null);
    setPivotSummarizeBy((pivot?.summarizeBy as SummarizeBy) || 'SUM');
  }

  useEffect(() => {
    syncPivotEditorFromWorksheet(activeWorksheet);
  }, [activeWorksheet?.id, activeWorksheet?.pivot?.id, activeWorksheet?.pivot?.rowField, activeWorksheet?.pivot?.columnField, activeWorksheet?.pivot?.valueField, activeWorksheet?.pivot?.summarizeBy]);

  const gridRows = useMemo(() => {
    if (!activeWorksheet) return MIN_GRID_ROWS;
    const usedRows = activeWorksheet.cells.reduce((max, cell) => Math.max(max, cell.row), 0);
    return Math.max(activeWorksheet.rowCount || MIN_GRID_ROWS, usedRows);
  }, [activeWorksheet]);

  const gridColumns = useMemo(() => {
    if (!activeWorksheet) return MIN_GRID_COLUMNS;
    const usedColumns = activeWorksheet.cells.reduce((max, cell) => Math.max(max, cell.column), 0);
    return Math.max(activeWorksheet.columnCount || MIN_GRID_COLUMNS, usedColumns);
  }, [activeWorksheet]);

  const visibleRows = useMemo(() => {
    const rows: number[] = [];
    if (!activeWorksheet) return rows;
    for (let row = 1; row <= gridRows; row += 1) {
      if (isRowVisible(row)) rows.push(row);
    }
    return rows;
  }, [activeWorksheet, gridRows]);

  const selectedValue = useMemo(() => {
    if (!activeWorksheet) return '';
    const cell = activeWorksheet.cells.find(
      (item) => item.row === selectionFocus.row && item.column === selectionFocus.column,
    );
    return cell?.value ?? '';
  }, [activeWorksheet, selectionFocus]);

  function isCellSelected(row: number, column: number): boolean {
    const minRow = Math.min(selectionAnchor.row, selectionFocus.row);
    const maxRow = Math.max(selectionAnchor.row, selectionFocus.row);
    const minColumn = Math.min(selectionAnchor.column, selectionFocus.column);
    const maxColumn = Math.max(selectionAnchor.column, selectionFocus.column);
    return row >= minRow && row <= maxRow && column >= minColumn && column <= maxColumn;
  }

  function selectionForSheet(sheet: Worksheet | undefined): Selection {
    if (!sheet) return { row: 1, column: 1, endRow: 1, endColumn: 1 };
    const local = selectionsBySheetRef.current[sheet.id];
    return local || {
      row: sheet.selectedRow || 1,
      column: sheet.selectedColumn || 1,
      endRow: sheet.selectedEndRow || sheet.selectedRow || 1,
      endColumn: sheet.selectedEndColumn || sheet.selectedColumn || 1,
    };
  }

  function applyWorksheetSelection(sheet: Worksheet | undefined) {
    const selection = selectionForSheet(sheet);
    setSelectionAnchor({ row: selection.row, column: selection.column });
    setSelectionFocus({ row: selection.endRow, column: selection.endColumn });
  }

  function rememberSelection(sheetId: number, selection: Selection) {
    selectionsBySheetRef.current = { ...selectionsBySheetRef.current, [sheetId]: selection };
    setSelectionsBySheet((current) => ({ ...current, [sheetId]: selection }));
  }

  function applyUpdatedWorkbook(updated: Workbook) {
    setWorkbook(updated);
    const activeId = updated.activeWorksheetId ?? updated.worksheets[0]?.id ?? null;
    setActiveWorksheetId(activeId);
    const nextSelections: Record<number, Selection> = {};
    for (const sheet of updated.worksheets) {
      nextSelections[sheet.id] = {
        row: sheet.selectedRow || 1,
        column: sheet.selectedColumn || 1,
        endRow: sheet.selectedEndRow || sheet.selectedRow || 1,
        endColumn: sheet.selectedEndColumn || sheet.selectedColumn || 1,
      };
    }
    selectionsBySheetRef.current = nextSelections;
    setSelectionsBySheet(nextSelections);
    const active = updated.worksheets.find((sheet) => sheet.id === activeId) ?? updated.worksheets[0];
    if (active) applyWorksheetSelection(active);
  }

  async function commitCellWrite(row: number, column: number, value: string) {
    if (!activeWorksheet || !id) return;
    try {
      setOperationError('');
      const updated = await updateCell(id, activeWorksheet.id, row, column, value);
      applyUpdatedWorkbook(updated);
      setEditingCell(null);
      setFormulaDraft(null);
      editCancelRef.current = false;
    } catch (error) {
      setOperationError(getErrorMessage(error));
      setEditingCell(null);
      setFormulaDraft(null);
      editCancelRef.current = false;
    }
  }

  async function commitBulkWrite(cells: CellWrite[]) {
    if (!activeWorksheet || !id) return;
    try {
      setOperationError('');
      const updated = await writeCells(id, activeWorksheet.id, cells);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setOperationError(getErrorMessage(error));
    }
  }

  function handleCellPointerDown(row: number, column: number, event: ReactMouseEvent) {
    if (!activeWorksheet || !id) return;
    setDropdownOpenFor(null);
    if (event.button !== 0) {
      if (event.button === 2 && !isCellSelected(row, column)) {
        setSelectionAnchor({ row, column });
        setSelectionFocus({ row, column });
        const selection: Selection = { row, column, endRow: row, endColumn: column };
        rememberSelection(activeWorksheet.id, selection);
        void setWorksheetSelection(id, activeWorksheet.id, row, column, row, column).catch((error) => {
          console.error(getErrorMessage(error));
        });
      }
      return;
    }
    if (editingCell) {
      const pending = editingCell;
      setEditingCell(null);
      void commitCellWrite(pending.row, pending.column, pending.draft);
    }
    if (formulaDraft !== null) {
      const pendingValue = formulaDraft;
      const pendingRow = selectionFocus.row;
      const pendingColumn = selectionFocus.column;
      setFormulaDraft(null);
      void commitCellWrite(pendingRow, pendingColumn, pendingValue);
    }
    let anchor = { row: selectionAnchor.row, column: selectionAnchor.column };
    let focus = { row, column };
    if (event.shiftKey) {
      focus = { row, column };
    } else {
      anchor = { row, column };
      focus = { row, column };
    }
    setSelectionAnchor(anchor);
    setSelectionFocus(focus);
    setIsMouseDown(true);

    const selection: Selection = { row: anchor.row, column: anchor.column, endRow: focus.row, endColumn: focus.column };
    rememberSelection(activeWorksheet.id, selection);
    void setWorksheetSelection(id, activeWorksheet.id, anchor.row, anchor.column, focus.row, focus.column).catch((error) => {
      console.error(getErrorMessage(error));
    });
  }

  function handleCellMouseEnter(row: number, column: number) {
    if (!isMouseDown || !activeWorksheet || !id) return;
    const focus = { row, column };
    setSelectionFocus(focus);
    const selection: Selection = { row: selectionAnchor.row, column: selectionAnchor.column, endRow: row, endColumn: column };
    rememberSelection(activeWorksheet.id, selection);
    void setWorksheetSelection(id, activeWorksheet.id, selection.row, selection.column, selection.endRow, selection.endColumn).catch((error) => {
      console.error(getErrorMessage(error));
    });
  }

  function handleCellDoubleClick(row: number, column: number) {
    if (!activeWorksheet) return;
    const cell = activeWorksheet.cells.find((item) => item.row === row && item.column === column);
    editCancelRef.current = false;
    setEditingCell({ row, column, draft: cell?.value ?? '' });
  }

  function handleCellKeyDown(row: number, column: number, event: KeyboardEvent) {
    if (editingCell) return;
    if (event.key === 'F2') {
      event.preventDefault();
      handleCellDoubleClick(row, column);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const cell = activeWorksheet?.cells.find((item) => item.row === row && item.column === column);
      editCancelRef.current = false;
      setEditingCell({ row, column, draft: event.key });
    }
  }

  function handleTabKeyDown(event: KeyboardEvent, sheetId: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void handleSwitchWorksheet(sheetId);
    }
  }

  async function handleSwitchWorksheet(sheetId: number) {
    if (!workbook || !id) return;
    const target = workbook.worksheets.find((sheet) => sheet.id === sheetId);
    if (!target) return;

    const requestId = ++switchRequestId.current;
    setActiveWorksheetId(sheetId);
    applyWorksheetSelection(target);
    setStructureError('');

    try {
      await setActiveWorksheet(id, sheetId);
      if (requestId !== switchRequestId.current) return;
    } catch (error) {
      if (requestId !== switchRequestId.current) return;
      setStructureError(getErrorMessage(error));
      const loaded = await getWorkbook(id);
      if (requestId !== switchRequestId.current) return;
      setWorkbook(loaded);
      const activeId = loaded.activeWorksheetId ?? loaded.worksheets[0]?.id ?? null;
      setActiveWorksheetId(activeId);
      applyWorksheetSelection(loaded.worksheets.find((sheet) => sheet.id === activeId));
    }
  }

  function openRenameDialog() {
    if (!workbook) return;
    setRenameName(workbook.name);
    setRenameError('');
    setRenameOpen(true);
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workbook || !id) return;
    try {
      setRenaming(true);
      setRenameError('');
      const updated = await renameWorkbook(id, renameName);
      setWorkbook(updated);
      setRenameOpen(false);
    } catch (error) {
      const message = getErrorMessage(error);
      setRenameName(workbook.name);
      if (message === 'Workbook name cannot be empty') {
        setRenameError('Workbook name cannot be empty');
      } else {
        setRenameError(message);
      }
    } finally {
      setRenaming(false);
    }
  }

  async function handleExport() {
    if (!workbook || !id || !activeWorksheet) return;
    try {
      setExporting(true);
      setExportError('');
      const { blob, fileName } = await exportWorkbookCsv(id, activeWorksheet.id);
      triggerDownload(blob, fileName);
    } catch (error) {
      setExportError(getErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  async function handleAddWorksheet() {
    if (!id) return;
    try {
      setStructureBusy(true);
      setStructureError('');
      const updated = await createWorksheet(id);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setStructureError(getErrorMessage(error));
    } finally {
      setStructureBusy(false);
    }
  }

  function openWorksheetMenu(sheetId: number, event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setWorksheetMenu({ worksheetId: sheetId, point: { x: event.clientX, y: event.clientY } });
  }

  function closeMenus() {
    setWorksheetMenu(null);
    setRowMenu(null);
    setColumnMenu(null);
    setCellMenu(null);
    setDataMenu(null);
    setViewMenu(null);
    setEditMenu(null);
    setFormatMenu(null);
    setInsertMenu(null);
    setDropdownOpenFor(null);
  }

  function handleWorksheetMenuCommand(command: 'rename' | 'delete') {
    if (!worksheetMenu) return;
    const sheet = workbook?.worksheets.find((item) => item.id === worksheetMenu.worksheetId);
    if (!sheet) return;
    closeMenus();

    if (command === 'rename') {
      setRenameWorksheetSourceId(sheet.id);
      setRenameWorksheetName(sheet.name);
      setRenameWorksheetError('');
      setRenameWorksheetOpen(true);
    } else {
      if ((workbook?.worksheets.length || 0) <= 1) {
        setStructureError('A workbook must contain at least one worksheet');
        return;
      }
      setDeleteWorksheetSourceId(sheet.id);
      setDeleteWorksheetError('');
      setDeleteWorksheetOpen(true);
    }
  }

  async function handleRenameWorksheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workbook || !id || !renameWorksheetOpen) return;
    const actualSheetId = renameWorksheetSourceId;
    if (!actualSheetId) return;
    try {
      setRenamingWorksheet(true);
      setRenameWorksheetError('');
      const updated = await renameWorksheet(id, actualSheetId, renameWorksheetName);
      setWorkbook(updated);
      setRenameWorksheetOpen(false);
      setRenameWorksheetSourceId(null);
    } catch (error) {
      const message = getErrorMessage(error);
      const sourceSheet = workbook.worksheets.find((sheet) => sheet.id === actualSheetId);
      if (sourceSheet) {
        setRenameWorksheetName(sourceSheet.name);
      }
      setRenameWorksheetError(message);
    } finally {
      setRenamingWorksheet(false);
    }
  }

  async function handleDeleteWorksheet() {
    if (!workbook || !id || !deleteWorksheetOpen) return;
    const sheetId = deleteWorksheetSourceId;
    if (!sheetId) return;
    try {
      setDeletingWorksheet(true);
      setDeleteWorksheetError('');
      const updated = await deleteWorksheet(id, sheetId);
      setWorkbook(updated);
      setDeleteWorksheetOpen(false);
      setDeleteWorksheetSourceId(null);
      setActiveWorksheetId(updated.activeWorksheetId);
      const active = updated.worksheets.find((sheet) => sheet.id === updated.activeWorksheetId) ?? updated.worksheets[0];
      applyWorksheetSelection(active);
      if (active) rememberSelection(active.id, selectionForSheet(active));
    } catch (error) {
      const message = getErrorMessage(error);
      if (message === 'A workbook must contain at least one worksheet') {
        setDeleteWorksheetOpen(false);
        setStructureError(message);
      } else {
        setDeleteWorksheetError(message);
      }
    } finally {
      setDeletingWorksheet(false);
    }
  }

  function openRowMenu(row: number, event: ReactMouseEvent) {
    event.preventDefault();
    setRowMenu({ row, point: { x: event.clientX, y: event.clientY } });
  }

  function openColumnMenu(column: number, event: ReactMouseEvent) {
    event.preventDefault();
    setColumnMenu({ column, point: { x: event.clientX, y: event.clientY } });
  }

  async function handleRowCommand(action: 'insertAbove' | 'insertBelow' | 'delete') {
    if (!rowMenu || !activeWorksheet || !id) return;
    const row = rowMenu.row;
    closeMenus();
    try {
      setStructureBusy(true);
      setStructureError('');
      const updated = await modifyWorksheetRows(id, activeWorksheet.id, action, row);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setStructureError(getErrorMessage(error));
    } finally {
      setStructureBusy(false);
    }
  }

  async function handleColumnCommand(action: 'insertLeft' | 'insertRight' | 'delete') {
    if (!columnMenu || !activeWorksheet || !id) return;
    const column = columnMenu.column;
    closeMenus();
    try {
      setStructureBusy(true);
      setStructureError('');
      const updated = await modifyWorksheetColumns(id, activeWorksheet.id, action, column);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setStructureError(getErrorMessage(error));
    } finally {
      setStructureBusy(false);
    }
  }

  async function handleUndo() {
    if (!id) return;
    try {
      setOperationError('');
      const updated = await undoWorkbook(id);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setOperationError(getErrorMessage(error));
    }
  }

  async function handleRedo() {
    if (!id) return;
    try {
      setOperationError('');
      const updated = await redoWorkbook(id);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setOperationError(getErrorMessage(error));
    }
  }


  function openViewMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setViewMenu({ x: event.clientX, y: event.clientY });
    setDataMenu(null);
    setEditMenu(null);
    setFormatMenu(null);
    setInsertMenu(null);
  }

  function openEditMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setEditMenu({ x: event.clientX, y: event.clientY });
    setDataMenu(null);
    setViewMenu(null);
    setFormatMenu(null);
    setInsertMenu(null);
  }

  function openFormatMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setFormatMenu({ x: event.clientX, y: event.clientY });
    setDataMenu(null);
    setViewMenu(null);
    setEditMenu(null);
    setInsertMenu(null);
  }

  function openInsertMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setInsertMenu({ x: event.clientX, y: event.clientY });
    setDataMenu(null);
    setViewMenu(null);
    setEditMenu(null);
    setFormatMenu(null);
  }

  function openAddNote() {
    if (!activeWorksheet) return;
    closeMenus();
    const row = selectionFocus.row;
    const column = selectionFocus.column;
    const existing = (activeWorksheet.notes || []).find(
      (note) => note.row === row && note.column === column,
    );
    if (existing) {
      setNoteId(existing.id);
      setNoteText(existing.text);
      setNoteEditing(false);
    } else {
      setNoteId(null);
      setNoteText('');
      setNoteEditing(true);
    }
    setNoteCell({ row, column });
    setNoteError('');
    setNoteOpen(true);
  }

  function openExistingNote(note: { id: number; row: number; column: number; text: string }) {
    closeMenus();
    setNoteCell({ row: note.row, column: note.column });
    setNoteId(note.id);
    setNoteText(note.text);
    setNoteEditing(false);
    setNoteError('');
    setNoteOpen(true);
  }

  async function handleSaveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !activeWorksheet || !noteCell) return;
    try {
      setNoteBusy(true);
      setNoteError('');
      const updated = noteId
        ? await updateCellNote(id, activeWorksheet.id, noteId, noteText)
        : await createCellNote(id, activeWorksheet.id, noteCell.row, noteCell.column, noteText);
      applyUpdatedWorkbook(updated);
      setNoteOpen(false);
    } catch (error) {
      setNoteError(getErrorMessage(error));
    } finally {
      setNoteBusy(false);
    }
  }

  async function handleDeleteNote() {
    if (!id || !activeWorksheet || !noteId) return;
    try {
      setNoteBusy(true);
      setNoteError('');
      const updated = await deleteCellNote(id, activeWorksheet.id, noteId);
      applyUpdatedWorkbook(updated);
      setNoteOpen(false);
    } catch (error) {
      setNoteError(getErrorMessage(error));
    } finally {
      setNoteBusy(false);
    }
  }

  async function handleFreeze(rows: number, columns: number) {
    closeMenus();
    if (!id || !activeWorksheet) return;
    try {
      setOperationError('');
      const updated = await setWorksheetFreeze(id, activeWorksheet.id, rows, columns);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setOperationError(getErrorMessage(error));
    }
  }

  function openFindReplaceDialog() {
    closeMenus();
    setFindStatus('');
    setFindMatches([]);
    setFindIndex(-1);
    setFindReplaceOpen(true);
  }

  function findMatchingCells(): { row: number; column: number }[] {
    if (!activeWorksheet || !findText) return [];
    const needle = matchCase ? findText : findText.toLowerCase();
    return activeWorksheet.cells
      .filter((cell) => {
        const displayed = String(cell.displayValue ?? cell.value ?? '');
        const comparable = matchCase ? displayed : displayed.toLowerCase();
        return comparable === needle;
      })
      .map((cell) => ({ row: cell.row, column: cell.column }))
      .sort((a, b) => (a.row - b.row) || (a.column - b.column));
  }

  function handleFindNext() {
    if (!id || !activeWorksheet) return;
    const matches = findMatchingCells();
    if (matches.length === 0) {
      setFindMatches([]);
      setFindIndex(-1);
      setFindStatus('No matches');
      return;
    }
    const nextIndex = (findIndex + 1) % matches.length;
    const match = matches[nextIndex];
    setFindMatches(matches);
    setFindIndex(nextIndex);
    setFindStatus(`Match ${nextIndex + 1} of ${matches.length}`);
    setSelectionAnchor({ row: match.row, column: match.column });
    setSelectionFocus({ row: match.row, column: match.column });
    rememberSelection(activeWorksheet.id, { row: match.row, column: match.column, endRow: match.row, endColumn: match.column });
    void setWorksheetSelection(id, activeWorksheet.id, match.row, match.column, match.row, match.column).catch((error) => {
      console.error(getErrorMessage(error));
    });
  }

  async function handleReplaceAll() {
    if (!id || !activeWorksheet) return;
    const matches = findMatchingCells();
    if (matches.length === 0) {
      setFindStatus('Replaced 0 cells');
      return;
    }
    try {
      setOperationError('');
      const updated = await writeCells(
        id,
        activeWorksheet.id,
        matches.map((match) => ({ ...match, value: replaceText })),
      );
      applyUpdatedWorkbook(updated);
      setFindIndex(-1);
      setFindStatus(`Replaced ${matches.length} cells`);
    } catch (error) {
      setFindStatus(getErrorMessage(error));
    }
  }

  function openNamedRangesDialog() {
    closeMenus();
    setNamedRangeError('');
    setNamedRangeFormOpen(false);
    setEditingNamedRangeId(null);
    setNamedRangesOpen(true);
  }

  function openAddNamedRangeForm() {
    setEditingNamedRangeId(null);
    setNamedRangeName('');
    setNamedRangeValue('');
    setNamedRangeError('');
    setNamedRangeFormOpen(true);
  }

  function openEditNamedRange(namedRange: NamedRange) {
    setEditingNamedRangeId(namedRange.id);
    setNamedRangeName(namedRange.name);
    setNamedRangeValue(namedRange.range);
    setNamedRangeError('');
    setNamedRangeFormOpen(true);
  }

  async function handleNamedRangeSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    try {
      setNamedRangeBusy(true);
      setNamedRangeError('');
      const updated = editingNamedRangeId
        ? await updateNamedRange(id, editingNamedRangeId, namedRangeValue)
        : await createNamedRange(id, namedRangeName, namedRangeValue);
      applyUpdatedWorkbook(updated);
      setNamedRangesOpen(false);
      setNamedRangeFormOpen(false);
      setEditingNamedRangeId(null);
    } catch (error) {
      setNamedRangeError(getErrorMessage(error));
    } finally {
      setNamedRangeBusy(false);
    }
  }

  function openConditionalFormatDialog(rule?: ConditionalFormat) {
    closeMenus();
    if (rule) {
      setConditionalRuleId(rule.id);
      setConditionalRange({
        row: rule.startRow,
        column: rule.startColumn,
        endRow: rule.endRow,
        endColumn: rule.endColumn,
      });
      setConditionalCondition(rule.condition);
      setConditionalValue(rule.value);
      setConditionalStyle(rule.style);
    } else {
      setConditionalRuleId(null);
      setConditionalRange(getSelectedRange());
      setConditionalCondition('greater_than');
      setConditionalValue('');
      setConditionalStyle('red');
    }
    setConditionalError('');
    setConditionalOpen(true);
  }

  async function handleConditionalFormatSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !activeWorksheet || !conditionalRange) return;
    if (!conditionalValue.trim()) {
      setConditionalError('Value is required');
      return;
    }
    try {
      setConditionalBusy(true);
      setConditionalError('');
      const request = {
        startRow: conditionalRange.row,
        startColumn: conditionalRange.column,
        endRow: conditionalRange.endRow,
        endColumn: conditionalRange.endColumn,
        condition: conditionalCondition,
        value: conditionalValue,
        style: conditionalStyle,
      };
      const updated = conditionalRuleId
        ? await updateConditionalFormat(id, activeWorksheet.id, conditionalRuleId, request)
        : await createConditionalFormat(id, activeWorksheet.id, request);
      applyUpdatedWorkbook(updated);
      setConditionalOpen(false);
      setConditionalRuleId(null);
    } catch (error) {
      setConditionalError(getErrorMessage(error));
    } finally {
      setConditionalBusy(false);
    }
  }

  async function handleConditionalFormatDelete(ruleId: number) {
    if (!id || !activeWorksheet) return;
    try {
      setConditionalBusy(true);
      setConditionalError('');
      const updated = await deleteConditionalFormat(id, activeWorksheet.id, ruleId);
      applyUpdatedWorkbook(updated);
      setConditionalRuleId((current) => (current === ruleId ? null : current));
    } catch (error) {
      setConditionalError(getErrorMessage(error));
    } finally {
      setConditionalBusy(false);
    }
  }

  function openDataMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDataMenu({ x: event.clientX, y: event.clientY });
    setViewMenu(null);
    setEditMenu(null);
    setFormatMenu(null);
    setInsertMenu(null);
  }

  function openSortDialog() {
    const range = getSelectedRange();
    if (!activeWorksheet) return;
    setSortByColumn(range.column);
    setSortOrder('asc');
    setSortHasHeader(true);
    setSortError('');
    setSortOpen(true);
  }

  async function handleSortSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !activeWorksheet || sortByColumn === null) return;
    const range = getSelectedRange();
    try {
      setSorting(true);
      setSortError('');
      const updated = await sortWorkbookRange(id, activeWorksheet.id, {
        startRow: range.row,
        startColumn: range.column,
        endRow: range.endRow,
        endColumn: range.endColumn,
        sortByColumn,
        order: sortOrder,
        hasHeader: sortHasHeader,
      });
      applyUpdatedWorkbook(updated);
      setSortOpen(false);
    } catch (error) {
      setSortError(getErrorMessage(error));
    } finally {
      setSorting(false);
    }
  }

  async function handleCreateFilter() {
    if (!id || !activeWorksheet) return;
    const range = getSelectedRange();
    try {
      setStructureBusy(true);
      setStructureError('');
      const updated = await createWorkbookFilter(id, activeWorksheet.id, {
        startRow: range.row,
        startColumn: range.column,
        endRow: range.endRow,
        endColumn: range.endColumn,
        columns: [],
      });
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setStructureError(getErrorMessage(error));
    } finally {
      setStructureBusy(false);
    }
  }

  async function handleClearFilter() {
    if (!id || !activeWorksheet) return;
    try {
      setStructureBusy(true);
      setStructureError('');
      const updated = await clearWorkbookFilter(id, activeWorksheet.id);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setStructureError(getErrorMessage(error));
    } finally {
      setStructureBusy(false);
    }
  }

  function openSaveFilterViewDialog() {
    setSaveFilterViewName('');
    setSaveFilterViewError('');
    setSaveFilterViewOpen(true);
  }

  async function handleSaveFilterView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !activeWorksheet) return;
    try {
      setSaveFilterViewBusy(true);
      setSaveFilterViewError('');
      const updated = await saveWorkbookFilterView(
        id,
        activeWorksheet.id,
        saveFilterViewName,
      );
      applyUpdatedWorkbook(updated);
      setSaveFilterViewOpen(false);
      setSaveFilterViewName('');
    } catch (error) {
      setSaveFilterViewError(getErrorMessage(error));
    } finally {
      setSaveFilterViewBusy(false);
    }
  }

  function openFilterViewsDialog() {
    setSelectedFilterViewId(null);
    setFilterViewsError('');
    setFilterViewsOpen(true);
  }

  async function handleApplyFilterView(view: FilterView) {
    if (!id) return;
    try {
      setFilterViewsBusy(true);
      setFilterViewsError('');
      const updated = await applyWorkbookFilterView(id, view.id);
      applyUpdatedWorkbook(updated);
      setSelectedFilterViewId(view.id);
    } catch (error) {
      setFilterViewsError(getErrorMessage(error));
    } finally {
      setFilterViewsBusy(false);
    }
  }

  async function handleDeleteFilterView() {
    if (!id || selectedFilterViewId === null) return;
    try {
      setFilterViewsBusy(true);
      setFilterViewsError('');
      const updated = await deleteWorkbookFilterView(id, selectedFilterViewId);
      applyUpdatedWorkbook(updated);
      setSelectedFilterViewId(null);
    } catch (error) {
      setFilterViewsError(getErrorMessage(error));
    } finally {
      setFilterViewsBusy(false);
    }
  }

  function openPivotCreateDialog() {
    if (!activeWorksheet) return;
    setPivotError('');
    setPivotCreateOpen(true);
  }

  async function handlePivotCreate() {
    if (!id || !activeWorksheet) return;
    const range = getSelectedRange();
    try {
      setPivotBusy(true);
      setPivotError('');
      const updated = await createPivotTable(id, {
        sourceWorksheetId: activeWorksheet.id,
        startRow: range.row,
        startColumn: range.column,
        endRow: range.endRow,
        endColumn: range.endColumn,
      });
      applyUpdatedWorkbook(updated);
      setPivotCreateOpen(false);
    } catch (error) {
      setPivotError(getErrorMessage(error));
    } finally {
      setPivotBusy(false);
    }
  }

  async function handlePivotApply() {
    if (!id || !activeWorksheet?.pivot) return;
    if (pivotRowField === null || pivotValueField === null) {
      setPivotError('Pivot configuration is incomplete. Select row and value fields.');
      return;
    }
    try {
      setPivotBusy(true);
      setPivotError('');
      const updated = await applyPivotTable(id, {
        rowField: pivotRowField,
        columnField: pivotColumnField,
        valueField: pivotValueField,
        summarizeBy: pivotSummarizeBy,
      });
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setPivotError(getErrorMessage(error));
    } finally {
      setPivotBusy(false);
    }
  }

  async function handlePivotRefresh() {
    if (!id || !activeWorksheet?.pivot) return;
    try {
      setPivotBusy(true);
      setPivotError('');
      const updated = await refreshPivotTable(id);
      applyUpdatedWorkbook(updated);
    } catch (error) {
      setPivotError(getErrorMessage(error));
    } finally {
      setPivotBusy(false);
    }
  }

  function handleDataCommand(
    command:
      | 'sort'
      | 'createFilter'
      | 'clearFilter'
      | 'saveFilterView'
      | 'filterViews'
      | 'validation'
      | 'namedRanges'
      | 'pivot',
  ) {
    closeMenus();
    if (command === 'sort') {
      openSortDialog();
    } else if (command === 'createFilter') {
      void handleCreateFilter();
    } else if (command === 'clearFilter') {
      void handleClearFilter();
    } else if (command === 'saveFilterView') {
      openSaveFilterViewDialog();
    } else if (command === 'filterViews') {
      openFilterViewsDialog();
    } else if (command === 'validation') {
      openValidationDialog();
    } else if (command === 'namedRanges') {
      openNamedRangesDialog();
    } else if (command === 'pivot') {
      openPivotCreateDialog();
    }
  }

  function validationRuleForCell(row: number, column: number): ValidationRule | undefined {
    if (!activeWorksheet?.validations) return undefined;
    return activeWorksheet.validations.find((rule) => {
      const minRow = Math.min(rule.startRow, rule.endRow);
      const maxRow = Math.max(rule.startRow, rule.endRow);
      const minColumn = Math.min(rule.startColumn, rule.endColumn);
      const maxColumn = Math.max(rule.startColumn, rule.endColumn);
      return row >= minRow && row <= maxRow && column >= minColumn && column <= maxColumn;
    });
  }

  function openValidationDialog() {
    const range = getSelectedRange();
    if (!activeWorksheet) return;
    const existing = activeWorksheet.validations?.find((rule) => {
      const ruleMinRow = Math.min(rule.startRow, rule.endRow);
      const ruleMaxRow = Math.max(rule.startRow, rule.endRow);
      const ruleMinColumn = Math.min(rule.startColumn, rule.endColumn);
      const ruleMaxColumn = Math.max(rule.startColumn, rule.endColumn);
      return range.row <= ruleMaxRow && range.endRow >= ruleMinRow && range.column <= ruleMaxColumn && range.endColumn >= ruleMinColumn;
    });
    setValidationRuleId(existing?.id ?? null);
    setValidationRuleType(existing?.type ?? 'dropdown');
    setValidationAllowedValues(existing?.allowedValues?.join(', ') ?? '');
    setValidationMinimum(existing?.type === 'number' ? String(existing.minimum ?? '') : '');
    setValidationMaximum(existing?.type === 'number' ? String(existing.maximum ?? '') : '');
    setValidationErrorMessage(existing?.errorMessage ?? '');
    setValidationError('');
    setValidationOpen(true);
  }

  async function handleValidationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !activeWorksheet) return;
    const range = getSelectedRange();
    if (validationRuleType === 'dropdown') {
      const allowed = validationAllowedValues.split(',').map((item) => item.trim()).filter(Boolean);
      if (allowed.length === 0) {
        setValidationError('Allowed values cannot be empty');
        return;
      }
    } else {
      if (validationMinimum.trim() === '' || validationMaximum.trim() === '') {
        setValidationError('Minimum and maximum must be numbers');
        return;
      }
      const min = Number(validationMinimum);
      const max = Number(validationMaximum);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        setValidationError('Minimum and maximum must be numbers');
        return;
      }
      if (min > max) {
        setValidationError('Minimum must be less than or equal to maximum');
        return;
      }
    }
    try {
      setValidationSaving(true);
      setValidationError('');
      const updated = await saveValidationRule(id, activeWorksheet.id, {
        startRow: range.row,
        startColumn: range.column,
        endRow: range.endRow,
        endColumn: range.endColumn,
        ruleType: validationRuleType,
        allowedValues: validationRuleType === 'dropdown' ? validationAllowedValues : undefined,
        minimum: validationRuleType === 'number' ? validationMinimum : null,
        maximum: validationRuleType === 'number' ? validationMaximum : null,
        errorMessage: validationErrorMessage,
      });
      applyUpdatedWorkbook(updated);
      setValidationOpen(false);
      setValidationRuleId(null);
    } catch (error) {
      setValidationError(getErrorMessage(error));
    } finally {
      setValidationSaving(false);
    }
  }

  async function handleDeleteValidation() {
    if (!id || !activeWorksheet || !validationRuleId) return;
    try {
      setValidationSaving(true);
      setValidationError('');
      const updated = await deleteValidationRule(id, activeWorksheet.id, validationRuleId);
      applyUpdatedWorkbook(updated);
      setValidationOpen(false);
      setValidationRuleId(null);
    } catch (error) {
      setValidationError(getErrorMessage(error));
    } finally {
      setValidationSaving(false);
    }
  }

  function handleDropdownSelect(row: number, column: number, value: string) {
    setDropdownOpenFor(null);
    void commitCellWrite(row, column, value);
  }


  function getDistinctFilterValues(column: number): string[] {
    if (!activeWorksheet || !activeWorksheet.filter) return [];
    const filter = activeWorksheet.filter;
    const values: string[] = [];
    for (const cell of activeWorksheet.cells) {
      if (cell.column !== column) continue;
      if (cell.row < filter.startRow || cell.row > filter.endRow) continue;
      if (cell.row < Math.min(filter.startRow, filter.endRow) || cell.row > Math.max(filter.startRow, filter.endRow)) continue;
      if (cell.value === '') continue;
      if (!values.includes(cell.value)) values.push(cell.value);
    }
    return values;
  }

  function openFilterDialog(column: number) {
    if (!activeWorksheet) return;
    const existing = activeWorksheet.filter?.columns.find((item) => item.column === column);
    setFilterDialog({
      column,
      condition: existing?.type ?? 'values',
      conditionValue: existing?.value ?? '',
      selectedValues: existing?.type === 'values' ? [...(existing.values || [])] : [],
    });
  }

  function handleFilterConditionChange(condition: FilterConditionType) {
    setFilterDialog((current) => current ? { ...current, condition } : current);
  }

  function handleFilterValueToggle(value: string) {
    setFilterDialog((current) => {
      if (!current) return current;
      const selectedValues = current.selectedValues.includes(value)
        ? current.selectedValues.filter((item) => item !== value)
        : [...current.selectedValues, value];
      return { ...current, selectedValues };
    });
  }

  function clearFilterSelection() {
    setFilterDialog((current) => current ? { ...current, selectedValues: [] } : current);
  }

  async function handleApplyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !activeWorksheet || !activeWorksheet.filter || !filterDialog) return;
    const filter = activeWorksheet.filter;
    const column: FilterColumn = {
      column: filterDialog.column,
      type: filterDialog.condition,
    };
    if (filterDialog.condition === 'values') {
      column.values = filterDialog.selectedValues;
    } else {
      column.value = filterDialog.conditionValue;
    }
    try {
      setFilterBusy(true);
      const updated = await createWorkbookFilter(id, activeWorksheet.id, {
        startRow: filter.startRow,
        startColumn: filter.startColumn,
        endRow: filter.endRow,
        endColumn: filter.endColumn,
        columns: [
          ...filter.columns.filter((item) => item.column !== filterDialog.column),
          column,
        ],
      });
      applyUpdatedWorkbook(updated);
      setFilterDialog(null);
    } catch (error) {
      setOperationError(getErrorMessage(error));
    } finally {
      setFilterBusy(false);
    }
  }

  function isRowVisible(row: number): boolean {
    if (!activeWorksheet?.filter) return true;
    const filter = activeWorksheet.filter;
    if (row < Math.min(filter.startRow, filter.endRow) || row > Math.max(filter.startRow, filter.endRow)) return true;
    for (const column of filter.columns) {
      const cell = activeWorksheet.cells.find((item) => item.row === row && item.column === column.column);
      const value = cell?.value ?? '';
      let matches = true;
      if (column.type === 'values') {
        matches = (column.values || []).includes(value);
      } else if (column.type === 'text_contains') {
        const needle = (column.value || '').toLowerCase();
        matches = value.toLowerCase().includes(needle);
      } else if (column.type === 'greater_than') {
        const cellNumber = Number(value);
        const target = Number(column.value);
        matches = value.trim() !== '' && Number.isFinite(cellNumber) && Number.isFinite(target) && cellNumber > target;
      } else if (column.type === 'before') {
        const cellTime = Date.parse(value);
        const targetTime = Date.parse(column.value || '');
        matches = value.trim() !== '' && Number.isFinite(cellTime) && Number.isFinite(targetTime) && cellTime < targetTime;
      } else if (column.type === 'is_empty') {
        matches = value.trim() === '';
      } else if (column.type === 'is_not_empty') {
        matches = value.trim() !== '';
      }
      if (!matches) return false;
    }
    return true;
  }

  function getSelectedRange(): Selection {
    return normalizeSelection({
      row: selectionAnchor.row,
      column: selectionAnchor.column,
      endRow: selectionFocus.row,
      endColumn: selectionFocus.column,
    });
  }

  function collectRange(range: Selection): { row: number; column: number; value: string }[] {
    const result: { row: number; column: number; value: string }[] = [];
    if (!activeWorksheet) return result;
    for (let r = range.row; r <= range.endRow; r += 1) {
      for (let c = range.column; c <= range.endColumn; c += 1) {
        const cell = activeWorksheet.cells.find((item) => item.row === r && item.column === c);
        result.push({ row: r, column: c, value: cell?.value ?? '' });
      }
    }
    return result;
  }

  async function clearSelectedCells() {
    if (!activeWorksheet || !id) return;
    const range = getSelectedRange();
    const cells = collectRange(range)
      .filter((cell) => cell.value !== '')
      .map((cell) => ({ ...cell, value: '' }));
    try {
      setOperationError('');
      await setWorksheetSelection(
        id,
        activeWorksheet.id,
        range.row,
        range.column,
        range.endRow,
        range.endColumn,
      ).catch((error) => {
        console.error(getErrorMessage(error));
      });
      if (cells.length > 0) {
        const updated = await writeCells(id, activeWorksheet.id, cells);
        applyUpdatedWorkbook(updated);
      }
      setSelectionAnchor({ row: range.row, column: range.column });
      setSelectionFocus({ row: range.endRow, column: range.endColumn });
      rememberSelection(activeWorksheet.id, range);
    } catch (error) {
      setOperationError(getErrorMessage(error));
    }
  }

  function copySelection() {
    if (!activeWorksheet) return;
    const range = getSelectedRange();
    const values = collectRange(range);
    setClipboard({ type: 'copy', range, values });
    setOperationError('');
  }

  function cutSelection() {
    if (!activeWorksheet) return;
    const range = getSelectedRange();
    const values = collectRange(range);
    setClipboard({ type: 'cut', range, values });
    setOperationError('');
  }

  async function pasteInternal() {
    if (!clipboard || !activeWorksheet || !id) return;
    const source = normalizeSelection(clipboard.range);
    const targetRow = Math.min(selectionAnchor.row, selectionFocus.row);
    const targetColumn = Math.min(selectionAnchor.column, selectionFocus.column);
    const rowOffset = targetRow - source.row;
    const colOffset = targetColumn - source.column;
    const cells: CellWrite[] = [];
    for (const item of clipboard.values) {
      const dr = item.row - source.row;
      const dc = item.column - source.column;
      const target = { row: targetRow + dr, column: targetColumn + dc };
      let value = item.value;
      if (clipboard.type === 'copy' && value.startsWith('=')) {
        value = adjustFormula(value, rowOffset, colOffset);
      }
      cells.push({ row: target.row, column: target.column, value });
    }
    if (clipboard.type === 'cut') {
      for (const item of clipboard.values) {
        cells.push({ row: item.row, column: item.column, value: '' });
      }
    }
    await commitBulkWrite(cells);
  }

  async function pasteExternalText(text: string) {
    if (!activeWorksheet || !id) return;
    const rows = parseTabText(text);
    const targetRow = Math.min(selectionAnchor.row, selectionFocus.row);
    const targetColumn = Math.min(selectionAnchor.column, selectionFocus.column);
    const cells: CellWrite[] = [];
    for (let r = 0; r < rows.length; r += 1) {
      for (let c = 0; c < rows[r].length; c += 1) {
        cells.push({ row: targetRow + r, column: targetColumn + c, value: rows[r][c] });
      }
    }
    if (cells.length === 0) return;
    await commitBulkWrite(cells);
  }

  function handleGridPaste(event: ReactClipboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (clipboard) {
      void pasteInternal();
    } else if (text) {
      void pasteExternalText(text);
    }
  }

  function openCellMenu(row: number, column: number, event: ReactMouseEvent) {
    event.preventDefault();
    setCellMenu({ row, column, point: { x: event.clientX, y: event.clientY } });
  }

  async function pasteFromMenu() {
    if (clipboard) {
      await pasteInternal();
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        await pasteExternalText(text);
      } else {
        setOperationError('No clipboard data to paste.');
      }
    } catch (error) {
      setOperationError('No clipboard data to paste.');
    }
  }

  function handleCellMenuCommand(command: 'copy' | 'cut' | 'paste') {
    closeMenus();
    if (command === 'copy') copySelection();
    else if (command === 'cut') cutSelection();
    else if (command === 'paste') {
      void pasteFromMenu();
    }
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const targetIsEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const targetInsideDialog = Boolean(target && target.closest && target.closest('[role="dialog"]'));
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') {
          event.preventDefault();
          void handleUndo();
        } else if (key === 'y') {
          event.preventDefault();
          void handleRedo();
        } else if (key === 'c') {
          if (targetIsEditable) return;
          event.preventDefault();
          copySelection();
        } else if (key === 'x') {
          if (targetIsEditable) return;
          event.preventDefault();
          cutSelection();
        }
      } else if (
        event.key === 'Delete' &&
        !targetIsEditable &&
        !targetInsideDialog &&
        !editingCell &&
        formulaDraft === null
      ) {
        event.preventDefault();
        void clearSelectedCells();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  function handleFormulaBarKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (formulaDraft !== null) {
        const value = formulaDraft;
        setFormulaDraft(null);
        void commitCellWrite(selectionFocus.row, selectionFocus.column, value);
      }
    } else if (event.key === 'Escape') {
      setFormulaDraft(null);
    }
  }

  function handleEditingKeyDown(event: KeyboardEvent) {
    if (!editingCell) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      editCancelRef.current = true;
      void commitCellWrite(editingCell.row, editingCell.column, editingCell.draft);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editCancelRef.current = true;
      setEditingCell(null);
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto w-full max-w-3xl px-6 py-12">
          <p className="rounded-md bg-red-50 p-3 text-red-700">{loadError}</p>
          <Link to="/" className="mt-4 inline-block text-blue-700 underline">Back to home</Link>
        </div>
      </main>
    );
  }

  if (!workbook || !activeWorksheet) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto w-full max-w-3xl px-6 py-12 text-slate-500">Loading workbook…</div>
      </main>
    );
  }

  const targetDeleteSheet = deleteWorksheetOpen
    ? workbook.worksheets.find((sheet) => sheet.id === deleteWorksheetSourceId)
    : undefined;

  const currentRange = getSelectedRange();
  const sortOptions = activeWorksheet
    ? Array.from({ length: currentRange.endColumn - currentRange.column + 1 }, (_, index) => {
        const column = currentRange.column + index;
        const header = activeWorksheet.cells.find((cell) => cell.row === currentRange.row && cell.column === column)?.value || columnName(column);
        return { value: String(column), label: header };
      })
    : [];
  const filterDistinctValues = filterDialog ? getDistinctFilterValues(filterDialog.column) : [];
  const filterDialogHeader = filterDialog && activeWorksheet?.filter
    ? activeWorksheet.cells.find((cell) => cell.row === activeWorksheet.filter.startRow && cell.column === filterDialog.column)?.value || columnName(filterDialog.column)
    : '';
  const pivotSourceWorksheet = activeWorksheet?.pivot
    ? workbook.worksheets.find((sheet) => sheet.id === activeWorksheet.pivot?.sourceWorksheetId)
    : undefined;
  const pivotFieldOptions = activeWorksheet?.pivot && pivotSourceWorksheet
    ? Array.from({ length: activeWorksheet.pivot.endColumn - activeWorksheet.pivot.startColumn + 1 }, (_, index) => {
        const column = activeWorksheet.pivot!.startColumn + index;
        const header = pivotSourceWorksheet.cells.find((cell) => cell.row === activeWorksheet.pivot!.startRow && cell.column === column)?.value || columnName(column);
        return { value: String(column), label: header };
      })
    : [];

  return (
    <main className="min-h-screen bg-slate-50" onPaste={handleGridPaste}>
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-3">
              <Link to="/" className="text-sm text-blue-700 underline">Home</Link>
              <h1 className="text-2xl font-bold text-slate-900">{workbook.name}</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">Last updated: {workbook.lastUpdated}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={!workbook.canUndo}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => void handleRedo()}
              disabled={!workbook.canRedo}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              Redo
            </button>
            <button
              type="button"
              onClick={openRenameDialog}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Rename workbook
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={openViewMenu}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              View
            </button>
            <button
              type="button"
              onClick={openEditMenu}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={openInsertMenu}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Insert
            </button>
            <button
              type="button"
              onClick={openFormatMenu}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Format
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Frozen rows: {activeWorksheet.frozenRows ?? 0}; columns: {activeWorksheet.frozenColumns ?? 0}
            </button>
            <button
              type="button"
              onClick={openDataMenu}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Data
            </button>
          </div>
        </header>

        {dataMenu && (
          <div
            role="menu"
            aria-label="Data options"
            className="fixed z-50 min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: dataMenu.x, top: dataMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => handleDataCommand('sort')}
            >
              Sort range
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => handleDataCommand('createFilter')}
            >
              Create filter
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!activeWorksheet?.filter}
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => handleDataCommand('clearFilter')}
            >
              Clear filter
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!activeWorksheet?.filter}
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => handleDataCommand('saveFilterView')}
            >
              Save filter view
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => handleDataCommand('filterViews')}
            >
              Filter views
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => handleDataCommand('validation')}
            >
              Data validation
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => handleDataCommand('namedRanges')}
            >
              Named ranges
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => handleDataCommand('pivot')}
            >
              Create pivot table
            </button>
          </div>
        )}

        {viewMenu && (
          <div
            role="menu"
            aria-label="View options"
            className="fixed z-50 min-w-[230px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: viewMenu.x, top: viewMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => void handleFreeze(selectionFocus.row, 0)}
            >
              Freeze rows through {selectionFocus.row}
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => void handleFreeze(0, selectionFocus.column)}
            >
              Freeze columns through {columnName(selectionFocus.column)}
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => void handleFreeze(selectionFocus.row - 1, selectionFocus.column - 1)}
            >
              Freeze panes at {cellName(selectionFocus.row, selectionFocus.column)}
            </button>
          </div>
        )}

        {editMenu && (
          <div
            role="menu"
            aria-label="Edit options"
            className="fixed z-50 min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: editMenu.x, top: editMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={openFindReplaceDialog}
            >
              Find and replace
            </button>
          </div>
        )}

        {insertMenu && (
          <div
            role="menu"
            aria-label="Insert options"
            className="fixed z-50 min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: insertMenu.x, top: insertMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={openAddNote}
            >
              Add note
            </button>
          </div>
        )}

        {formatMenu && (
          <div
            role="menu"
            aria-label="Format options"
            className="fixed z-50 min-w-[220px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: formatMenu.x, top: formatMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => openConditionalFormatDialog()}
            >
              Conditional formatting
            </button>
          </div>
        )}

        {exportError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{exportError}</p>}
        {structureError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{structureError}</p>}
        {operationError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{operationError}</p>}

        {activeWorksheet?.pivot && (
          <div
            role="region"
            aria-label="Pivot table editor"
            className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Combobox
                  label="Rows"
                  value={pivotRowField === null ? '' : String(pivotRowField)}
                  onChange={(value) => setPivotRowField(value === '' ? null : Number(value))}
                  options={pivotFieldOptions}
                />
              </div>
              <div className="w-40">
                <Combobox
                  label="Columns"
                  value={pivotColumnField === null ? '' : String(pivotColumnField)}
                  onChange={(value) => setPivotColumnField(value === '' ? null : Number(value))}
                  options={[{ value: '', label: 'None' }, ...pivotFieldOptions]}
                />
              </div>
              <div className="w-40">
                <Combobox
                  label="Values"
                  value={pivotValueField === null ? '' : String(pivotValueField)}
                  onChange={(value) => setPivotValueField(value === '' ? null : Number(value))}
                  options={pivotFieldOptions}
                />
              </div>
              <div className="w-40">
                <Combobox
                  label="Summarize by"
                  value={pivotSummarizeBy}
                  onChange={(value) => setPivotSummarizeBy(value as SummarizeBy)}
                  options={[
                    { value: 'SUM', label: 'SUM' },
                    { value: 'COUNT', label: 'COUNT' },
                    { value: 'AVERAGE', label: 'AVERAGE' },
                  ]}
                />
              </div>
              <button
                type="button"
                onClick={() => void handlePivotApply()}
                disabled={pivotBusy}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => void handlePivotRefresh()}
                disabled={pivotBusy}
                className="rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
              >
                Refresh pivot table
              </button>
            </div>
            {pivotError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{pivotError}</p>}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2">
            <label htmlFor="formula-bar" className="sr-only">Formula bar</label>
            <input
              id="formula-bar"
              aria-label="Formula bar"
              value={formulaDraft !== null ? formulaDraft : selectedValue}
              onChange={(event) => {
                setFormulaDraft(event.target.value);
                setOperationError('');
              }}
              onFocus={() => {
                if (formulaDraft === null) setFormulaDraft(selectedValue);
              }}
              onKeyDown={handleFormulaBarKeyDown}
              onBlur={() => {
                if (formulaDraft !== null) {
                  void commitCellWrite(selectionFocus.row, selectionFocus.column, formulaDraft);
                }
              }}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-800"
            />
          </div>
          <div role="tablist" aria-label="Worksheets" className="mb-2 flex flex-wrap items-center gap-1 border-b border-slate-200">
            {workbook.worksheets.map((sheet) => (
              <div
                key={sheet.id}
                role="tab"
                aria-label={sheet.name}
                aria-selected={sheet.id === activeWorksheet.id}
                aria-controls={`panel-${sheet.id}`}
                tabIndex={sheet.id === activeWorksheet.id ? 0 : -1}
                onClick={() => void handleSwitchWorksheet(sheet.id)}
                onKeyDown={(event) => handleTabKeyDown(event, sheet.id)}
                className={`group flex items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-sm font-medium ${
                  sheet.id === activeWorksheet.id
                    ? 'border-slate-300 bg-white text-blue-700'
                    : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{sheet.name}</span>
                <button
                  type="button"
                  aria-label={`Worksheet options for ${sheet.name}`}
                  onClick={(event) => openWorksheetMenu(sheet.id, event)}
                  className="rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  ⋮
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => void handleAddWorksheet()}
              disabled={structureBusy}
              className="ml-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              Add worksheet
            </button>
          </div>
          <div
            role="grid"
            aria-label="Worksheet grid"
            aria-multiselectable="true"
            className="overflow-auto border border-slate-300"
            onMouseUp={() => setIsMouseDown(false)}
            onClick={closeMenus}
            onPaste={handleGridPaste}
          >
            <div role="row" className="flex">
              <div className="w-10 min-w-[40px] border-b border-r border-slate-200 bg-slate-100" />
              {Array.from({ length: gridColumns }, (_, columnIndex) => {
                const column = columnIndex + 1;
                const name = columnName(column);
                const filter = activeWorksheet.filter;
                const filterHeader = filter
                  ? activeWorksheet.cells.find((cell) => cell.row === filter.startRow && cell.column === column)?.value || name
                  : '';
                const showFilterButton = Boolean(filter && column >= Math.min(filter.startColumn, filter.endColumn) && column <= Math.max(filter.startColumn, filter.endColumn));
                return (
                  <div
                    key={name}
                    role="columnheader"
                    aria-label={name}
                    onContextMenu={(event) => openColumnMenu(column, event)}
                    className="min-w-[80px] border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>{name}</span>
                      {showFilterButton && (
                        <button
                          type="button"
                          aria-label={`Filter ${filterHeader}`}
                          onClick={() => openFilterDialog(column)}
                          className="rounded border border-slate-300 bg-white px-1 text-[10px] leading-tight text-slate-600 hover:bg-slate-200"
                        >
                          ▼
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
                        {visibleRows.map((row) => {
              return (
                <div role="row" key={row} className="flex">
                  <div
                    role="rowheader"
                    aria-label={String(row)}
                    onContextMenu={(event) => openRowMenu(row, event)}
                    className="w-10 min-w-[40px] border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600"
                  >
                    {row}
                  </div>
                  {Array.from({ length: gridColumns }, (_, columnIndex) => {
                    const column = columnIndex + 1;
                    const coordinate = cellName(row, column);
                    const isSelected = isCellSelected(row, column);
                    const isFocus = selectionFocus.row === row && selectionFocus.column === column;
                    const cell = activeWorksheet.cells.find(
                      (item) => item.row === row && item.column === column,
                    );
                    const isEditingThis = editingCell?.row === row && editingCell.column === column;
                    const validationRule = validationRuleForCell(row, column);
                    const isDropdownCell = validationRule?.type === 'dropdown';
                    const dropdownAllowed = validationRule?.allowedValues ?? [];
                    const dropdownIsOpen = dropdownOpenFor?.row === row && dropdownOpenFor?.column === column;
                    const conditionalFill = conditionalFillStyle(
                      String(cell?.displayValue ?? cell?.value ?? ''),
                      activeWorksheet,
                      row,
                      column,
                    );
                    const cellNote = (activeWorksheet.notes || []).find(
                      (note) => note.row === row && note.column === column,
                    );
                    return (
                      <span
                        key={coordinate}
                        role="gridcell"
                        aria-label={coordinate}
                        aria-selected={isSelected}
                        tabIndex={isFocus ? 0 : -1}
                        style={conditionalFill ? { backgroundColor: conditionalFill } : undefined}
                        onMouseDown={(event) => handleCellPointerDown(row, column, event)}
                        onMouseEnter={() => handleCellMouseEnter(row, column)}
                        onDoubleClick={() => handleCellDoubleClick(row, column)}
                        onKeyDown={(event) => handleCellKeyDown(row, column, event)}
                        onContextMenu={(event) => openCellMenu(row, column, event)}
                        className={`relative min-w-[80px] border-b border-r border-slate-200 px-2 py-1 text-sm ${
                          isSelected ? 'bg-blue-100 ring-1 ring-blue-500' : 'text-slate-800'
                        }`}
                      >
                        {isEditingThis ? (
                          <input
                            aria-label={`Edit ${coordinate}`}
                            value={editingCell.draft}
                            onChange={(event) => {
                              setEditingCell({ ...editingCell, draft: event.target.value });
                              setOperationError('');
                            }}
                            onKeyDown={handleEditingKeyDown}
                            onBlur={() => {
                              if (!editCancelRef.current && editingCell) {
                                void commitCellWrite(editingCell.row, editingCell.column, editingCell.draft);
                              }
                              editCancelRef.current = false;
                            }}
                            autoFocus
                            className="w-full border border-blue-500 px-1 py-0.5 text-sm focus:outline-none"
                          />
                        ) : (
                          <span className="flex items-center gap-1">
                            <span className="flex-1 truncate">{cell?.displayValue ?? cell?.value ?? ''}</span>
                            {cellNote && (
                              <button
                                type="button"
                                aria-label={`Open note for ${coordinate}`}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openExistingNote(cellNote);
                                }}
                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                              >
                                <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1.5 1.5 0 0 1 1.06.44l2.415 2.414a1.5 1.5 0 0 1 .439 1.06V13.5A1.5 1.5 0 0 1 12 15H4.5A1.5 1.5 0 0 1 3 13.5v-11ZM10 2v3.5a.5.5 0 0 0 .5.5H14l-4-4Zm-5 6.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.25Zm0 2.5A.75.75 0 0 1 5.75 10h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" />
                                </svg>
                              </button>
                            )}
                            {isDropdownCell && (
                              <button
                                type="button"
                                aria-label={`Open dropdown for ${coordinate}`}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDropdownOpenFor((current) =>
                                    current?.row === row && current.column === column ? null : { row, column },
                                  );
                                }}
                                className="flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-200"
                              >
                                <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 10 10">
                                  <path d="M2 3h6L5 7z" fill="currentColor" />
                                </svg>
                              </button>
                            )}
                          </span>
                        )}
                        {dropdownIsOpen && isDropdownCell && (
                          <div
                            role="listbox"
                            aria-label={`Options for ${coordinate}`}
                            className="absolute left-0 top-full z-30 min-w-[120px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                          >
                            {dropdownAllowed.map((option) => (
                              <div
                                key={option}
                                role="option"
                                aria-selected={option === (cell?.value ?? '')}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleDropdownSelect(row, column, option);
                                }}
                                className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50"
                              >
                                {option}
                              </div>
                            ))}
                          </div>
                        )}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {cellMenu && (
        <div
          role="menu"
          aria-label="Cell options"
          className="fixed z-50 min-w-[180px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={{ left: cellMenu.point.x, top: cellMenu.point.y }}
        >
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => handleCellMenuCommand('copy')}>
            Copy
          </button>
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => handleCellMenuCommand('cut')}>
            Cut
          </button>
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => handleCellMenuCommand('paste')}>
            Paste
          </button>
        </div>
      )}

      {worksheetMenu && (
        <div
          role="menu"
          aria-label="Worksheet options"
          className="fixed z-50 min-w-[180px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={{ left: worksheetMenu.point.x, top: worksheetMenu.point.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => handleWorksheetMenuCommand('rename')}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            onClick={() => handleWorksheetMenuCommand('delete')}
          >
            Delete
          </button>
        </div>
      )}

      {rowMenu && (
        <div
          role="menu"
          aria-label="Row options"
          className="fixed z-50 min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={{ left: rowMenu.point.x, top: rowMenu.point.y }}
        >
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => void handleRowCommand('insertAbove')}>
            Insert 1 row above
          </button>
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => void handleRowCommand('insertBelow')}>
            Insert 1 row below
          </button>
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => void handleRowCommand('delete')}>
            Delete row
          </button>
        </div>
      )}

      {columnMenu && (
        <div
          role="menu"
          aria-label="Column options"
          className="fixed z-50 min-w-[220px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={{ left: columnMenu.point.x, top: columnMenu.point.y }}
        >
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => void handleColumnCommand('insertLeft')}>
            Insert 1 column left
          </button>
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => void handleColumnCommand('insertRight')}>
            Insert 1 column right
          </button>
          <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => void handleColumnCommand('delete')}>
            Delete column
          </button>
        </div>
      )}

      {noteOpen && noteCell && (
        <div
          role="dialog"
          aria-label={`Note for ${cellName(noteCell.row, noteCell.column)}`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setNoteOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">
              Note for {cellName(noteCell.row, noteCell.column)}
            </h2>
            <form onSubmit={(event) => void handleSaveNote(event)} className="mt-4 space-y-4">
              <div>
                <label htmlFor="cell-note-text" className="block text-sm font-medium text-slate-700">
                  Note
                </label>
                <textarea
                  id="cell-note-text"
                  value={noteText}
                  readOnly={!noteEditing}
                  onChange={(event) => {
                    setNoteText(event.target.value);
                    setNoteError('');
                  }}
                  rows={4}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none read-only:bg-slate-50"
                />
              </div>
              {noteError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{noteError}</p>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-3">
                  {noteId !== null && !noteEditing && (
                    <button
                      type="button"
                      onClick={() => setNoteEditing(true)}
                      className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Edit note
                    </button>
                  )}
                  {noteId !== null && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteNote()}
                      disabled={noteBusy}
                      className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      Delete note
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setNoteOpen(false)}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={noteBusy || !noteEditing}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Save note
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {pivotCreateOpen && (
        <div
          role="dialog"
          aria-label="Create pivot table"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPivotCreateOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Create pivot table</h2>
            <p className="mt-2 text-sm text-slate-700">
              Source range: {cellName(currentRange.row, currentRange.column)}:{cellName(currentRange.endRow, currentRange.endColumn)}
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="pivot-destination"
                checked
                readOnly
                className="h-4 w-4 border-slate-300"
              />
              New worksheet
            </label>
            {pivotError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{pivotError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPivotCreateOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handlePivotCreate()}
                disabled={pivotBusy}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {saveFilterViewOpen && (
        <div
          role="dialog"
          aria-label="Save filter view"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSaveFilterViewOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Save filter view</h2>
            <form onSubmit={(event) => void handleSaveFilterView(event)} className="mt-4 space-y-4">
              <div>
                <label htmlFor="filter-view-name" className="block text-sm font-medium text-slate-700">
                  Filter view name
                </label>
                <input
                  id="filter-view-name"
                  type="text"
                  value={saveFilterViewName}
                  onChange={(event) => {
                    setSaveFilterViewName(event.target.value);
                    setSaveFilterViewError('');
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {saveFilterViewError && (
                <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{saveFilterViewError}</p>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSaveFilterViewOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveFilterViewBusy}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Save view
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {filterViewsOpen && (
        <div
          role="dialog"
          aria-label="Filter views"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFilterViewsOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Filter views</h2>
            <div className="mt-4 space-y-1">
              {(workbook.filterViews || []).length === 0 ? (
                <p className="text-sm text-slate-500">No filter views saved.</p>
              ) : (
                (workbook.filterViews || []).map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    aria-pressed={selectedFilterViewId === view.id}
                    onClick={() => void handleApplyFilterView(view)}
                    className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${
                      selectedFilterViewId === view.id
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {view.name}
                  </button>
                ))
              )}
            </div>
            {filterViewsError && (
              <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{filterViewsError}</p>
            )}
            <div className="mt-5 flex justify-between gap-3">
              <button
                type="button"
                disabled={selectedFilterViewId === null || filterViewsBusy}
                onClick={() => void handleDeleteFilterView()}
                className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                Delete filter view
              </button>
              <button
                type="button"
                onClick={() => setFilterViewsOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {validationOpen && (
        <div
          role="dialog"
          aria-label="Data validation"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setValidationOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Data validation</h2>
            <form onSubmit={(event) => void handleValidationSubmit(event)} className="mt-4 space-y-4">
              <Combobox
                label="Rule type"
                value={validationRuleType}
                onChange={(value) => setValidationRuleType(value as ValidationRuleType)}
                options={[
                  { value: 'dropdown', label: 'Dropdown' },
                  { value: 'number', label: 'Number range' },
                ]}
              />
              {validationRuleType === 'dropdown' ? (
                <div>
                  <label htmlFor="validation-allowed-values" className="block text-sm font-medium text-slate-700">
                    Allowed values
                  </label>
                  <input
                    id="validation-allowed-values"
                    type="text"
                    value={validationAllowedValues}
                    onChange={(event) => {
                      setValidationAllowedValues(event.target.value);
                      setValidationError('');
                    }}
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="validation-minimum" className="block text-sm font-medium text-slate-700">
                      Minimum
                    </label>
                    <input
                      id="validation-minimum"
                      type="text"
                      inputMode="decimal"
                      value={validationMinimum}
                      onChange={(event) => {
                        setValidationMinimum(event.target.value);
                        setValidationError('');
                      }}
                      className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="validation-maximum" className="block text-sm font-medium text-slate-700">
                      Maximum
                    </label>
                    <input
                      id="validation-maximum"
                      type="text"
                      inputMode="decimal"
                      value={validationMaximum}
                      onChange={(event) => {
                        setValidationMaximum(event.target.value);
                        setValidationError('');
                      }}
                      className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="validation-error-message" className="block text-sm font-medium text-slate-700">
                  Error message
                </label>
                <input
                  id="validation-error-message"
                  type="text"
                  value={validationErrorMessage}
                  onChange={(event) => {
                    setValidationErrorMessage(event.target.value);
                    setValidationError('');
                  }}
                  placeholder="Optional"
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {validationError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{validationError}</p>}
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setValidationOpen(false)}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  {validationRuleId !== null && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteValidation()}
                      disabled={validationSaving}
                      className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      Delete rule
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={validationSaving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {sortOpen && (
        <div
          role="dialog"
          aria-label="Sort range"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSortOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Sort range</h2>
            <form onSubmit={(event) => void handleSortSubmit(event)} className="mt-4 space-y-4">
              <Combobox
                label="Sort by"
                value={sortByColumn === null ? '' : String(sortByColumn)}
                onChange={(value) => setSortByColumn(Number(value))}
                options={sortOptions}
              />
              <Combobox
                label="Order"
                value={sortOrder}
                onChange={(value) => setSortOrder(value as 'asc' | 'desc')}
                options={[
                  { value: 'asc', label: 'Ascending' },
                  { value: 'desc', label: 'Descending' },
                ]}
              />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sortHasHeader}
                  onChange={(event) => setSortHasHeader(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Data has header row
              </label>
              {sortError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{sortError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSortOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sorting || sortByColumn === null}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Sort
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {filterDialog && (
        <div
          role="dialog"
          aria-label={`Filter ${filterDialogHeader}`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFilterDialog(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Filter {filterDialogHeader}</h2>
            <form onSubmit={(event) => void handleApplyFilter(event)} className="mt-4 space-y-4">
              <Combobox
                label="Condition"
                value={filterDialog.condition}
                onChange={handleFilterConditionChange}
                options={[
                  { value: 'values', label: 'Values' },
                  { value: 'text_contains', label: 'Text contains' },
                  { value: 'greater_than', label: 'Greater than' },
                  { value: 'before', label: 'Before' },
                  { value: 'is_empty', label: 'Is empty' },
                  { value: 'is_not_empty', label: 'Is not empty' },
                ]}
              />
              {filterDialog.condition === 'values' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Values</span>
                    <button
                      type="button"
                      onClick={clearFilterSelection}
                      className="text-sm text-blue-700 underline"
                    >
                      Clear selection
                    </button>
                  </div>
                  <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-slate-200 p-2">
                    {filterDistinctValues.map((value) => (
                      <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          aria-label={value}
                          checked={filterDialog.selectedValues.includes(value)}
                          onChange={() => handleFilterValueToggle(value)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>{value}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {(filterDialog.condition === 'text_contains' || filterDialog.condition === 'greater_than' || filterDialog.condition === 'before') && (
                <div>
                  <label htmlFor="filter-value" className="block text-sm font-medium text-slate-700">
                    Value
                  </label>
                  <input
                    id="filter-value"
                    type="text"
                    value={filterDialog.conditionValue}
                    onChange={(event) =>
                      setFilterDialog((current) => current ? { ...current, conditionValue: event.target.value } : current)
                    }
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}
              {filterDialog.condition === 'is_empty' || filterDialog.condition === 'is_not_empty' ? (
                <p className="text-sm text-slate-500">No value required for this condition.</p>
              ) : null}
              {operationError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{operationError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFilterDialog(null)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={filterBusy}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renameOpen && (
        <div
          role="dialog"
          aria-label="Rename workbook"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setRenameOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Rename workbook</h2>
            <form onSubmit={(event) => void handleRename(event)} className="mt-4 space-y-4">
              <div>
                <label htmlFor="workbook-name" className="block text-sm font-medium text-slate-700">
                  Workbook name
                </label>
                <input
                  id="workbook-name"
                  type="text"
                  value={renameName}
                  onChange={(event) => {
                    setRenameName(event.target.value);
                    setRenameError('');
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {renameError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{renameError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRenameOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renaming}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renameWorksheetOpen && (
        <div
          role="dialog"
          aria-label="Rename worksheet"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setRenameWorksheetOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Rename worksheet</h2>
            <form onSubmit={(event) => void handleRenameWorksheet(event)} className="mt-4 space-y-4">
              <div>
                <label htmlFor="worksheet-name" className="block text-sm font-medium text-slate-700">
                  Worksheet name
                </label>
                <input
                  id="worksheet-name"
                  type="text"
                  value={renameWorksheetName}
                  onChange={(event) => {
                    setRenameWorksheetName(event.target.value);
                    setRenameWorksheetError('');
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {renameWorksheetError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{renameWorksheetError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRenameWorksheetOpen(false);
                    setRenameWorksheetSourceId(null);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renamingWorksheet}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteWorksheetOpen && (
        <div
          role="dialog"
          aria-label="Delete worksheet"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDeleteWorksheetOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Delete worksheet</h2>
            <p className="mt-2 text-sm text-slate-700">
              Delete <strong>{targetDeleteSheet?.name}</strong>? This worksheet and its data will be permanently deleted.
            </p>
            {deleteWorksheetError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{deleteWorksheetError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteWorksheetOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteWorksheet()}
                disabled={deletingWorksheet}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Delete worksheet
              </button>
            </div>
          </div>
        </div>
      )}

      {findReplaceOpen && (
        <div
          role="dialog"
          aria-label="Find and replace"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFindReplaceOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Find and replace</h2>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleFindNext();
              }}
            >
              <div>
                <label htmlFor="find-text" className="block text-sm font-medium text-slate-700">
                  Find
                </label>
                <input
                  id="find-text"
                  type="text"
                  value={findText}
                  onChange={(event) => {
                    setFindText(event.target.value);
                    setFindStatus('');
                    setFindMatches([]);
                    setFindIndex(-1);
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="replace-with" className="block text-sm font-medium text-slate-700">
                  Replace with
                </label>
                <input
                  id="replace-with"
                  type="text"
                  value={replaceText}
                  onChange={(event) => setReplaceText(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={matchCase}
                  onChange={(event) => {
                    setMatchCase(event.target.checked);
                    setFindStatus('');
                    setFindMatches([]);
                    setFindIndex(-1);
                  }}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Match case
              </label>
              <p role="status" className="min-h-[1.25rem] text-sm font-medium text-slate-700">{findStatus}</p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFindReplaceOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleFindNext}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Find next
                </button>
                <button
                  type="button"
                  onClick={() => void handleReplaceAll()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Replace all
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {namedRangesOpen && (
        <div
          role="dialog"
          aria-label="Named ranges"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setNamedRangesOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Named ranges</h2>
            {namedRangeFormOpen ? (
              <form onSubmit={(event) => void handleNamedRangeSave(event)} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="named-range-name" className="block text-sm font-medium text-slate-700">
                    Name
                  </label>
                  <input
                    id="named-range-name"
                    type="text"
                    value={namedRangeName}
                    disabled={editingNamedRangeId !== null}
                    onChange={(event) => {
                      setNamedRangeName(event.target.value);
                      setNamedRangeError('');
                    }}
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="named-range-range" className="block text-sm font-medium text-slate-700">
                    Range
                  </label>
                  <input
                    id="named-range-range"
                    type="text"
                    value={namedRangeValue}
                    onChange={(event) => {
                      setNamedRangeValue(event.target.value);
                      setNamedRangeError('');
                    }}
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                {namedRangeError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{namedRangeError}</p>}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setNamedRangeFormOpen(false)}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={namedRangeBusy}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openAddNamedRangeForm}
                  className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Add named range
                </button>
                {namedRangeError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{namedRangeError}</p>}
                <div className="mt-4 space-y-2">
                  {(workbook?.namedRanges || []).length === 0 ? (
                    <p className="text-sm text-slate-500">No named ranges saved.</p>
                  ) : (
                    (workbook?.namedRanges || []).map((namedRange) => (
                      <div key={namedRange.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                        <span className="text-sm text-slate-800">{namedRange.name}</span>
                        <button
                          type="button"
                          onClick={() => openEditNamedRange(namedRange)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Edit {namedRange.name}
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setNamedRangesOpen(false)}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {conditionalOpen && activeWorksheet && (
        <div
          role="dialog"
          aria-label="Conditional formatting"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setConditionalOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Conditional formatting</h2>
            <form onSubmit={(event) => void handleConditionalFormatSave(event)} className="mt-4 space-y-4">
              <p className="text-sm text-slate-600">
                Range: {conditionalRange ? `${cellName(conditionalRange.row, conditionalRange.column)}:${cellName(conditionalRange.endRow, conditionalRange.endColumn)}` : 'None'}
              </p>
              <div>
                <label htmlFor="conditional-condition" className="block text-sm font-medium text-slate-700">
                  Condition
                </label>
                <select
                  id="conditional-condition"
                  value={conditionalCondition}
                  onChange={(event) => {
                    setConditionalCondition(event.target.value as ConditionalFormatCondition);
                    setConditionalError('');
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="greater_than">Greater than</option>
                  <option value="text_contains">Text contains</option>
                </select>
              </div>
              <div>
                <label htmlFor="conditional-value" className="block text-sm font-medium text-slate-700">
                  Value
                </label>
                <input
                  id="conditional-value"
                  type="text"
                  value={conditionalValue}
                  onChange={(event) => {
                    setConditionalValue(event.target.value);
                    setConditionalError('');
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="conditional-style" className="block text-sm font-medium text-slate-700">
                  Style
                </label>
                <select
                  id="conditional-style"
                  value={conditionalStyle}
                  onChange={(event) => setConditionalStyle(event.target.value as ConditionalFormatStyle)}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="red">Red fill</option>
                  <option value="yellow">Yellow fill</option>
                  <option value="green">Green fill</option>
                </select>
              </div>
              {conditionalError && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{conditionalError}</p>}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConditionalOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={conditionalBusy}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </form>
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-800">Saved rules</h3>
              <div className="mt-2 space-y-2">
                {(activeWorksheet.conditionalFormats || []).length === 0 ? (
                  <p className="text-sm text-slate-500">No conditional formatting rules saved.</p>
                ) : (
                  (activeWorksheet.conditionalFormats || []).map((rule, index) => (
                    <div key={rule.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                      <span className="text-sm text-slate-700">
                        {rule.condition === 'greater_than' ? `Greater than ${rule.value}` : `Text contains ${rule.value}`}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openConditionalFormatDialog(rule)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Edit rule {index + 1}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleConditionalFormatDelete(rule.id)}
                          disabled={conditionalBusy}
                          className="rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          Delete rule {index + 1}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

export default WorkbookPage;
