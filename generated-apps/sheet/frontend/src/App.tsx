import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import CreateWorkbookPage from './pages/CreateWorkbookPage';
import WorkbookPage from './pages/WorkbookPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/workbooks/new" element={<CreateWorkbookPage />} />
      <Route path="/workbooks/:id" element={<WorkbookPage />} />
    </Routes>
  );
}

export default App;
