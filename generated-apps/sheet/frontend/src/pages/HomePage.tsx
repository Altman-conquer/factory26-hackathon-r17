import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listWorkbooks, importWorkbook, getErrorMessage, type WorkbookSummary } from '../api';

function HomePage() {
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function refresh() {
    try {
      setLoading(true);
      setLoadError('');
      const items = await listWorkbooks();
      setWorkbooks(items);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleConfirmImport() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setImportError('Choose a CSV file to import.');
      return;
    }
    try {
      setImporting(true);
      setImportError('');
      const content = await file.text();
      const workbook = await importWorkbook(file.name, content);
      navigate(`/workbooks/${workbook.id}`);
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes('Invalid CSV')) {
        setImportError('Invalid CSV file format. Import failed.');
      } else {
        setImportError(message);
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-bold text-slate-900">Workbooks</h1>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/workbooks/new')}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              New blank workbook
            </button>
            <button
              type="button"
              onClick={() => {
                setImportError('');
                setImportOpen(true);
              }}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Import CSV
            </button>
          </div>
        </header>

        {loadError && <p className="mt-4 rounded-md bg-red-50 p-3 text-red-700">{loadError}</p>}
        {loading && <p className="mt-6 text-slate-500">Loading workbooks…</p>}

        {!loading && workbooks.length === 0 && (
          <p className="mt-6 text-slate-500">No workbooks yet.</p>
        )}

        <ul className="mt-6 space-y-3">
          {workbooks.map((workbook) => (
            <li
              key={workbook.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <Link to={`/workbooks/${workbook.id}`} className="text-base font-semibold text-blue-700 hover:underline">
                {workbook.name}
              </Link>
              <span className="text-sm text-slate-500">Last updated: {workbook.lastUpdated}</span>
            </li>
          ))}
        </ul>
      </div>

      {importOpen && (
        <div
          role="dialog"
          aria-label="Import CSV"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setImportOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Import CSV</h2>
            <div className="mt-4">
              <label htmlFor="csv-file" className="block text-sm font-medium text-slate-700">
                CSV file
              </label>
              <input
                id="csv-file"
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="mt-1 block w-full rounded-md border border-slate-300 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-blue-700"
              />
            </div>
            {importError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{importError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmImport()}
                disabled={importing}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Confirm import
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default HomePage;
