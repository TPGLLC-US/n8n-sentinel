import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Instances from './pages/Instances';
import InstanceDetail from './pages/InstanceDetail';
import Resources from './pages/Resources';
import Workflows from './pages/Workflows';
import Executions from './pages/Executions';
import TokenUsage from './pages/TokenUsage';
import Alerts from './pages/Alerts';
import ErrorReporting from './pages/ErrorReporting';
import Settings from './pages/Settings';

import Login from './pages/Login';
import AuthGuard from './components/AuthGuard';



export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<AuthGuard />}>
          <Route path="/" element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="instances" element={<Instances />} />
            <Route path="instances/:id" element={<InstanceDetail />} />
            <Route path="workflows" element={<Workflows />} />
            <Route path="executions" element={<Executions />} />
            <Route path="resources" element={<Resources />} />
            <Route path="tokens" element={<TokenUsage />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="error-reporting" element={<ErrorReporting />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
