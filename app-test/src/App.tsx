import '#src/globalStyles';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/MainLayout';
import { demos } from './routes';

function App() {
  return (
    <BrowserRouter>
      <MainLayout>
        <Routes>
          {demos.map((demo) => (
            <Route
              key={demo.path}
              path={demo.path}
              element={<demo.component />}
            />
          ))}
        </Routes>
      </MainLayout>
    </BrowserRouter>
  );
}

export default App;
