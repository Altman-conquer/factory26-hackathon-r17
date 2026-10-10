import axios from 'axios';

export interface Cell {
  row: number;
  column: number;
  value: string;
  displayValue?: string;
}

export interface CellWrite {
  row: number;
  column: number;
  value: string;
}

export type FilterConditionType =
  | 'values'
  | 'text_contains'
  | 'greater_than'
  | 'before'
  | 'is_empty'
  | 'is_not_empty';

export interface FilterColumn {
  column: number;
  type: FilterConditionType;
  values?: string[];
  value?: string;
}

export interface FilterState {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  columns: FilterColumn[];
}

export type ValidationRuleType = 'dropdown' | 'number';

export interface ValidationRule {
  id: number;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  type: ValidationRuleType;
  allowedValues?: string[];
  minimum?: number | null;
  maximum?: number | null;
  errorMessage?: string | null;
}

export interface FilterView {
  id: number;
  workbookId: number;
  worksheetId: number;
  name: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  columns: FilterColumn[];
}

export interface NamedRange {
  id: number;
  name: string;
  range: string;
}

export type ConditionalFormatStyle = 'red' | 'yellow' | 'green';
export type ConditionalFormatCondition = 'greater_than' | 'text_contains';

export interface ConditionalFormat {
  id: number;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  condition: ConditionalFormatCondition;
  value: string;
  style: ConditionalFormatStyle;
}

export interface CellNote {
  id: number;
  row: number;
  column: number;
  text: string;
}

export type SummarizeBy = 'SUM' | 'COUNT' | 'AVERAGE';

export interface PivotConfig {
  id: number;
  sourceWorksheetId: number;
  resultWorksheetId: number;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  rowField?: number | null;
  columnField?: number | null;
  valueField?: number | null;
  summarizeBy?: SummarizeBy | null;
  rowFieldHeader?: string | null;
  columnFieldHeader?: string | null;
  valueFieldHeader?: string | null;
}

export interface Worksheet {
  id: number;
  name: string;
  position: number;
  active: boolean;
  rowCount: number;
  columnCount: number;
  selectedRow: number;
  selectedColumn: number;
  selectedEndRow: number;
  selectedEndColumn: number;
  frozenRows?: number;
  frozenColumns?: number;
  cells: Cell[];
  filter?: FilterState | null;
  validations?: ValidationRule[];
  conditionalFormats?: ConditionalFormat[];
  notes?: CellNote[];
  pivot?: PivotConfig | null;
}

export interface Workbook {
  id: number;
  name: string;
  updatedAt: string;
  lastUpdated: string;
  activeWorksheetId: number | null;
  canUndo?: boolean;
  canRedo?: boolean;
  filterViews?: FilterView[];
  namedRanges?: NamedRange[];
  worksheets: Worksheet[];
}

export interface WorkbookSummary {
  id: number;
  name: string;
  updatedAt: string;
  lastUpdated: string;
  worksheetCount: number;
}

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const response = await apiClient.get<{ workbooks: WorkbookSummary[] }>('/workbooks');
  return response.data.workbooks;
}

export async function createWorkbook(name?: string): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>('/workbooks', { name });
  return response.data.workbook;
}

export async function getWorkbook(id: number | string): Promise<Workbook> {
  const response = await apiClient.get<{ workbook: Workbook }>(`/workbooks/${id}`);
  return response.data.workbook;
}

export async function renameWorkbook(id: number | string, name: string): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(`/workbooks/${id}`, { name });
  return response.data.workbook;
}

export async function createWorksheet(id: number | string): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(`/workbooks/${id}/worksheets`);
  return response.data.workbook;
}

export async function renameWorksheet(id: number | string, worksheetId: number, name: string): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(`/workbooks/${id}/worksheets/${worksheetId}`, { name });
  return response.data.workbook;
}

export async function deleteWorksheet(id: number | string, worksheetId: number): Promise<Workbook> {
  const response = await apiClient.delete<{ workbook: Workbook }>(`/workbooks/${id}/worksheets/${worksheetId}`);
  return response.data.workbook;
}

export async function setActiveWorksheet(id: number | string, worksheetId: number): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(`/workbooks/${id}/active-worksheet`, { worksheetId });
  return response.data.workbook;
}

export async function setWorksheetSelection(
  id: number | string,
  worksheetId: number,
  row: number,
  column: number,
  endRow?: number,
  endColumn?: number,
): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(`/workbooks/${id}/worksheets/${worksheetId}/selection`, {
    row,
    column,
    endRow: endRow ?? row,
    endColumn: endColumn ?? column,
  });
  return response.data.workbook;
}

export async function modifyWorksheetRows(
  id: number | string,
  worksheetId: number,
  action: 'insertAbove' | 'insertBelow' | 'delete',
  row: number,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(`/workbooks/${id}/worksheets/${worksheetId}/rows`, { action, row });
  return response.data.workbook;
}

export async function modifyWorksheetColumns(
  id: number | string,
  worksheetId: number,
  action: 'insertLeft' | 'insertRight' | 'delete',
  column: number,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(`/workbooks/${id}/worksheets/${worksheetId}/columns`, { action, column });
  return response.data.workbook;
}

export async function importWorkbook(fileName: string, content: string): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>('/workbooks/import', {
    fileName,
    content,
  });
  return response.data.workbook;
}

export async function updateCell(
  id: number | string,
  worksheetId: number,
  row: number,
  column: number,
  value: string,
): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(`/workbooks/${id}/worksheets/${worksheetId}/cells/${row}/${column}`, { value });
  return response.data.workbook;
}

export async function writeCells(
  id: number | string,
  worksheetId: number,
  cells: CellWrite[],
): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(`/workbooks/${id}/worksheets/${worksheetId}/cells`, { cells });
  return response.data.workbook;
}

export async function undoWorkbook(id: number | string): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(`/workbooks/${id}/undo`);
  return response.data.workbook;
}

export async function redoWorkbook(id: number | string): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(`/workbooks/${id}/redo`);
  return response.data.workbook;
}

export interface SortRangeRequest {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  sortByColumn: number;
  order: 'asc' | 'desc';
  hasHeader: boolean;
}

export async function sortWorkbookRange(
  id: number | string,
  worksheetId: number,
  request: SortRangeRequest,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/sort`,
    request,
  );
  return response.data.workbook;
}

export interface FilterCreateRequest {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  columns: FilterColumn[];
}

export async function createWorkbookFilter(
  id: number | string,
  worksheetId: number,
  request: FilterCreateRequest,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/filter`,
    request,
  );
  return response.data.workbook;
}

export async function clearWorkbookFilter(
  id: number | string,
  worksheetId: number,
): Promise<Workbook> {
  const response = await apiClient.delete<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/filter`,
  );
  return response.data.workbook;
}

export async function saveWorkbookFilterView(
  id: number | string,
  worksheetId: number,
  name: string,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/filter-views`,
    { worksheetId, name },
  );
  return response.data.workbook;
}

export async function applyWorkbookFilterView(
  id: number | string,
  viewId: number,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/filter-views/${viewId}/apply`,
  );
  return response.data.workbook;
}

export async function deleteWorkbookFilterView(
  id: number | string,
  viewId: number,
): Promise<Workbook> {
  const response = await apiClient.delete<{ workbook: Workbook }>(
    `/workbooks/${id}/filter-views/${viewId}`,
  );
  return response.data.workbook;
}

export interface PivotCreateRequest {
  sourceWorksheetId: number;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

export interface PivotApplyRequest {
  rowField: number;
  columnField?: number | null;
  valueField: number;
  summarizeBy: SummarizeBy;
}

export async function createPivotTable(
  id: number | string,
  request: PivotCreateRequest,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/pivot`,
    request,
  );
  return response.data.workbook;
}

export async function applyPivotTable(
  id: number | string,
  request: PivotApplyRequest,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/pivot/apply`,
    request,
  );
  return response.data.workbook;
}

export async function refreshPivotTable(
  id: number | string,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/pivot/refresh`,
  );
  return response.data.workbook;
}

export interface ValidationRuleRequest {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  ruleType: ValidationRuleType;
  allowedValues?: string;
  minimum?: number | string | null;
  maximum?: number | string | null;
  errorMessage?: string | null;
}

export async function saveValidationRule(
  id: number | string,
  worksheetId: number,
  request: ValidationRuleRequest,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/validation`,
    request,
  );
  return response.data.workbook;
}

export async function deleteValidationRule(
  id: number | string,
  worksheetId: number,
  ruleId: number,
): Promise<Workbook> {
  const response = await apiClient.delete<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/validation/${ruleId}`,
  );
  return response.data.workbook;
}

export async function setWorksheetFreeze(
  id: number | string,
  worksheetId: number,
  rows: number,
  columns: number,
): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/freeze`,
    { rows, columns },
  );
  return response.data.workbook;
}

export async function createNamedRange(
  id: number | string,
  name: string,
  range: string,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/named-ranges`,
    { name, range },
  );
  return response.data.workbook;
}

export async function updateNamedRange(
  id: number | string,
  rangeId: number,
  range: string,
): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(
    `/workbooks/${id}/named-ranges/${rangeId}`,
    { range },
  );
  return response.data.workbook;
}

export interface ConditionalFormatRequest {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
  condition: ConditionalFormatCondition;
  value: string;
  style: ConditionalFormatStyle;
}

export async function createConditionalFormat(
  id: number | string,
  worksheetId: number,
  request: ConditionalFormatRequest,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/conditional-formats`,
    request,
  );
  return response.data.workbook;
}

export async function updateConditionalFormat(
  id: number | string,
  worksheetId: number,
  ruleId: number,
  request: ConditionalFormatRequest,
): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/conditional-formats/${ruleId}`,
    request,
  );
  return response.data.workbook;
}

export async function deleteConditionalFormat(
  id: number | string,
  worksheetId: number,
  ruleId: number,
): Promise<Workbook> {
  const response = await apiClient.delete<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/conditional-formats/${ruleId}`,
  );
  return response.data.workbook;
}

export async function createCellNote(
  id: number | string,
  worksheetId: number,
  row: number,
  column: number,
  text: string,
): Promise<Workbook> {
  const response = await apiClient.post<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/cell-notes`,
    { row, column, text },
  );
  return response.data.workbook;
}

export async function updateCellNote(
  id: number | string,
  worksheetId: number,
  noteId: number,
  text: string,
): Promise<Workbook> {
  const response = await apiClient.patch<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/cell-notes/${noteId}`,
    { text },
  );
  return response.data.workbook;
}

export async function deleteCellNote(
  id: number | string,
  worksheetId: number,
  noteId: number,
): Promise<Workbook> {
  const response = await apiClient.delete<{ workbook: Workbook }>(
    `/workbooks/${id}/worksheets/${worksheetId}/cell-notes/${noteId}`,
  );
  return response.data.workbook;
}

export async function exportWorkbookCsv(id: number | string, worksheetId: number): Promise<{ blob: Blob; fileName: string }> {
  const response = await apiClient.get<Blob>(`/workbooks/${id}/export`, {
    params: { worksheetId },
    responseType: 'blob',
  });
  const disposition = String(response.headers['content-disposition'] || '');
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = match?.[1] || `worksheet-${worksheetId}.csv`;
  return { blob: response.data, fileName };
}

export default apiClient;
