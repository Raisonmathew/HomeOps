import React, { useState } from 'react';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Requests } from './pages/Requests';
import { Technicians } from './pages/Technicians';
import { Monitoring } from './pages/Monitoring';
import { Complaints } from './pages/Complaints';
import { Config } from './pages/Config';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('overview');

  const renderContent = () => {
    switch (currentTab) {
      case 'overview':
        return <Overview />;
      case 'requests':
        return <Requests />;
      case 'technicians':
        return <Technicians />;
      case 'monitoring':
        return <Monitoring />;
      case 'complaints':
        return <Complaints />;
      case 'config':
        return <Config />;
      default:
        return <Overview />;
    }
  };

  return (
    <Layout currentTab={currentTab} setCurrentTab={setCurrentTab}>
      {renderContent()}
    </Layout>
  );
};

export default App;
